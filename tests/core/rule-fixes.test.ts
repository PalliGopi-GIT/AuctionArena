import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { settingsSchema, type Action, type Room } from '../../packages/shared/src/index';
import { nextBid } from '../../packages/shared/src/domain';
import * as rules from '../../packages/shared/src/bid-rules';
import { applyAction, createRoom } from '../../packages/engine/src/index';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { createApp } from '../../apps/api/src/app';
import { attachRoomSocket } from '../../apps/api/src/room-socket';
import { connectRoom } from '../../apps/web/src/room-connection';

const host = { id: 'host', name: 'Host' }, guest = { id: 'guest', name: 'Guest' };
let sequence = 0;
const action = (type: string, extra = {}) => ({ id: `rule-${++sequence}`, type, ...extra } as Action);
function liveRoom() {
  let room = createRoom('RULES', host, settingsSchema.parse({ autoAdvance: false, lateExtension: false }), 1000);
  room.members.push({ ...guest, connected: true, ready: true, lastSeen: 1000 });
  room = applyAction(room, host.id, action('claim', { teamId: 't1' }), 1000);
  room = applyAction(room, guest.id, action('claim', { teamId: 't2' }), 1000);
  return applyAction(room, host.id, action('start'), 1000);
}
afterEach(() => vi.useRealTimers());

