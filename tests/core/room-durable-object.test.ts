import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Settings } from '../../packages/shared/src/index';
import { settingsSchema, type Action } from '../../packages/shared/src/index';
import type { Room, User } from '../../packages/shared/src/domain';
import { applyAction, createRoom } from '../../packages/engine/src/index';
import { deriveAuctionResults } from '../../packages/results/src/index';
import type { SqlDriver, SqlValue } from '../../packages/storage/src/port';
import { SqliteRoomStorage } from '../../packages/storage/src/sqlite-room';
import {
  RoomDurableObject,
  type DurableObjectStateLike,
  type DoSql,
  type DoStorage,
  type WebSocketLike,
} from '../../apps/api/src/worker/room-do';
import type {
  DurableObjectIdLike,
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
} from '../../apps/api/src/worker/types';

const host: User = { id: 'user_host', name: 'Host' };
const guest: User = { id: 'user_guest', name: 'Guest' };
const other: User = { id: 'user_other', name: 'Other' };
const PRIVATE = 'Room unavailable. Check your invitation or ask the host for access.';

class FakeSocket implements WebSocketLike {
  readyState = 1;
  bufferedAmount = 0;
  tags: string[] = [];
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  attachment: unknown;
  send(data: string) { this.sent.push(data); }
  close(code?: number, reason?: string) { this.readyState = 3; this.closed = { code, reason }; }
  serializeAttachment(value: unknown) { this.attachment = value; }
  deserializeAttachment() { return this.attachment; }
}
class FakePair {
  0: FakeSocket;
  1: FakeSocket;
  constructor() { this[0] = new FakeSocket(); this[1] = new FakeSocket(); }
}
class FakeState implements DurableObjectStateLike {
  readonly storage: DoStorage;
  alarmAt: number | null = null;
  private sockets: FakeSocket[] = [];
  private active = false;
  constructor(private db: DatabaseSync) {
    const sql: DoSql = {
      exec: (query, ...bindings) => {
        if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query)) {
          const rows = this.db.prepare(query).all(...bindings) as Record<string, SqlValue>[];
          return { toArray: () => rows };
        }
        this.db.prepare(query).run(...bindings);
        return { toArray: () => [] };
      },
    };
    this.storage = {
      sql,
      transactionSync: callback => this.transaction(callback),
      setAlarm: async at => { this.alarmAt = at; },
      deleteAlarm: async () => { this.alarmAt = null; },
      getAlarm: async () => this.alarmAt,
      deleteAll: async () => {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        for (const table of tables) this.db.exec(`DROP TABLE "${table.name}"`);
        this.alarmAt = null;
      },
    };
  }
  private transaction<T>(callback: () => T): T {
    if (this.active) throw new Error('Nested transaction.');
    this.db.exec('BEGIN IMMEDIATE'); this.active = true;
    try { const value = callback(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.active = false; }
  }
  acceptWebSocket(socket: WebSocketLike, tags: string[] = []) {
    const fake = socket as FakeSocket; fake.tags = tags; fake.readyState = 1; this.sockets.push(fake);
  }
  getWebSockets(tag?: string) {
    return this.sockets.filter(socket => socket.readyState === 1 && (!tag || socket.tags.includes(tag)));
  }
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> { return callback(); }
}
class FakeDirectoryStub implements DurableObjectStubLike {
  requests: Request[] = [];
  constructor(private handler: (request: Request) => Promise<Response> | Response = () => Response.json({ ok: true })) {}
  async fetch(request: Request) { this.requests.push(request); return this.handler(request); }
}
class FakeDirectory implements DurableObjectNamespaceLike {
  names: string[] = [];
  stub: FakeDirectoryStub;
  constructor(handler?: (request: Request) => Promise<Response> | Response) {
    this.stub = new FakeDirectoryStub(handler);
  }
  idFromName(name: string): DurableObjectIdLike { this.names.push(name); return { toString: () => name }; }
  get() { return this.stub; }
}
class TestRoom extends RoomDurableObject {
  protected upgradeResponse(client: WebSocketLike): Response {
    return { status: 101, webSocket: client } as unknown as Response;
  }
}
function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return settingsSchema.parse({ teamCount: 2, minSquad: 1, maxSquad: 2, budget: 1000, timerSeconds: 10, resultSeconds: 2, ...overrides });
}
function driverFor(ctx: FakeState): SqlDriver {
  return {
    all: (query, ...bindings) => ctx.storage.sql.exec(query, ...bindings).toArray(),
    run: (query, ...bindings) => { ctx.storage.sql.exec(query, ...bindings).toArray(); },
    transaction: callback => ctx.storage.transactionSync(callback),
  };
}
function headers(user: User, code = 'ABCDEF', extra: Record<string, string> = {}) {
  return {
    'X-Auction-User-Id': user.id,
    'X-Auction-User-Name': encodeURIComponent(user.name),
    'X-Auction-Room-Code': code,
    'X-Auction-Request-Id': 'req-test',
    ...extra,
  };
}
function request(path: string, user: User, init: RequestInit = {}, code = 'ABCDEF', extra: Record<string, string> = {}) {
  return new Request(`https://room.test${path}`, {
    ...init,
    headers: { ...headers(user, code, extra), ...(init.headers as Record<string, string> | undefined) },
  });
}
async function create(room: RoomDurableObject, user: User = host, body: unknown = makeSettings()) {
  return room.fetch(request('/api/rooms', user, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}
async function join(room: RoomDurableObject, user: User, inviteToken: string) {
  return room.fetch(request('/api/rooms/ABCDEF/join', user, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteToken }),
  }));
}
async function act(room: RoomDurableObject, user: User, action: Action) {
  return room.fetch(request('/api/rooms/ABCDEF/actions', user, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  }));
}
function stateRequest(room: RoomDurableObject, user: User) {
  return room.fetch(request('/api/rooms/ABCDEF', user));
}
function historyRequest(room: RoomDurableObject, user: User, query = '') {
  return room.fetch(request(`/api/rooms/ABCDEF/history${query}`, user));
}
function syncRequest(room: RoomDurableObject, user: User, query = '') {
  return room.fetch(request(`/api/rooms/ABCDEF/sync${query}`, user));
}
function inviteRequest(room: RoomDurableObject, user: User) {
  return room.fetch(request('/api/rooms/ABCDEF/invite', user, { method: 'POST' }));
}
function authorizeRequest(room: RoomDurableObject, user: User) {
  return room.fetch(request('/api/rooms/ABCDEF/ws-ticket', user, {}, 'ABCDEF', { 'X-Auction-Operation': 'authorize' }));
}
function upgradeRequest(room: RoomDurableObject, user: User, code = 'ABCDEF') {
  return room.fetch(request(`/ws?room=${code}`, user, { headers: { Upgrade: 'websocket' } }, code));
}
async function payload(response: Response) { return await response.json() as Record<string, any>; }
function setup(env: { DIRECTORY?: DurableObjectNamespaceLike } = {}) {
  const db = new DatabaseSync(':memory:');
  const ctx = new FakeState(db);
  const room = new TestRoom(ctx, env);
  return { db, ctx, room };
}
function outbox(ctx: FakeState) {
  return ctx.storage.sql.exec('SELECT id, kind, payload FROM room_directory_outbox ORDER BY id').toArray();
}
function deleteUserRequest(userId: string) {
  return new Request(`https://room.test/internal/users/${encodeURIComponent(userId)}/delete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auction-Operation': 'delete-user',
      'X-Auction-Request-Id': 'req-delete',
    },
  });
}
function roomDeleteRequest(user: User, extra: Record<string, string> = {}) {
  return request('/api/rooms/ABCDEF', user, { method: 'DELETE' }, 'ABCDEF', { 'X-Auction-Operation': 'delete-room', ...extra });
}
function profileRequest(userId: string, name: string) {
  return new Request(`https://room.test/internal/users/${encodeURIComponent(userId)}/profile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auction-Operation': 'update-profile',
      'X-Auction-Request-Id': 'req-profile',
    },
    body: JSON.stringify({ name }),
  });
}
async function startAuction(room: RoomDurableObject) {
  const created = await create(room);
  expect(created.status).toBe(201);
  const { inviteToken } = await payload(created);
  expect((await join(room, guest, inviteToken)).status).toBe(200);
  for (const action of [
    { id: 'a-claim-h', type: 'claim', teamId: 't1' },
    { id: 'a-claim-g', type: 'claim', teamId: 't2' },
    { id: 'a-ready-h', type: 'ready' },
    { id: 'a-ready-g', type: 'ready' },
    { id: 'a-start', type: 'start' },
  ] satisfies Action[]) {
    const user = action.id.endsWith('-g') ? guest : host;
    const response = await act(room, user, action);
    expect(response.status).toBe(200);
  }
  return inviteToken;
}
function seedLive(ctx: FakeState, now: number, timerSeconds = 10): Room {
  let room = createRoom('ABCDEF', host, makeSettings({ timerSeconds }), now);
  room.members.push({ ...guest, connected: true, ready: false, lastSeen: now });
  for (const [user, action] of [
    [host, { id: 'seed-claim-h', type: 'claim', teamId: 't1' }],
    [guest, { id: 'seed-claim-g', type: 'claim', teamId: 't2' }],
    [host, { id: 'seed-ready-h', type: 'ready' }],
    [guest, { id: 'seed-ready-g', type: 'ready' }],
    [host, { id: 'seed-start', type: 'start' }],
  ] satisfies [User, Action][]) room = applyAction(room, user.id, action, now);
  const storage = new SqliteRoomStorage(driverFor(ctx));
  storage.transaction(() => ({ next: { room, inviteHash: 'seed', inviteExpires: now + 86400000, receipts: {} }, result: null }));
  return room;
}

