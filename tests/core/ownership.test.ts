import { describe, expect, it, vi } from 'vitest';
import { RoomOwnership, type FencedRoomPort, type RoomLeasePort } from '../../apps/realtime/src/ownership';
import { FencedRoomSimulator, LeaseSimulator } from '../../packages/testkit/src/ownership-simulator';
import { applyAction, createRoom, settle } from '../../packages/engine/src/index';
import { settingsSchema, type Action, type Room } from '../../packages/shared/src/index';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let now = 0, sequence = 0;
  const clock = () => now;
  const leases = new LeaseSimulator(clock);
  const durable = new FencedRoomSimulator<number, { delta: number }, number>((state, change) => {
    const next = state + change.delta;
    return { state: next, version: state + 1, receipt: next };
  });
  durable.seed('room', 0);
  const lost = vi.fn();
  const owner = (leasePort: RoomLeasePort = leases, store: FencedRoomPort<{ delta: number }, number> = durable) =>
    new RoomOwnership('room', leasePort, store, { clock, token: () => `unique-${++sequence}`, onLost: lost });
  return { leases, durable, lost, owner, clock, advance(ms: number) { now += ms; } };
}

describe('provider-independent ownership protocol (atomic test models only)', () => {
  it('elects exactly one owner during concurrent acquisition', async () => {
    const f = fixture(), a = f.owner(), b = f.owner();
    const outcomes = await Promise.allSettled([a.acquire(), b.acquire()]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await f.durable.readHead('room')).toEqual({ epoch: 1, version: 0 });
    // The failed claimant's cleanup must not remove the successful claimant's lease.
    const winner = outcomes[0]!.status === 'fulfilled' ? a : b;
    await expect(winner.renew()).resolves.toBeUndefined();
  });

  it('uses distinct acquisition tokens and monotonically increasing epochs', async () => {
    const f = fixture(), a = f.owner();
    await a.acquire(); const first = a.grant;
    expect(Object.isFrozen(first)).toBe(true);
    await a.release(); await a.acquire();
    expect(a.grant.epoch).toBe(first.epoch + 1);
    expect(a.grant.ownerToken).not.toBe(first.ownerToken);
    await f.leases.release('room', first.ownerToken);
    await expect(a.renew()).resolves.toBeUndefined();
  });

  it('expires at the exact local TTL and admits no further writes', async () => {
    const f = fixture(), a = f.owner(); await a.acquire(); f.advance(15_000);
    await expect(a.commit(0, { delta: 1 })).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    expect(f.durable.snapshot('room')).toBe(0);
    expect(f.lost.mock.calls).toEqual([['lease_expired']]);
    expect(() => a.grant).toThrow('OWNERSHIP_LOST');
    expect(f.lost).toHaveBeenCalledTimes(1);
  });

  it('renews on the request-start clock and exposes the next renewal time', async () => {
    const f = fixture(), a = f.owner(); await a.acquire();
    expect(a.renewalDueAt).toBe(5_000);
    f.advance(5_000); await a.renew();
    expect(a.renewalDueAt).toBe(10_000);
    f.advance(14_999); expect(a.grant.epoch).toBe(1);
    f.advance(1); expect(() => a.grant).toThrow('OWNERSHIP_LOST');
  });

  it('demotes immediately when renewal loses its token', async () => {
    const f = fixture(), a = f.owner(); await a.acquire(); f.leases.loseKeyspace();
    await expect(a.renew()).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    await expect(a.commit(0, { delta: 1 })).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    expect(f.lost.mock.calls).toEqual([['lease_lost']]);
  });

  it('does not extend a lease from a delayed response arrival', async () => {
    const f = fixture(); let delayed = false;
    const leasePort: RoomLeasePort = {
      acquire: (...args) => f.leases.acquire(...args), release: (...args) => f.leases.release(...args),
      async renew(...args) { const result = await f.leases.renew(...args); if (delayed) f.advance(15_000); return result; },
    };
    const a = f.owner(leasePort); await a.acquire(); delayed = true;
    await expect(a.renew()).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    expect(() => a.grant).toThrow('OWNERSHIP_LOST');
  });

  it('fails closed on a renewal transport failure', async () => {
    const f = fixture(), a = f.owner(); await a.acquire();
    vi.spyOn(f.leases, 'renew').mockRejectedValueOnce(new Error('connection lost'));
    await expect(a.renew()).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    expect(f.lost.mock.calls).toEqual([['lease_lost']]);
  });

  it('releases its lease when the durable epoch CAS loses a race', async () => {
    const f = fixture();
    vi.spyOn(f.durable, 'claimEpoch').mockResolvedValueOnce(null);
    await expect(f.owner().acquire()).rejects.toMatchObject({ code: 'ROOM_UNAVAILABLE' });
    await expect(f.owner().acquire()).resolves.toEqual({ epoch: 1, version: 0 });
  });

  it('never serves if the durable claim outlasts the lease', async () => {
    const f = fixture(), claim = f.durable.claimEpoch.bind(f.durable);
    vi.spyOn(f.durable, 'claimEpoch').mockImplementationOnce(async (...args) => {
      const head = await claim(...args); f.advance(15_000); return head;
    });
    const a = f.owner();
    await expect(a.acquire()).rejects.toMatchObject({ code: 'ROOM_UNAVAILABLE' });
    expect(() => a.grant).toThrow('OWNERSHIP_LOST');
    await expect(f.owner().acquire()).resolves.toMatchObject({ epoch: 2 });
  });

  it('confirms the lease token again after the durable claim', async () => {
    const f = fixture(), claim = f.durable.claimEpoch.bind(f.durable);
    vi.spyOn(f.durable, 'claimEpoch').mockImplementationOnce(async (...args) => {
      const head = await claim(...args); f.leases.loseKeyspace(); return head;
    });
    await expect(f.owner().acquire()).rejects.toMatchObject({ code: 'ROOM_UNAVAILABLE' });
    await expect(f.owner().acquire()).resolves.toMatchObject({ epoch: 2 });
  });

  it('fences the previous owner after simulated lease-store key loss', async () => {
    const f = fixture(), a = f.owner(), b = f.owner(); await a.acquire();
    await a.commit(0, { delta: 1 }); f.leases.loseKeyspace();
    await expect(b.acquire()).resolves.toEqual({ epoch: 2, version: 1 });
    await expect(a.commit(1, { delta: 1 })).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    expect(f.lost.mock.calls).toEqual([['fenced']]);
    await expect(b.commit(1, { delta: 1 })).resolves.toEqual({ version: 2, receipt: 2 });
    await a.release(); await expect(b.renew()).resolves.toBeUndefined();
  });

  it('blocks an old transaction that arrives after another owner fences it', async () => {
    const f = fixture(), entered = deferred(), resume = deferred();
    const commit = f.durable.commit.bind(f.durable);
    vi.spyOn(f.durable, 'commit').mockImplementationOnce(async request => {
      entered.resolve(); await resume.promise; return commit(request);
    });
    const a = f.owner(), b = f.owner(); await a.acquire();
    const pending = a.commit(0, { delta: 1 }); const result = expect(pending).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    await entered.promise; f.leases.loseKeyspace(); await b.acquire(); resume.resolve(); await result;
    expect(f.durable.snapshot('room')).toBe(0);
    await expect(b.commit(0, { delta: 1 })).resolves.toMatchObject({ version: 1 });
  });

  it('never retries or returns success when a committed write loses its response', async () => {
    const f = fixture(), commit = f.durable.commit.bind(f.durable);
    const write = vi.spyOn(f.durable, 'commit').mockImplementationOnce(async request => {
      await commit(request); throw new Error('response lost after commit');
    });
    const a = f.owner(); await a.acquire();
    await expect(a.commit(0, { delta: 1 })).rejects.toMatchObject({ code: 'TIMEOUT_RETRY' });
    expect(write).toHaveBeenCalledTimes(1); expect(f.durable.snapshot('room')).toBe(1);
    expect(f.lost.mock.calls).toEqual([['uncertain_write']]);
    expect(() => a.grant).toThrow('OWNERSHIP_LOST');
  });

  it('returns version conflicts without retrying a proposal against different state', async () => {
    const f = fixture(), a = f.owner(); await a.acquire(); await a.commit(0, { delta: 1 });
    const write = vi.spyOn(f.durable, 'commit');
    await expect(a.commit(0, { delta: 1 })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(write).toHaveBeenCalledTimes(1); expect(a.grant.epoch).toBe(1);
    expect(f.durable.snapshot('room')).toBe(1);
  });

  it('serializes writes and captures proposals before queueing', async () => {
    const f = fixture(), a = f.owner(); await a.acquire();
    const change = { delta: 1 }, first = a.commit(0, change), second = a.commit(0, { delta: 1 });
    change.delta = 999;
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { version: 1, receipt: 1 } });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'STATE_CONFLICT' } });
    expect(f.durable.snapshot('room')).toBe(1);
  });

  it('explicit release cancels an acquisition waiting on I/O', async () => {
    const f = fixture(), entered = deferred(), resume = deferred(), claim = f.durable.claimEpoch.bind(f.durable);
    vi.spyOn(f.durable, 'claimEpoch').mockImplementationOnce(async (...args) => {
      const head = await claim(...args); entered.resolve(); await resume.promise; return head;
    });
    const a = f.owner(), pending = a.acquire();
    const result = expect(pending).rejects.toMatchObject({ code: 'ROOM_UNAVAILABLE' });
    await entered.promise; const released = a.release(); resume.resolve(); await result; await released;
    expect(() => a.grant).toThrow('OWNERSHIP_LOST');
    await expect(f.owner().acquire()).resolves.toMatchObject({ epoch: 2 });
  });

  it('explicit release suppresses a late success response and queued writes', async () => {
    const f = fixture(), entered = deferred(), resume = deferred(), commit = f.durable.commit.bind(f.durable);
    vi.spyOn(f.durable, 'commit').mockImplementationOnce(async request => {
      const result = await commit(request); entered.resolve(); await resume.promise; return result;
    });
    const a = f.owner(); await a.acquire();
    const pending = a.commit(0, { delta: 1 }); const result = expect(pending).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    const queued = a.commit(1, { delta: 1 }); const rejected = expect(queued).rejects.toMatchObject({ code: 'OWNERSHIP_LOST' });
    await entered.promise; const released = a.release();
    expect(() => a.grant).toThrow('OWNERSHIP_LOST');
    resume.resolve(); await result; await rejected; await released;
    expect(f.durable.snapshot('room')).toBe(1); expect(f.lost.mock.calls).toEqual([['released']]);
  });

  it('cannot be revived by malformed store responses or a backwards local clock', async () => {
    const f = fixture(), a = f.owner(); await a.acquire(); f.advance(1); expect(a.grant.epoch).toBe(1);
    f.advance(-1); expect(() => a.grant).toThrow('OWNERSHIP_LOST');
    expect(f.lost.mock.calls).toEqual([['clock_invalid']]);
    vi.spyOn(f.durable, 'readHead').mockResolvedValueOnce({ epoch: -1, version: 0 });
    await expect(f.owner().acquire()).rejects.toMatchObject({ code: 'ROOM_UNAVAILABLE' });
  });

  it('fails closed when the store reports an invalid commit version', async () => {
    const f = fixture(), a = f.owner(); await a.acquire();
    vi.spyOn(f.durable, 'commit').mockResolvedValueOnce({ status: 'committed', version: 0, receipt: 0 });
    await expect(a.commit(0, { delta: 1 })).rejects.toMatchObject({ code: 'TIMEOUT_RETRY' });
    expect(f.lost.mock.calls).toEqual([['invalid_response']]);
  });

  it('keeps an accepted bid and absolute deadline through owner loss and settles once', async () => {
    let now = 100_000, token = 0;
    const host = { id: 'host', name: 'Host' }, guest = { id: 'guest', name: 'Guest' };
    let room = createRoom('room', host, settingsSchema.parse({ autoAdvance: false, lateExtension: false }), now);
    room.members.push({ ...guest, connected: true, ready: true, lastSeen: now });
    let id = 0;
    const act = (type: string, extra = {}) => ({ id: `test-${++id}`, type, ...extra } as Action);
    room = applyAction(room, host.id, act('claim', { teamId: 't1' }), now);
    room = applyAction(room, guest.id, act('claim', { teamId: 't2' }), now);
    room = applyAction(room, host.id, act('start'), now);
    const initialVersion = room.version, deadline = room.deadline!;
    type Change = { kind: 'bid'; action: Action } | { kind: 'settle' };
    const leases = new LeaseSimulator(() => now);
    const durable = new FencedRoomSimulator<Room, Change, Room>((state, change) => {
      const next = change.kind === 'bid' ? applyAction(state, guest.id, change.action, now) : state;
      if (change.kind === 'settle') settle(next, now);
      return { state: next, version: next.version, receipt: next };
    });
    durable.seed('room', room, room.version);
    const owner = () => new RoomOwnership('room', leases, durable, { clock: () => now, token: () => `task-${++token}` });
    const a = owner(), b = owner(); await a.acquire();
    const accepted = await a.commit(initialVersion, { kind: 'bid', action: act('bid', { playerId: 'p1', amount: 100 }) });
    const staleGrant = a.grant;
    now = deadline + 1; const recovered = await b.acquire(); const snapshot = durable.snapshot('room');
    expect(recovered.version).toBe(accepted.version); expect(snapshot.currentBid).toBe(100); expect(snapshot.deadline).toBe(deadline);
    // Directly exercise the durable boundary, bypassing the old coordinator's TTL guard.
    await expect(durable.commit({ ...staleGrant, expectedVersion: recovered.version, change: { kind: 'settle' } })).resolves.toEqual({ status: 'fenced' });
    const sold = await b.commit(recovered.version, { kind: 'settle' });
    await expect(b.commit(recovered.version, { kind: 'settle' })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(sold.receipt.status).toBe('RESULT');
    expect(sold.receipt.teams[1]!.squad).toEqual([{ playerId: 'p1', price: 100 }]);
    expect(sold.receipt.teams[1]!.budget).toBe(room.settings.budget - 100);
    expect(sold.receipt.history.filter(event => event.type === 'sold')).toHaveLength(1);
    expect(durable.snapshot('room')).toEqual(sold.receipt);
  });
});
