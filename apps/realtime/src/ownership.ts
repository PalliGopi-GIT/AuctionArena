import { randomUUID } from 'node:crypto';

export interface RoomHead { epoch: number; version: number }
export interface OwnerGrant {
  readonly roomId: string;
  readonly ownerToken: string;
  readonly epoch: number;
}

/** Implementations must use atomic acquire-if-absent and compare-token renew/delete.
 * Every call must have a bounded transport timeout. A lease is coordination only. */
export interface RoomLeasePort {
  acquire(roomId: string, token: string, ttlMs: number): Promise<boolean>;
  renew(roomId: string, token: string, ttlMs: number): Promise<boolean>;
  release(roomId: string, token: string): Promise<void>;
}

export type WriteOutcome<Receipt> =
  | { status: 'committed'; version: number; receipt: Receipt }
  | { status: 'conflict' }
  | { status: 'fenced' };

/** The adapter, not the caller, enforces these conditions atomically:
 * claimEpoch compares the old epoch and increments it without changing the version;
 * commit compares BOTH epoch/token and expectedVersion with every entity mutation.
 * Events, idempotency receipts, timers and outbox records must join that transaction.
 * These ports do not prescribe a whole-room storage item. No cloud adapter exists yet. */
export interface FencedRoomPort<Change, Receipt> {
  readHead(roomId: string): Promise<RoomHead>;
  claimEpoch(roomId: string, expectedEpoch: number, ownerToken: string): Promise<RoomHead | null>;
  commit(request: OwnerGrant & { expectedVersion: number; change: Change }): Promise<WriteOutcome<Receipt>>;
}

type LossReason = 'lease_expired' | 'lease_lost' | 'fenced' | 'uncertain_write' | 'invalid_response' | 'clock_invalid' | 'released';
type OwnershipCode = 'ROOM_UNAVAILABLE' | 'OWNERSHIP_LOST' | 'STATE_CONFLICT' | 'TIMEOUT_RETRY';
export class OwnershipError extends Error {
  constructor(readonly code: OwnershipCode) { super(code); }
}

interface ActiveOwner { grant: OwnerGrant; validUntil: number; renewAt: number }
interface OwnershipOptions {
  /** Monotonic milliseconds, independent of wall-clock auction deadlines. */
  clock?: () => number;
  token?: () => string;
  ttlMs?: number;
  renewEveryMs?: number;
  /** Synchronously stop timers/intent admission on loss. Never perform a durable write here. */
  onLost?: (reason: LossReason) => void;
}

/** Provider-independent coordination core. Not wired to LocalRoomStore or HTTP.
 * A future registry must call renew by renewalDueAt and rehydrate/validate the room
 * before admitting intents. The durable adapter remains the final safety boundary. */
export class RoomOwnership<Change, Receipt> {
  private active?: ActiveOwner;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastNow = -Infinity;
  private readonly clock: () => number;
  private readonly token: () => string;
  private readonly ttlMs: number;
  private readonly renewEveryMs: number;

  constructor(
    readonly roomId: string,
    private readonly leases: RoomLeasePort,
    private readonly durable: FencedRoomPort<Change, Receipt>,
    private readonly options: OwnershipOptions = {},
  ) {
    this.clock = options.clock ?? (() => performance.now());
    this.token = options.token ?? randomUUID;
    this.ttlMs = options.ttlMs ?? 15_000;
    this.renewEveryMs = options.renewEveryMs ?? 5_000;
    if (!roomId || !Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0 ||
        !Number.isSafeInteger(this.renewEveryMs) || this.renewEveryMs <= 0 || this.renewEveryMs >= this.ttlMs) {
      throw new Error('Invalid room ownership configuration');
    }
  }

  private now(): number {
    const now = this.clock();
    if (!Number.isFinite(now) || now < this.lastNow) {
      this.demote('clock_invalid');
      throw new OwnershipError('OWNERSHIP_LOST');
    }
    this.lastNow = now;
    return now;
  }

  private demote(reason: LossReason): void {
    const wasActive = !!this.active;
    this.active = undefined;
    this.generation++;
    // A failing cleanup observer cannot restore admission or replace the safe error.
    if (wasActive) { try { this.options.onLost?.(reason); } catch { /* already demoted */ } }
  }

  private current(generation = this.generation): ActiveOwner {
    if (generation !== this.generation || !this.active) throw new OwnershipError('OWNERSHIP_LOST');
    if (this.now() >= this.active.validUntil) {
      this.demote('lease_expired');
      throw new OwnershipError('OWNERSHIP_LOST');
    }
    return this.active;
  }

  get grant(): OwnerGrant { return this.current().grant; }
  get renewalDueAt(): number { return this.current().renewAt; }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async releaseToken(token: string): Promise<void> {
    try { await this.leases.release(this.roomId, token); } catch { /* expires by TTL; never delete another token */ }
  }

