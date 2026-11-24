import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Settings } from '../../packages/shared/src/index';
import { settingsSchema, type Action } from '../../packages/shared/src/index';
import type { Room, User } from '../../packages/shared/src/domain';
import { applyAction, createRoom } from '../../packages/engine/src/index';
import type { SqlValue } from '../../packages/storage/src/port';
import { DirectoryDurableObject, type DirectoryStateLike } from '../../apps/api/src/worker/directory-do';
import type { DoSql, DoStorage } from '../../apps/api/src/worker/room-do';

const host: User = { id: 'user_host', name: 'Host' };
const guest: User = { id: 'user_guest', name: 'Guest' };
const now = 1_800_000_000_000;
const settings: Settings = settingsSchema.parse({
  teamCount: 2, minSquad: 1, maxSquad: 2, budget: 1000, timerSeconds: 10, resultSeconds: 2,
});

class FakeState implements DirectoryStateLike {
  readonly storage: DoStorage;
  alarmAt: number | null = null;
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
}

function waitingRoom(code = 'ABCDEF'): Room {
  const room = createRoom(code, host, settings, now);
  room.members.push({ ...guest, connected: true, ready: false, lastSeen: now });
  return room;
}
function completedRoom(code = 'ABCDEF'): Room {
  let room = waitingRoom(code);
  for (const [user, action] of [
    [host, { id: 'claim-h', type: 'claim', teamId: 't1' }],
    [guest, { id: 'claim-g', type: 'claim', teamId: 't2' }],
    [host, { id: 'ready-h', type: 'ready' }],
    [guest, { id: 'ready-g', type: 'ready' }],
    [host, { id: 'start', type: 'start' }],
    [guest, { id: 'bid', type: 'bid', playerId: 'p1', amount: 100 }],
    [host, { id: 'end', type: 'end' }],
  ] satisfies [User, Action][]) room = applyAction(room, user.id, action, now);
  return room;
}
function internal(path: string, init: RequestInit = {}) {
  return new Request(`https://directory.test${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Auction-Internal': 'worker',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
function post(path: string, body: unknown) {
  return internal(path, { method: 'POST', body: JSON.stringify(body) });
}
async function json(response: Response) { return await response.json() as Record<string, any>; }

function setup() {
  const db = new DatabaseSync(':memory:');
  const state = new FakeState(db);
  return { db, state, object: new DirectoryDurableObject(state) };
}

describe('DirectoryDurableObject', () => {
  it('rejects requests that did not come from the Worker or a room object', async () => {
    const { object } = setup();
    const response = await object.fetch(new Request('https://directory.test/internal/users/user_host/rooms'));
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('upserts, lists, exports and removes a room through internal routes', async () => {
    const { object } = setup();
    const room = waitingRoom();
    const upserted = await object.fetch(post('/internal/rooms', { room, now }));
    expect(upserted.status).toBe(200);
    expect(await json(upserted)).toMatchObject({ room: { code: 'ABCDEF', memberCount: 2, version: room.version } });

    const listed = await object.fetch(internal('/internal/users/user_guest/rooms'));
    expect(await json(listed)).toEqual({
      rooms: [{ code: 'ABCDEF', name: room.name, status: 'WAITING', role: 'member', memberCount: 2, updatedAt: now }],
    });
    const exported = await object.fetch(internal('/internal/users/user_host/export?name=Host&now=1800000001000'));
    expect(exported.status).toBe(200);
    const body = await json(exported);
    expect(body).toMatchObject({ user: host, exportedAt: now + 1000 });
    expect(body.rooms).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(guest.id);

    expect((await object.fetch(post('/internal/rooms/ABCDEF/remove', { version: 'bad' }))).status).toBe(400);
    const removed = await object.fetch(post('/internal/rooms/ABCDEF/remove', { version: room.version }));
    expect(await json(removed)).toEqual({ removed: true });
    expect(await json(await object.fetch(internal('/internal/users/user_host/rooms')))).toEqual({ rooms: [] });
  });

  it('deletes a room and its archive through the internal route idempotently', async () => {
    const { object } = setup();
    await object.fetch(post('/internal/rooms', { room: completedRoom(), now }));
    expect((await json(await object.fetch(internal('/internal/users/user_guest/rooms')))).rooms).toHaveLength(1);

    const first = await object.fetch(post('/internal/rooms/ABCDEF/delete', { now: now + 1000 }));
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ deleted: true, removed: true });
    expect(await json(await object.fetch(internal('/internal/users/user_host/rooms')))).toEqual({ rooms: [] });
    const exported = await json(await object.fetch(internal('/internal/users/user_guest/export?name=Guest&now=1800000002000')));
    expect(exported.rooms).toEqual([]);
    expect(exported.archives).toEqual([]);

    const again = await object.fetch(post('/internal/rooms/ABCDEF/delete', { now: now + 2000 }));
    expect(await json(again)).toEqual({ deleted: true, removed: false });

    const stale = await object.fetch(post('/internal/rooms', { room: completedRoom(), now: now + 3000 }));
    expect(await json(stale)).toMatchObject({ room: null });
    expect(await json(await object.fetch(internal('/internal/users/user_host/rooms')))).toEqual({ rooms: [] });
  });

  it('archives only completed rooms and keeps the archive immutable', async () => {
    const { object } = setup();
    const waiting = await object.fetch(post('/internal/rooms/ABCDEF/archive', { room: waitingRoom(), now }));
    expect(waiting.status).toBe(409);
    expect(await json(waiting)).toMatchObject({ code: 'NOT_ENDED' });

    const room = completedRoom();
    const archived = await object.fetch(post('/internal/rooms/ABCDEF/archive', { room, now }));
    expect(archived.status).toBe(200);
    const archive = (await json(archived)).archive;
    expect(archive).toMatchObject({ code: 'ABCDEF', completedVersion: room.version, participantCount: 2 });
    expect(JSON.stringify(archive)).not.toContain(guest.id);
    expect(JSON.stringify(archive)).not.toContain(guest.name);

    const exported = await json(await object.fetch(internal('/internal/users/user_guest/export?name=Guest&now=1800000002000')));
    expect(exported.archives).toHaveLength(1);
    expect(exported.archives[0]).toEqual(archive);
  });

  it('queues deletion, marks the provider, retries and completes idempotently', async () => {
    const { object } = setup();
    await object.fetch(post('/internal/rooms', { room: completedRoom(), now }));

    const requested = await object.fetch(post('/internal/users/user_guest/deletion', { now: now + 1000 }));
    expect(requested.status).toBe(200);
    expect((await json(requested)).job).toMatchObject({ userId: guest.id, providerDeleted: false, completedAt: null, attempts: 0 });
    expect(await json(await object.fetch(internal('/internal/users/user_guest/deleted')))).toEqual({ deleted: true });
    const denied = await object.fetch(internal('/internal/users/user_guest/export?name=Guest&now=1800000001000'));
    expect(denied.status).toBe(410);
    expect(await json(denied)).toMatchObject({ code: 'ACCOUNT_DELETED' });

    const marked = await object.fetch(post('/internal/users/user_guest/deletion/provider', { now: now + 2000 }));
    expect((await json(marked)).job.providerDeleted).toBe(true);
    const retried = await object.fetch(post('/internal/users/user_guest/deletion/retry', { now: now + 3000 }));
    expect((await json(retried)).job.attempts).toBe(1);
    const completed = await object.fetch(post('/internal/users/user_guest/deletion/complete', { now: now + 4000, removedRooms: [] }));
    expect((await json(completed)).job.completedAt).toBe(now + 4000);
    const again = await object.fetch(post('/internal/users/user_guest/deletion/complete', { now: now + 5000, removedRooms: [] }));
    expect((await json(again)).job.completedAt).toBe(now + 4000);
    const current = await json(await object.fetch(internal('/internal/users/user_guest/deletion')));
    expect(current).toMatchObject({ job: { completedAt: now + 4000, rooms: [] } });
  });

  it('maps malformed JSON, snapshots and unknown routes to JSON errors', async () => {
    const { object } = setup();
    const malformed = await object.fetch(internal('/internal/rooms', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(400);
    expect(await json(malformed)).toMatchObject({ code: 'INVALID_DIRECTORY_STATE' });
    const invalidRoom = await object.fetch(post('/internal/rooms', { room: { code: 'ABCDEF' }, now }));
    expect(invalidRoom.status).toBe(400);
    expect(await json(invalidRoom)).toMatchObject({ code: 'INVALID_DIRECTORY_STATE' });
    expect((await object.fetch(internal('/internal/unknown'))).status).toBe(404);
  });
});