describe('tiered increments for new rooms and preserved legacy rules', () => {
  it.each([[0, 100], [25, 35], [190, 200], [195, 205], [200, 220], [300, 320], [495, 515], [500, 520], [505, 530], [520, 545]])('current %i requires %i lakh', (current, expected) => {
    const room = liveRoom(); room.currentBid = current;
    expect(nextBid(room)).toBe(expected);
  });
  it('server rejects the old 310 bid and accepts 320, matching client affordability', () => {
    const room = liveRoom(); room.currentBid = 300; room.leadingTeamId = 't2';
    expect(() => applyAction(room, host.id, action('bid', { playerId: 'p1', amount: 310 }), 1100)).toThrow(/amount is invalid/);
    expect(applyAction(room, host.id, action('bid', { playerId: 'p1', amount: 320 }), 1100).currentBid).toBe(320);
    room.teams[0]!.budget = 310; room.settings.minSquad = 1;
    expect(rules.bidRestriction(room, host.id, 1100)?.code).toBe('INSUFFICIENT_BUDGET');
  });
  it('unversioned existing rooms retain their configured flat rule', () => {
    const room = liveRoom(); delete room.bidRule; room.settings.bidIncrement = 15; room.currentBid = 505;
    expect(nextBid(room)).toBe(520);
  });
  it('persists and recovers a tiered 545 bid, rejecting a corrupt off-ladder 530 bid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'auctionarena-rules-'));
    try {
      const path = join(directory, 'state.json'), store = new LocalRoomStore(path, () => 1000);
      const { room, inviteToken } = store.create(host, settingsSchema.parse({ autoAdvance: false }));
      store.join(room.code, guest, inviteToken);
      store.action(room.code, host, action('claim', { teamId: 't1' })); store.action(room.code, guest, action('claim', { teamId: 't2' }));
      let current = store.action(room.code, host, action('start'));
      const amounts = [100,110,120,130,140,150,160,170,180,190,200,220,240,260,280,300,320,340,360,380,400,420,440,460,480,500,520,545];
      amounts.forEach((amount, i) => { current = store.action(room.code, i % 2 ? guest : host, action('bid', { playerId: 'p1', amount })); });
      const recovered = new LocalRoomStore(path, () => 1000).get(room.code, host);
      expect(recovered.currentBid).toBe(545); expect(nextBid(recovered)).toBe(570); expect(recovered.status).toBe('PAUSED');
      const db = JSON.parse(readFileSync(path, 'utf8')); db.rooms[room.code].room.currentBid = 530; writeFileSync(path, JSON.stringify(db));
      expect(() => new LocalRoomStore(path, () => 1000)).toThrow('Bid invariant');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('loads a legacy accepted bid without rewriting its price or increment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'auctionarena-legacy-'));
    try {
      const path = join(directory, 'state.json'), store = new LocalRoomStore(path, () => 1000);
      const { room: created } = store.create(host, settingsSchema.parse({}));
      const db = JSON.parse(readFileSync(path, 'utf8')); const room = liveRoom(); room.code = created.code; delete room.bidRule;
      room.currentBid = 510; room.leadingTeamId = 't1'; db.rooms[created.code].room = room; writeFileSync(path, JSON.stringify(db));
      const recovered = new LocalRoomStore(path, () => 1000).get(created.code, host);
      expect(recovered.currentBid).toBe(510); expect(nextBid(recovered)).toBe(520); expect(recovered.bidRule).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('bid deadline safety', () => {
  it('disables exactly 150 ms early but leaves the server deadline authoritative', () => {
    const room = liveRoom(), deadline = room.deadline!;
    expect(rules.bidRestriction(room, host.id, deadline - 151)).toBeNull();
    expect(rules.bidRestriction(room, host.id, deadline - 150)?.code).toBe('TOO_LATE');
    expect(applyAction(room, host.id, action('bid', { playerId: 'p1', amount: 100 }), deadline - 1).currentBid).toBe(100);
    expect(() => applyAction(room, host.id, action('bid', { playerId: 'p1', amount: 100 }), deadline)).toThrow('deadline has passed');
  });
  it('clock corrections cannot reopen the same deadline; extension or a new lot can', () => {
    const room = liveRoom(), guard = rules.createBidDeadlineGuard();
    expect(guard(room, room.deadline! - 151)).toBe(false);
    expect(guard(room, room.deadline! - 150)).toBe(true);
    expect(guard(room, room.deadline! - 1000)).toBe(true);
    room.deadline = room.deadline! + 10000; expect(guard(room, room.deadline - 1000)).toBe(false);
    expect(guard(room, room.deadline)).toBe(true);
    room.currentPlayerIndex++; expect(guard(room, room.deadline - 1000)).toBe(false);
  });
});

describe('private room non-disclosure', () => {
  it.each([
    ['GET', '', undefined], ['POST', '/ws-ticket', {}], ['POST', '/invite', {}],
    ['POST', '/actions', { id: 'no-access', type: 'start' }], ['POST', '/join', { inviteToken: 'invalid' }],
  ])('returns identical status/code/message for %s %s', async (method, suffix, body) => {
    const store = new LocalRoomStore(null), { app } = createApp(store, { localDevAuth: true });
    const owner = store.session('Owner'), outsider = store.session('Outsider');
    const { room } = store.create(owner.user, settingsSchema.parse({}));
    const request = async (code: string) => {
      const response = await app.request(`/api/rooms/${code}${suffix}`, { method, headers: { Authorization: `Bearer ${outsider.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const { requestId, ...payload } = await response.json(); expect(requestId).toMatch(/^[a-f0-9]{16}$/);
      return { status: response.status, payload };
    };
    const denied = await request(room.code); expect(denied).toEqual(await request('MISSING'));
    expect(denied).toEqual({ status: 404, payload: { code: 'ROOM_NOT_FOUND', message: 'Room unavailable. Check your invitation or ask the host for access.' } });
  });
  it.each(['started', 'ended', 'full'])('does not disclose a room that an invite holder cannot join because it is %s', async condition => {
    const store = new LocalRoomStore(null, () => 1000), { app } = createApp(store, { localDevAuth: true });
    const owner = store.session('Owner'), outsider = store.session('Outsider');
    const { room, inviteToken } = store.create(owner.user, settingsSchema.parse({ spectators: false }));
    if (condition === 'started') {
      const guest = store.session('Guest'); store.join(room.code, guest.user, inviteToken);
      store.action(room.code, owner.user, action('claim', { teamId: 't1' }));
      store.action(room.code, guest.user, action('claim', { teamId: 't2' }));
      store.action(room.code, owner.user, action('start'));
    } else if (condition === 'ended') store.action(room.code, owner.user, action('end'));
    else for (let i = 0; i < 19; i++) store.join(room.code, { id: `fan-${i}`, name: `Fan ${i}` }, inviteToken);
    const request = async (code: string) => {
      const response = await app.request(`/api/rooms/${code}/join`, { method: 'POST', headers: { Authorization: `Bearer ${outsider.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken }) });
      const { requestId, ...body } = await response.json(); return { status: response.status, body };
    };
    expect(await request(room.code)).toEqual(await request('MISSING'));
  });
});

class ClientSocket {
  readyState = 1; sent: any[] = [];
  onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: (event: { code: number }) => void;
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
describe('client timing and terminal HTTP failures', () => {
  it('uses the request midpoint and ignores untimed pushes or unmatched pongs', async () => {
    vi.useFakeTimers(); let now = 1000; const offsets: number[] = [], socket = new ClientSocket(); const room = liveRoom();
    const stop = connectRoom({ code: room.code, clock: () => now, syncClock: offset => offsets.push(offset),
      request: async path => { if (path.endsWith('ws-ticket')) return { ticket: 't' }; now = 1200; return { room, serverNow: 5100 }; },
      socket: () => socket as unknown as WebSocket, snapshot: () => {}, connection: () => {} });
    try {
      await vi.advanceTimersByTimeAsync(0); expect(offsets).toEqual([4000]);
      now = 2000; socket.onopen?.(); expect(socket.sent.at(-1)).toEqual({ type: 'ping', clientSentAt: 2000 });
      now = 2100; socket.message({ type: 'pong', clientSentAt: 2000, serverNow: 6050 }); expect(offsets).toEqual([4000, 4000]);
      socket.message({ room, serverNow: 100000 }); socket.message({ type: 'pong', clientSentAt: 123, serverNow: 100000 });
      expect(offsets).toEqual([4000, 4000]);
    } finally { stop(); }
  });
  it.each(['poll', 'ticket'])('ACCOUNT_DELETED from %s clears cached view and stops polling/retrying without a socket', async terminal => {
    vi.useFakeTimers(); const room = liveRoom(); let view: Room | null = room, deleted = false, requests = 0;
    const lost = vi.fn(() => { view = null; }), socket = vi.fn(() => { throw new Error('Socket unavailable'); });
    const stop = connectRoom({ code: room.code, pollMs: 100, retryMs: 100, socket, snapshot: data => { view = data.room; }, connection: () => {}, accessLost: lost,
      request: async path => { requests++; if (deleted && (path.endsWith('ws-ticket') === (terminal === 'ticket'))) throw Object.assign(new Error('This account no longer has access.'), { code: 'ACCOUNT_DELETED' }); return path.endsWith('ws-ticket') ? { ticket: 't' } : { room, serverNow: 1000 }; } });
    try {
      await vi.advanceTimersByTimeAsync(0); deleted = true; await vi.advanceTimersByTimeAsync(1000);
      expect(view).toBeNull(); expect(lost).toHaveBeenCalledExactlyOnceWith('This account no longer has access.');
      const stoppedAt = requests; await vi.advanceTimersByTimeAsync(10000); expect(requests).toBe(stoppedAt);
    } finally { stop(); }
  });
  it('returns an authorized pong with the echoed client timestamp', () => {
    const store = new LocalRoomStore(null, () => 1000), { room } = store.create(host, settingsSchema.parse({}));
    const socket = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() });
    attachRoomSocket(store, room.code, host, socket, () => 5050);
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'ping', clientSentAt: 2000 })));
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ type: 'pong', clientSentAt: 2000, serverNow: 5050 });
    socket.emit('close');
  });
});