  acquire(): Promise<RoomHead> {
    const generation = this.generation;
    return this.serial(async () => {
      if (generation !== this.generation || this.active) throw new OwnershipError('ROOM_UNAVAILABLE');
      const token = this.token();
      if (!token) throw new Error('An acquisition needs a unique nonempty token');
      try {
        const head = await this.durable.readHead(this.roomId);
        this.validateHead(head);
        if (head.epoch === Number.MAX_SAFE_INTEGER) throw new OwnershipError('ROOM_UNAVAILABLE');
        this.checkGeneration(generation);
        const startedAt = this.now();
        const acquired = await this.leases.acquire(this.roomId, token, this.ttlMs);
        if (acquired !== true) throw new OwnershipError('ROOM_UNAVAILABLE');
        this.checkGeneration(generation);
        if (this.now() >= startedAt + this.ttlMs) throw new OwnershipError('ROOM_UNAVAILABLE');
        const claimed = await this.durable.claimEpoch(this.roomId, head.epoch, token);
        this.checkGeneration(generation);
        if (!claimed) throw new OwnershipError('ROOM_UNAVAILABLE');
        this.validateHead(claimed);
        if (claimed.epoch !== head.epoch + 1 || claimed.version < head.version || this.now() >= startedAt + this.ttlMs) {
          throw new OwnershipError('ROOM_UNAVAILABLE');
        }
        // The durable round trip can span a lease failover. Confirm the SAME token
        // before serving; use request start, never response arrival, for local TTL.
        const confirmedAt = this.now();
        const renewed = await this.leases.renew(this.roomId, token, this.ttlMs);
        this.checkGeneration(generation);
        if (renewed !== true || this.now() >= confirmedAt + this.ttlMs) throw new OwnershipError('ROOM_UNAVAILABLE');
        this.active = {
          grant: Object.freeze({ roomId: this.roomId, ownerToken: token, epoch: claimed.epoch }),
          validUntil: confirmedAt + this.ttlMs,
          renewAt: confirmedAt + this.renewEveryMs,
        };
        return { ...claimed };
      } catch {
        await this.releaseToken(token);
        throw new OwnershipError('ROOM_UNAVAILABLE');
      }
    });
  }

  private checkGeneration(generation: number): void {
    if (generation !== this.generation) throw new OwnershipError('OWNERSHIP_LOST');
  }

  private validateHead(head: RoomHead): void {
    if (!Number.isSafeInteger(head.epoch) || head.epoch < 0 ||
        !Number.isSafeInteger(head.version) || head.version < 0) throw new OwnershipError('ROOM_UNAVAILABLE');
  }

  renew(): Promise<void> {
    const generation = this.generation;
    return this.serial(async () => {
      const owner = this.current(generation);
      const startedAt = this.now();
      let renewed: boolean;
      try { renewed = await this.leases.renew(this.roomId, owner.grant.ownerToken, this.ttlMs); }
      catch { this.demote('lease_lost'); throw new OwnershipError('OWNERSHIP_LOST'); }
      this.checkGeneration(generation);
      if (renewed !== true || this.now() >= startedAt + this.ttlMs) {
        this.demote('lease_lost');
        throw new OwnershipError('OWNERSHIP_LOST');
      }
      owner.validUntil = startedAt + this.ttlMs;
      owner.renewAt = startedAt + this.renewEveryMs;
    });
  }

  commit(expectedVersion: number, change: Change): Promise<{ version: number; receipt: Receipt }> {
    const generation = this.generation;
    // Capture queued proposals so the caller cannot alter an in-flight transaction.
    const proposal = structuredClone(change);
    return this.serial(async () => {
      const owner = this.current(generation);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new OwnershipError('STATE_CONFLICT');
      let outcome: WriteOutcome<Receipt>;
      try { outcome = await this.durable.commit({ ...owner.grant, expectedVersion, change: proposal }); }
      catch {
        // A timeout can hide a committed transaction. Never repeat it blindly,
        // update local state, acknowledge success or publish an unconfirmed event.
        this.demote('uncertain_write');
        throw new OwnershipError('TIMEOUT_RETRY');
      }
      this.current(generation);
      if (!outcome) {
        this.demote('invalid_response');
        throw new OwnershipError('TIMEOUT_RETRY');
      }
      if (outcome.status === 'fenced') {
        this.demote('fenced');
        throw new OwnershipError('OWNERSHIP_LOST');
      }
      if (outcome.status === 'conflict') throw new OwnershipError('STATE_CONFLICT');
      if (outcome.status !== 'committed' || !Number.isSafeInteger(outcome.version) || outcome.version <= expectedVersion) {
        this.demote('invalid_response');
        throw new OwnershipError('TIMEOUT_RETRY');
      }
      return { version: outcome.version, receipt: outcome.receipt };
    });
  }

  /** Stops admission synchronously, including while acquire/renew/commit is awaiting I/O. */
  release(): Promise<void> {
    const token = this.active?.grant.ownerToken;
    this.demote('released');
    return this.serial(async () => { if (token) await this.releaseToken(token); });
  }
}