describe('RoomDurableObject', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    (globalThis as unknown as { WebSocketPair: typeof FakePair }).WebSocketPair = FakePair;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { WebSocketPair?: typeof FakePair }).WebSocketPair;
  });

  it.each([['quick', 80], ['standard', 120], ['mega', 250]] as const)(
    'runs every %s lot in order and completes a persisted recall round (%i initial lots)', async (mode, total) => {
      const { db, ctx, room } = setup();
      let actor = room;
      try {
        const created = await create(actor, host, makeSettings({ budget: 8000, maxSquad: 8, maxOverseas: 8, autoAdvance: true, lateExtension: false }));
        expect(created.status).toBe(201);
        expect((await join(actor, guest, (await payload(created)).inviteToken)).status).toBe(200);
        let sequence = 0;
        async function send(user: User, action: Omit<Action, 'id'> & Record<string, unknown>) {
          const response = await act(actor, user, { ...action, id: 'catalog-' + ++sequence } as Action);
          expect(response.status).toBe(200);
        }
        const stored = () => actor.storage.read()!.room;
        async function finishLot(deadline: number) {
          vi.setSystemTime(deadline - 1000);
          expect((await stateRequest(actor, host)).status).toBe(200);
          vi.setSystemTime(deadline);
          await actor.alarm();
          const settled = stored();
          expect(settled.status).toBe('RESULT');
          return settled;
        }
        async function advance(resultAt: number) {
          vi.setSystemTime(resultAt);
          await actor.alarm();
        }
        await send(host, { type: 'claim', teamId: 't1' });
        await send(guest, { type: 'claim', teamId: 't2' });
        await send(host, { type: 'plan-preview', mode });
        await send(host, { type: 'plan-regenerate', mode });
        await send(host, { type: 'plan-approve', planVersion: 2 });
        const order = stored().plan!.orderedPlayerIds;
        expect(new Set(order).size).toBe(total);
        for (const [index, id] of order.entries()) {
          const state = stored(), player = state.players[state.currentPlayerIndex]!;
          expect([state.status, player.id, player.status]).toEqual(['LIVE', id, 'open']);
          if (index === 0) await send(host, { type: 'bid', amount: player.basePrice, playerId: id, expectedVersion: state.version });
          const settled = await finishLot(state.deadline!);
          expect(settled.players.find(p => p.id === id)?.status).toBe(index === 0 ? 'sold' : 'unsold');
          if (index < total - 1) await advance(settled.resultAt!);
        }
        expect(stored()).toMatchObject({ status: 'RESULT', resultAt: null, recallRound: { status: 'offered' } });
        actor = new TestRoom(ctx);
        const guestView = (await payload(await stateRequest(actor, guest))).room;
        expect(guestView.recallSummary.status).toBe('offered');
        expect(guestView.plan).toBeUndefined();
        const denied = await act(actor, guest, { id: 'guest-recall', type: 'start-recall' });
        expect(await payload(denied)).toMatchObject({ code: 'HOST_ONLY' });
        await stateRequest(actor, host);
        await send(host, { type: 'start-recall' });
        const recallIds = order.slice(1);
        expect(stored().recallRound).toMatchObject({ status: 'active', playerIds: recallIds });
        const current = stored().players[stored().currentPlayerIndex]!;
        const bid = { id: 'recall-purchase', type: 'bid', amount: current.basePrice, playerId: current.id, expectedVersion: stored().version } as const;
        expect((await act(actor, host, bid)).status).toBe(200);
        expect((await act(actor, host, bid)).status).toBe(200);
        const stale = await act(actor, host, { ...bid, id: 'stale-recall-bid' });
        expect(await payload(stale)).toMatchObject({ code: 'STALE_VERSION' });
        const activeView = (await payload(await stateRequest(actor, guest))).room;
        expect(activeView.recallRound).toBeUndefined();
        expect(activeView.recallSummary).toMatchObject({ status: 'active', position: 1, total: total - 1 });
        actor = new TestRoom(ctx);
        const recovered = (await payload(await stateRequest(actor, host))).room;
        expect(recovered).toMatchObject({ status: 'PAUSED', currentBid: bid.amount, leadingTeamId: 't1', recallSummary: activeView.recallSummary });
        expect(stored().players[stored().currentPlayerIndex]?.id).toBe(current.id);
        await send(host, { type: 'resume' });
        for (const id of recallIds) {
          const state = stored();
          expect(state.players[state.currentPlayerIndex]?.id).toBe(id);
          const settled = await finishLot(state.deadline!);
          await advance(settled.resultAt!);
        }
        actor = new TestRoom(ctx);
        const final = (await payload(await stateRequest(actor, host))).room as Room;
        expect(final).toMatchObject({ status: 'COMPLETED', completion_reason: 'POOL_EXHAUSTED' });
        const results = deriveAuctionResults(final);
        expect(results.sold.map(p => p.id).sort()).toEqual(order.slice(0, 2).sort());
        expect(results.unsold).toHaveLength(total - 2);
        expect(results.unauctioned).toHaveLength(0);
        expect(final.teams[0]!.squad).toHaveLength(2);
        expect(final.teams[0]!.budget + results.totalSpent).toBe(8000);
        const repeated = await act(actor, host, { id: 'second-recall', type: 'start-recall' });
        expect(await payload(repeated)).toMatchObject({ code: 'RECALL_UNAVAILABLE' });
      } finally { db.close(); }
    }, 45_000,
  );

  it('creates one room, returns an invite and serves authorized state', async () => {
    const { ctx, room } = setup();
    const created = await create(room);
    expect(created.status).toBe(201);
    const body = await payload(created);
    expect(body.room.code).toBe('ABCDEF');
    expect(body.room.status).toBe('WAITING');
    expect(body.room.members[0]).toMatchObject({ id: host.id, name: host.name, connected: true });
    expect(typeof body.inviteToken).toBe('string');
    const stored = room.storage.read()!;
    expect(stored.inviteHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.inviteHash).not.toBe(body.inviteToken);
    expect(JSON.stringify(stored)).not.toContain(body.inviteToken);
    expect(ctx.alarmAt).toBeNull();
    const current = await stateRequest(room, host);
    expect(current.status).toBe(200);
    expect((await payload(current)).room.code).toBe('ABCDEF');
  });

  it('refuses a second create for an allocated code', async () => {
    const { room } = setup();
    expect((await create(room)).status).toBe(201);
    const collision = await create(room);
    expect(collision.status).toBe(409);
    expect(await payload(collision)).toMatchObject({ code: 'ROOM_EXISTS' });
  });

  it('keeps missing, non-member and malformed probes private without leaking room state', async () => {
    const { ctx, room } = setup();
    await create(room);
    for (const response of [
      await stateRequest(room, guest),
      await historyRequest(room, guest),
      await syncRequest(room, guest),
      await authorizeRequest(room, guest),
    ]) {
      expect(response.status).toBe(404);
      const body = await payload(response);
      expect(body).toMatchObject({ code: 'ROOM_NOT_FOUND', message: PRIVATE });
      expect(body.room).toBeUndefined();
    }
    const malformed = await room.fetch(request('/api/rooms/ABCDE', host));
    expect(malformed.status).toBe(404);
    expect(await payload(malformed)).toMatchObject({ code: 'ROOM_NOT_FOUND', message: PRIVATE });
    const mismatch = await room.fetch(request('/api/rooms/BBBBBB', host));
    expect(mismatch.status).toBe(404);
    expect(ctx.getWebSockets()).toHaveLength(0);
  });

  it('joins with the current invite, rejects a wrong invite and hides the room', async () => {
    const { room } = setup();
    const { inviteToken } = await payload(await create(room));
    const wrong = await join(room, guest, 'wrong-token');
    expect(wrong.status).toBe(404);
    expect((await payload(wrong)).room).toBeUndefined();
    const joined = await join(room, guest, inviteToken);
    expect(joined.status).toBe(200);
    expect((await payload(joined)).room.members.map((member: User) => member.id)).toEqual([host.id, guest.id]);
  });

  it('applies actions idempotently, rejects reused IDs and stale versions, and returns state with action errors', async () => {
    const { ctx, room } = setup();
    await create(room);
    const first = await act(room, host, { id: 'action-1', type: 'claim', teamId: 't1' });
    expect(first.status).toBe(200);
    const version = (await payload(first)).room.version;
    const retry = await act(room, host, { id: 'action-1', type: 'claim', teamId: 't1' });
    expect(retry.status).toBe(200);
    expect((await payload(retry)).room.version).toBe(version);
    const revived = new TestRoom(ctx);
    await revived.ready;
    const revivedRetry = await act(revived, host, { id: 'action-1', type: 'claim', teamId: 't1' });
    expect(revivedRetry.status).toBe(200);
    expect((await payload(revivedRetry)).room.version).toBe(version);
    const reused = await act(room, host, { id: 'action-1', type: 'claim', teamId: 't2' });
    expect(reused.status).toBe(400);
    const reusedBody = await payload(reused);
    expect(reusedBody).toMatchObject({ code: 'ID_REUSED' });
    expect(reusedBody.room.code).toBe('ABCDEF');
    const stale = await act(room, host, { id: 'action-2', type: 'claim', teamId: 't2', expectedVersion: 0 });
    expect(stale.status).toBe(400);
    expect(await payload(stale)).toMatchObject({ code: 'STALE_VERSION' });
  });

  it('starts an auction, settles on an alarm, advances the next lot and is idempotent on retry', async () => {
    const { ctx, room } = setup();
    await room.ready;
    const now = Date.now();
    seedLive(ctx, now, 10);
    vi.setSystemTime(now + 9000);
    expect((await stateRequest(room, host)).status).toBe(200);
    expect(ctx.alarmAt).toBe(now + 10000);
    vi.setSystemTime(now + 11000);
    const before = room.storage.read()!.room.version;
    await room.alarm();
    const settled = room.storage.read()!.room;
    expect(settled.status).toBe('RESULT');
    expect(settled.players[settled.currentPlayerIndex]!.status).toBe('unsold');
    expect(settled.version).toBeGreaterThan(before);
    expect(ctx.alarmAt).toBe(settled.resultAt);
    const version = settled.version;
    await room.alarm();
    expect(room.storage.read()!.room.version).toBe(version);
    expect(room.storage.read()!.room.status).toBe('RESULT');
    vi.setSystemTime(now + 14000);
    await room.alarm();
    const next = room.storage.read()!.room;
    expect(next.status).toBe('LIVE');
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.history.filter(item => item.type === 'player_open')).toHaveLength(2);
    // The host last heartbeated at now+9000, so the next slot is the absence check before the new deadline.
    expect(ctx.alarmAt).toBe(now + 19001);
  });

  it('retries an alarm idempotently after a new object instance', async () => {
    const { ctx, room } = setup();
    await room.ready;
    const now = Date.now();
    seedLive(ctx, now, 10);
    vi.setSystemTime(now + 11000);
    await room.alarm();
    const settled = room.storage.read()!.room;
    expect(settled.status).toBe('RESULT');
    const version = settled.version;
    const revived = new TestRoom(ctx);
    await revived.ready;
    await revived.alarm();
    expect(revived.storage.read()!.room.version).toBe(version);
    expect(revived.storage.read()!.room.status).toBe('RESULT');
    expect(revived.storage.read()!.room.resultAt).toBe(settled.resultAt);
  });

  it('pauses a live room when the host is absent and resumes after reconnect', async () => {
    const { ctx, room } = setup();
    await room.ready;
    const now = Date.now();
    seedLive(ctx, now, 30);
    vi.setSystemTime(now + 11000);
    await room.alarm();
    const paused = room.storage.read()!.room;
    expect(paused.status).toBe('PAUSED');
    expect(paused.pausedRemaining).toBe(20000);
    expect(paused.members.every(member => !member.connected)).toBe(true);
    expect(ctx.alarmAt).toBeNull();
    vi.setSystemTime(now + 12000);
    expect((await stateRequest(room, host)).status).toBe(200);
    expect(room.storage.read()!.room.status).toBe('PAUSED');
    const resumed = await act(room, host, { id: 'resume-1', type: 'resume' });
    expect(resumed.status).toBe(200);
    expect((await payload(resumed)).room.status).toBe('LIVE');
  });

  it('recovers a persisted live room on wake, disconnecting members and pausing the lot', async () => {
    const { ctx } = setup();
    const now = Date.now();
    seedLive(ctx, now, 30);
    const revived = new TestRoom(ctx);
    await revived.ready;
    const room = revived.storage.read()!.room;
    expect(room.status).toBe('PAUSED');
    expect(room.pauseReason).toBe('Service restarted; host must resume');
    expect(room.pausedRemaining).toBe(30000);
    expect(room.members.every(member => !member.connected)).toBe(true);
    expect(room.history.at(-1)!.text).toBe('Service restarted; host must resume');
    expect(ctx.alarmAt).toBeNull();
  });

  it('rotates the invite, invalidating the old link and refusing non-hosts', async () => {
    const { room } = setup();
    const { inviteToken: oldToken } = await payload(await create(room));
    const rotated = await inviteRequest(room, host);
    expect(rotated.status).toBe(200);
    const { inviteToken: newToken } = await payload(rotated);
    expect(newToken).not.toBe(oldToken);
    expect((await join(room, guest, oldToken)).status).toBe(404);
    expect((await join(room, guest, newToken)).status).toBe(200);
    const denied = await inviteRequest(room, guest);
    expect(denied.status).toBe(403);
    expect(await payload(denied)).toMatchObject({ code: 'HOST_ONLY' });
  });

  it('pages history and replays events with the same bounds as the local store', async () => {
    const { room } = setup();
    await startAuction(room);
    const page = await historyRequest(room, host, '?limit=2');
    expect(page.status).toBe(200);
    const body = await payload(page);
    expect(body.events).toHaveLength(2);
    expect(body.nextBefore).toBe(body.events.at(-1).version);
    const older = await payload(await historyRequest(room, host, `?before=${body.nextBefore}&limit=2`));
    expect(older.events.every((item: { version: number }) => item.version < body.nextBefore)).toBe(true);
    expect((await historyRequest(room, host, '?limit=0')).status).toBe(400);
    const replay = await payload(await syncRequest(room, host, '?afterVersion=0'));
    expect(replay.replay.afterVersion).toBe(0);
    expect(replay.replay.resetRequired).toBe(false);
    expect(replay.replay.events.length).toBeGreaterThan(0);
    const reset = await payload(await syncRequest(room, host, '?afterVersion=999999'));
    expect(reset.replay.resetRequired).toBe(true);
    expect(reset.replay.events).toEqual([]);
    expect((await syncRequest(room, host, '?afterVersion=bad')).status).toBe(400);
  });

  it('leaves the lobby, revokes the member and preserves the host room', async () => {
    const { room } = setup();
    const { inviteToken } = await payload(await create(room));
    await join(room, guest, inviteToken);
    const left = await act(room, guest, { id: 'leave-1', type: 'leave' });
    expect(left.status).toBe(200);
    expect(await payload(left)).toEqual({ left: true, serverNow: Date.now() });
    expect((await stateRequest(room, guest)).status).toBe(404);
    expect((await payload(await stateRequest(room, host))).room.members.map((member: User) => member.id)).toEqual([host.id]);
  });

  it('accepts a hibernating socket, broadcasts snapshots and answers pings', async () => {
    const { ctx, room } = setup();
    const { inviteToken } = await payload(await create(room));
    await join(room, guest, inviteToken);
    const upgraded = await upgradeRequest(room, host);
    expect(upgraded.status).toBe(101);
    const [server] = ctx.getWebSockets(host.id) as FakeSocket[];
    expect(server).toBeDefined();
    expect(server!.sent.length).toBeGreaterThan(0);
    expect(JSON.parse(server!.sent.at(-1)!)).toMatchObject({ type: 'snapshot', room: { code: 'ABCDEF' } });
    const action = await act(room, host, { id: 'socket-claim', type: 'claim', teamId: 't1' });
    const version = (await payload(action)).room.version;
    expect(JSON.parse(server!.sent.at(-1)!).room.version).toBe(version);
    await room.webSocketMessage(server!, JSON.stringify({ type: 'ping', clientSentAt: 123 }));
    expect(JSON.parse(server!.sent.at(-1)!)).toMatchObject({ type: 'pong', clientSentAt: 123 });
    server!.readyState = 3;
    await room.webSocketClose(server!, 1000, 'done', true);
    const closed = room.storage.read()!.room;
    expect(closed.members.find(member => member.id === host.id)!.connected).toBe(false);
    expect(closed.history.at(-1)!.type).toBe('disconnected');
  });

  it('survives hibernation with the socket attachment and existing connections', async () => {
    const { ctx, room } = setup();
    const { inviteToken } = await payload(await create(room));
    await join(room, guest, inviteToken);
    await upgradeRequest(room, host);
    await upgradeRequest(room, guest);
    const hostSocket = (ctx.getWebSockets(host.id) as FakeSocket[])[0]!;
    const guestSocket = (ctx.getWebSockets(guest.id) as FakeSocket[])[0]!;
    const before = hostSocket.sent.length;
    const revived = new TestRoom(ctx);
    await revived.ready;
    expect(revived.storage.read()!.room.members.every(member => member.connected)).toBe(true);
    await revived.webSocketMessage(guestSocket, JSON.stringify({ type: 'ping', clientSentAt: 7 }));
    expect(hostSocket.sent.length).toBe(before);
    expect(JSON.parse(guestSocket.sent.at(-1)!)).toMatchObject({ type: 'pong', clientSentAt: 7 });
  });

  it('rejects socket upgrades without membership, a matching room or an upgrade', async () => {
    const { ctx, room } = setup();
    const { inviteToken } = await payload(await create(room));
    expect((await upgradeRequest(room, guest)).status).toBe(404);
    expect(ctx.getWebSockets()).toHaveLength(0);
    expect((await upgradeRequest(room, host, 'BBBBBB')).status).toBe(404);
    const plain = await room.fetch(request('/ws?room=ABCDEF', host));
    expect(plain.status).toBe(426);
    await join(room, guest, inviteToken);
    expect((await upgradeRequest(room, guest)).status).toBe(101);
  });

  it('maps malformed bodies, missing identity and invalid settings to JSON errors', async () => {
    const { room } = setup();
    const noUser = await room.fetch(new Request('https://room.test/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auction-Room-Code': 'ABCDEF' }, body: '{}',
    }));
    expect(noUser.status).toBe(403);
    const invalid = await create(room, host, { teamCount: 99 });
    expect(invalid.status).toBe(400);
    expect(await payload(invalid)).toMatchObject({ code: 'INVALID_INPUT' });
    const badJson = await room.fetch(request('/api/rooms/ABCDEF/actions', host, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    }));
    expect(badJson.status).toBe(400);
    expect(await payload(badJson)).toMatchObject({ code: 'INVALID_INPUT' });
    await create(room);
    const badAction = await room.fetch(request('/api/rooms/ABCDEF/actions', host, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'unknown' }),
    }));
    expect(badAction.status).toBe(400);
    expect(await payload(badAction)).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('indexes rooms through the durable outbox without event history', async () => {
    const directory = new FakeDirectory();
    const { ctx, room } = setup({ DIRECTORY: directory });
    const created = await create(room);
    expect(created.status).toBe(201);
    expect(directory.names).toEqual(['global']);
    expect(outbox(ctx)).toHaveLength(0);
    const indexed = JSON.parse(await directory.stub.requests[0]!.text()) as { room: Room; now: number };
    expect(indexed.room.code).toBe('ABCDEF');
    expect(indexed.room.history).toEqual([]);
    expect(indexed.room.members.map(member => member.id)).toEqual([host.id]);
    expect(indexed.now).toBe(Date.now());

    const { inviteToken } = await payload(created);
    await join(room, guest, inviteToken);
    const joined = JSON.parse(await directory.stub.requests.at(-1)!.text()) as { room: Room };
    expect(joined.room.members.map(member => member.id)).toEqual([host.id, guest.id]);
    expect(joined.room.history).toEqual([]);
    expect(outbox(ctx)).toHaveLength(0);
  });

  it('keeps outbox entries through a failed delivery and flushes them after wake', async () => {
    let failing = true;
    const directory = new FakeDirectory(() => failing
      ? Response.json({ code: 'SERVICE_ERROR' }, { status: 500 })
      : Response.json({ ok: true }));
    const { ctx, room } = setup({ DIRECTORY: directory });
    expect((await create(room)).status).toBe(201);
    expect(outbox(ctx)).toHaveLength(1);

    failing = false;
    const revived = new TestRoom(ctx, { DIRECTORY: directory });
    await revived.ready;
    expect(outbox(ctx)).toHaveLength(0);
    expect(directory.stub.requests.length).toBeGreaterThanOrEqual(2);
  });

  it('discards a permanently invalid outbox entry instead of blocking later updates', async () => {
    let first = true;
    const directory = new FakeDirectory(() => {
      if (first) { first = false; return Response.json({ code: 'INVALID_INPUT' }, { status: 400 }); }
      return Response.json({ ok: true });
    });
    const { ctx, room } = setup({ DIRECTORY: directory });
    expect((await create(room)).status).toBe(201);
    expect(directory.stub.requests).toHaveLength(1);
    expect(outbox(ctx)).toHaveLength(0);
    expect((await stateRequest(room, host)).status).toBe(200);
  });

  it('updates a member display name once and indexes the new label', async () => {
    const directory = new FakeDirectory();
    const { room } = setup({ DIRECTORY: directory });
    const { inviteToken } = await payload(await create(room));
    await join(room, guest, inviteToken);
    directory.stub.requests.length = 0;

    const response = await room.fetch(profileRequest(guest.id, '  Renamed   Guest '));
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ updated: true, missing: false });
    const stored = room.storage.read()!;
    expect(stored.room.members.find(member => member.id === guest.id)?.name).toBe('Renamed Guest');
    expect(stored.room.history.at(-1)).toMatchObject({ type: 'profile_updated', actorId: guest.id });
    const indexed = JSON.parse(await directory.stub.requests.at(-1)!.text()) as { room: Room };
    expect(indexed.room.members.find(member => member.id === guest.id)?.name).toBe('Renamed Guest');

    const version = stored.room.version;
    const repeated = await room.fetch(profileRequest(guest.id, 'Renamed Guest'));
    expect(await payload(repeated)).toMatchObject({ updated: true, missing: false });
    expect(room.storage.read()!.room.version).toBe(version);
    const missing = await room.fetch(profileRequest('user_missing', 'Someone Else'));
    expect(await payload(missing)).toEqual({ updated: false, missing: true });
  });

  it('anonymizes a member on account deletion and indexes the redacted room', async () => {
    const directory = new FakeDirectory();
    const { room } = setup({ DIRECTORY: directory });
    const { inviteToken } = await payload(await create(room));
    await join(room, guest, inviteToken);
    directory.stub.requests.length = 0;

    const response = await room.fetch(deleteUserRequest(guest.id));
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ removed: false, missing: false });
    const stored = room.storage.read()!;
    expect(stored.room.members.map(member => member.id)).not.toContain(guest.id);
    expect(stored.room.members.some(member => member.id.startsWith('deleted_'))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(guest.name);
    const indexed = JSON.parse(await directory.stub.requests.at(-1)!.text()) as { room: Room };
    expect(indexed.room.members.map(member => member.id)).not.toContain(guest.id);
    expect(indexed.room.history).toEqual([]);
  });

  it('removes a sole-member room and tells the directory to remove it', async () => {
    const directory = new FakeDirectory();
    const { room } = setup({ DIRECTORY: directory });
    await create(room);
    directory.stub.requests.length = 0;

    const response = await room.fetch(deleteUserRequest(host.id));
    expect(await payload(response)).toEqual({ removed: true, missing: false });
    expect(room.storage.read()).toBeNull();
    expect(directory.stub.requests.at(-1)!.url).toContain('/internal/rooms/ABCDEF/remove');
    expect(JSON.parse(await directory.stub.requests.at(-1)!.text())).toMatchObject({
      code: 'ABCDEF', version: expect.any(Number), now: expect.any(Number),
    });
  });

  it('reports a missing room so a retried deletion can finish directory cleanup', async () => {
    const { room } = setup();
    const response = await room.fetch(deleteUserRequest('user_missing'));
    expect(response.status).toBe(200);
    expect(await payload(response)).toEqual({ removed: false, missing: true });
  });

  it('deletes a closed room, wipes every table, closes sockets and cleans the directory', async () => {
    const directory = new FakeDirectory();
    const { ctx, room } = setup({ DIRECTORY: directory });
    await create(room);
    expect((await act(room, host, { id: 'close-room', type: 'end' })).status).toBe(200);
    expect(room.storage.read()!.room.status).toBe('CLOSED');
    expect((await upgradeRequest(room, host)).status).toBe(101);
    const socket = (ctx.getWebSockets(host.id) as FakeSocket[])[0]!;

    const response = await room.fetch(roomDeleteRequest(host));
    expect(response.status).toBe(200);
    expect(await payload(response)).toMatchObject({ deleted: true, alreadyDeleted: false });
    expect(room.storage.read()).toBeNull();
    expect(socket.closed).toEqual({ code: 1001, reason: 'Room deleted' });
    expect(ctx.alarmAt).toBeNull();
    expect(ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").toArray())
      .toEqual(['room_directory_outbox', 'room_events', 'room_receipts', 'room_schema', 'room_state']
        .map(name => ({ name })));
    for (const table of ['room_state', 'room_events', 'room_receipts', 'room_directory_outbox']) {
      expect(ctx.storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`).toArray()[0]!.count).toBe(0);
    }

    const cleanup = directory.stub.requests.at(-1)!;
    expect(new URL(cleanup.url).pathname).toBe('/internal/rooms/ABCDEF/delete');
    expect(cleanup.headers.get('x-auction-internal')).toBe('room');
    expect(JSON.parse(await cleanup.text())).toMatchObject({ now: expect.any(Number) });
    expect((await stateRequest(room, host)).status).toBe(404);

    const repeated = await room.fetch(roomDeleteRequest(host));
    expect(repeated.status).toBe(200);
    expect(await payload(repeated)).toMatchObject({ deleted: true, alreadyDeleted: true });
    expect(directory.stub.requests.filter(request => new URL(request.url).pathname.endsWith('/delete'))).toHaveLength(2);
  });

  it('refuses deletion by non-hosts, active rooms and untrusted callers without wiping state', async () => {
    const directory = new FakeDirectory();
    const { room } = setup({ DIRECTORY: directory });
    await create(room);

    const active = await room.fetch(roomDeleteRequest(host));
    expect(active.status).toBe(409);
    expect(await payload(active)).toMatchObject({ code: 'ROOM_ACTIVE' });
    expect(room.storage.read()!.room.status).toBe('WAITING');

    expect((await act(room, host, { id: 'close-room', type: 'end' })).status).toBe(200);
    const foreign = await room.fetch(roomDeleteRequest(guest));
    expect(foreign.status).toBe(403);
    expect(await payload(foreign)).toMatchObject({ code: 'HOST_ONLY' });
    expect(room.storage.read()!.room.status).toBe('CLOSED');

    const untrusted = await room.fetch(request('/api/rooms/ABCDEF', host, { method: 'DELETE' }));
    expect(untrusted.status).toBe(404);
    expect(await payload(untrusted)).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    expect(room.storage.read()).not.toBeNull();
    expect(directory.stub.requests.some(request => new URL(request.url).pathname.endsWith('/delete'))).toBe(false);
  });

  it('wipes the room before a directory failure and converges on retry', async () => {
    let failing = true;
    const directory = new FakeDirectory(() => failing
      ? Response.json({ code: 'SERVICE_ERROR' }, { status: 500 })
      : Response.json({ deleted: true, removed: true }));
    const { room } = setup({ DIRECTORY: directory });
    await create(room);
    expect((await act(room, host, { id: 'close-room', type: 'end' })).status).toBe(200);

    const failed = await room.fetch(roomDeleteRequest(host));
    expect(failed.status).toBe(502);
    expect(await payload(failed)).toMatchObject({ code: 'DELETION_INCOMPLETE' });
    expect(room.storage.read()).toBeNull();
    expect(await payload(await stateRequest(room, host))).toMatchObject({ code: 'ROOM_NOT_FOUND' });

    failing = false;
    const retried = await room.fetch(roomDeleteRequest(host));
    expect(retried.status).toBe(200);
    expect(await payload(retried)).toMatchObject({ deleted: true, alreadyDeleted: true });
  });

  it('blocks code reuse until the deletion has written the directory tombstone', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let tombstoneStarted!: () => void;
    const started = new Promise<void>(resolve => { tombstoneStarted = resolve; });
    const directory = new FakeDirectory(async request => {
      if (new URL(request.url).pathname.endsWith('/delete')) { tombstoneStarted(); await gate; }
      return Response.json({ ok: true });
    });
    const { room } = setup({ DIRECTORY: directory });
    await create(room);
    expect((await act(room, host, { id: 'close-room', type: 'end' })).status).toBe(200);

    const deletion = room.fetch(roomDeleteRequest(host));
    await started;
    expect(room.storage.read()).toBeNull();
    const reuse = await create(room);
    expect(reuse.status).toBe(409);
    expect(await payload(reuse)).toMatchObject({ code: 'ROOM_DELETING' });

    release();
    expect((await deletion).status).toBe(200);
    const recreated = await create(room);
    expect(recreated.status).toBe(201);
    expect((await payload(recreated)).room.code).toBe('ABCDEF');
  });

  it('keeps an approved auction plan across hibernation and hides its order', async () => {
    const { ctx, room } = setup();
    const created = await create(room);
    const { inviteToken } = await payload(created);
    expect((await join(room, guest, inviteToken)).status).toBe(200);
    for (const action of [
      { id: 'plan-claim-h', type: 'claim', teamId: 't1' },
      { id: 'plan-claim-g', type: 'claim', teamId: 't2' },
      { id: 'plan-preview', type: 'plan-preview', mode: 'standard' },
    ] satisfies Action[]) {
      const user = action.id.endsWith('-g') ? guest : host;
      expect((await act(room, user, action)).status).toBe(200);
    }
    const previewResponse = await room.fetch(request('/api/rooms/ABCDEF/plan', host));
    expect(previewResponse.status).toBe(200);
    const preview = await payload(previewResponse);
    expect(preview.plan.approved).toBe(false);
    expect(preview.plan.counts.total).toBe(120);
    expect(preview.plan.sets).toHaveLength(15);
    expect((await room.fetch(request('/api/rooms/ABCDEF/plan', guest))).status).toBe(403);

    const approved = await act(room, host, { id: 'plan-approve', type: 'plan-approve', planVersion: preview.plan.planVersion });
    expect(approved.status).toBe(200);
    const approvedRoom = (await payload(approved)).room;
    expect(approvedRoom.status).toBe('LIVE');
    expect(approvedRoom.plan).toBeUndefined();
    expect(approvedRoom.planDraft).toBeUndefined();
    expect(approvedRoom.planSummary).toMatchObject({ mode: 'standard', position: 1, total: 120, remaining: 119 });
    const stored = room.storage.read()!.room;
    expect(stored.plan!.orderedPlayerIds).toHaveLength(120);
    expect(new Set(stored.plan!.orderedPlayerIds).size).toBe(120);
    expect(stored.players[stored.currentPlayerIndex]!.id).toBe(stored.plan!.orderedPlayerIds[0]);
    expect(JSON.stringify(approvedRoom)).not.toContain(stored.plan!.seed);
    expect(JSON.stringify(approvedRoom)).not.toContain('orderedPlayerIds');

    const csv = await room.fetch(request('/api/rooms/ABCDEF/plan/export', host));
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect((await csv.text()).trim().split(/\r?\n/)).toHaveLength(121);
    expect((await room.fetch(request('/api/rooms/ABCDEF/plan/export', guest))).status).toBe(403);

    const revived = new TestRoom(ctx);
    const revivedState = await stateRequest(revived, host);
    expect(revivedState.status).toBe(200);
    const revivedRoom = (await payload(revivedState)).room;
    expect(revivedRoom.plan).toBeUndefined();
    expect(revivedRoom.planSummary).toMatchObject({ mode: 'standard', position: 1, total: 120 });
    const revivedStored = revived.storage.read()!.room;
    expect(revivedStored.plan).toEqual(stored.plan);
    expect(revivedStored.currentPlayerIndex).toBe(stored.currentPlayerIndex);

    for (const action of [
      { id: 'plan-late-preview', type: 'plan-preview', mode: 'mega' },
      { id: 'plan-late-regen', type: 'plan-regenerate', mode: 'mega' },
      { id: 'plan-late-approve', type: 'plan-approve', planVersion: 1 },
    ] satisfies Action[]) {
      const response = await act(revived, host, action);
      expect(response.status).toBe(400);
      expect(await payload(response)).toMatchObject({ code: 'PLAN_LOCKED' });
    }
  });
});
