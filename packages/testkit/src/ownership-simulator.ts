import type { FencedRoomPort, OwnerGrant, RoomHead, RoomLeasePort, WriteOutcome } from '../../../apps/realtime/src/ownership';

/** Test-only atomic model. No network, persistence, AWS guarantee or production fallback. */
export class LeaseSimulator implements RoomLeasePort {
  private entries = new Map<string, { token: string; expiresAt: number }>();
  constructor(private readonly clock: () => number) {}
  private entry(roomId: string) {
    const entry = this.entries.get(roomId);
    if (entry && entry.expiresAt <= this.clock()) { this.entries.delete(roomId); return undefined; }
    return entry;
  }
  async acquire(roomId: string, token: string, ttlMs: number): Promise<boolean> {
    if (this.entry(roomId)) return false;
    this.entries.set(roomId, { token, expiresAt: this.clock() + ttlMs });
    return true;
  }
  async renew(roomId: string, token: string, ttlMs: number): Promise<boolean> {
    if (this.entry(roomId)?.token !== token) return false;
    this.entries.set(roomId, { token, expiresAt: this.clock() + ttlMs });
    return true;
  }
  async release(roomId: string, token: string): Promise<void> {
    if (this.entry(roomId)?.token === token) this.entries.delete(roomId);
  }
  loseKeyspace(): void { this.entries.clear(); }
}

export class FencedRoomSimulator<State, Change, Receipt> implements FencedRoomPort<Change, Receipt> {
  private entries = new Map<string, { head: RoomHead; token?: string; state: State }>();
  constructor(private readonly apply: (state: State, change: Change) => { state: State; version: number; receipt: Receipt }) {}
  seed(roomId: string, state: State, version = 0): void {
    if (this.entries.has(roomId)) throw new Error('Room already seeded');
    this.entries.set(roomId, { head: { epoch: 0, version }, state: structuredClone(state) });
  }
  private entry(roomId: string) {
    const entry = this.entries.get(roomId);
    if (!entry) throw new Error('Room not found');
    return entry;
  }
  snapshot(roomId: string): State { return structuredClone(this.entry(roomId).state); }
  async readHead(roomId: string): Promise<RoomHead> { return { ...this.entry(roomId).head }; }
  async claimEpoch(roomId: string, expectedEpoch: number, ownerToken: string): Promise<RoomHead | null> {
    const entry = this.entry(roomId);
    if (entry.head.epoch !== expectedEpoch) return null;
    entry.head.epoch++;
    entry.token = ownerToken;
    return { ...entry.head };
  }
  async commit(request: OwnerGrant & { expectedVersion: number; change: Change }): Promise<WriteOutcome<Receipt>> {
    const entry = this.entry(request.roomId);
    if (entry.head.epoch !== request.epoch || entry.token !== request.ownerToken) return { status: 'fenced' };
    if (entry.head.version !== request.expectedVersion) return { status: 'conflict' };
    const result = this.apply(structuredClone(entry.state), structuredClone(request.change));
    if (!Number.isSafeInteger(result.version) || result.version <= entry.head.version) throw new Error('Invalid simulated transaction');
    entry.state = structuredClone(result.state);
    entry.head.version = result.version;
    return { status: 'committed', version: result.version, receipt: structuredClone(result.receipt) };
  }
}
