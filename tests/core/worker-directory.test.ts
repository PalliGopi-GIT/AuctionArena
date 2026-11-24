import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createWorkerApp } from '../../apps/api/src/worker/app';
import { DirectoryDurableObject, type DirectoryStateLike } from '../../apps/api/src/worker/directory-do';
import type { DoSql, DoStorage } from '../../apps/api/src/worker/room-do';
import type {
  DurableObjectIdLike,
  DurableObjectNamespaceLike,
  DurableObjectStubLike,
  IdentityVerifier,
  WorkerEnv,
} from '../../apps/api/src/worker/types';
import type { Settings } from '../../packages/shared/src/index';
import { settingsSchema, type Action } from '../../packages/shared/src/index';
import type { Room, User } from '../../packages/shared/src/domain';
import { applyAction, createRoom } from '../../packages/engine/src/index';
import type { SqlValue } from '../../packages/storage/src/port';

const host: User = { id: 'user_host', name: 'Host' };
const guest: User = { id: 'user_guest', name: 'Guest' };
const now = 1_800_000_000_000;
const settings: Settings = settingsSchema.parse({
  teamCount: 2, minSquad: 1, maxSquad: 2, budget: 1000, timerSeconds: 10, resultSeconds: 2,
});

class FakeState implements DirectoryStateLike {
  readonly storage: DoStorage;
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
      setAlarm: async () => undefined,
      deleteAlarm: async () => undefined,
      getAlarm: async () => null,
      deleteAll: async () => {
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        for (const table of tables) this.db.exec(`DROP TABLE "${table.name}"`);
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
class FakeDirectoryNamespace implements DurableObjectNamespaceLike {
  names: string[] = [];
  constructor(private object: DirectoryDurableObject) {}
  idFromName(name: string): DurableObjectIdLike { this.names.push(name); return { toString: () => name }; }
  get(): DurableObjectStubLike { return { fetch: request => this.object.fetch(request) }; }
}
class FakeRoomStub implements DurableObjectStubLike {
  requests: Request[] = [];
  constructor(private handler: (request: Request, code: string) => Promise<Response> | Response, private code: string) {}
  async fetch(request: Request) { this.requests.push(request); return this.handler(request, this.code); }
}
class FakeRoomNamespace implements DurableObjectNamespaceLike {
  names: string[] = [];
  stubs = new Map<string, FakeRoomStub>();
  constructor(private handler: (request: Request, code: string) => Promise<Response> | Response) {}
  idFromName(name: string): DurableObjectIdLike { this.names.push(name); return { toString: () => name }; }
  get(id: DurableObjectIdLike) {
    const name = id.toString();
    let stub = this.stubs.get(name);
    if (!stub) { stub = new FakeRoomStub(this.handler, name); this.stubs.set(name, stub); }
    return stub;
  }
}
const verify: IdentityVerifier = async token => {
  if (token === 'host' || token === 'fresh-host') return { id: host.id, name: host.name, firstFactorAge: token === 'fresh-host' ? 1 : undefined };
  if (token === 'stale-host') return { id: host.id, name: host.name, firstFactorAge: 10 };
  if (token === 'guest') return { id: guest.id, name: guest.name };
  throw new Error('invalid');
};
const auth = (token = 'host') => ({ Authorization: `Bearer ${token}` });
function environment(room: DurableObjectNamespaceLike, directory?: DurableObjectNamespaceLike): WorkerEnv {
  return {
    ROOM: room, ASSETS: { fetch: async () => new Response('asset') },
    ...(directory ? { DIRECTORY: directory } : {}), CLERK_JWT_KEY: 'test-key', WS_TICKET_SECRET: 'test-secret',
  };
}
function directorySetup() {
  const object = new DirectoryDurableObject(new FakeState(new DatabaseSync(':memory:')));
  return { object, namespace: new FakeDirectoryNamespace(object) };
}
function waitingRoom(code = 'ABCDEF'): Room {
  const room = createRoom(code, host, settings, now);
  room.members.push({ ...guest, connected: true, ready: false, lastSeen: now });
  return room;
}
function liveRoom(code = 'ABCDEF'): Room {
  let room = waitingRoom(code);
  for (const [user, action] of [
    [host, { id: 'claim-h', type: 'claim', teamId: 't1' }],
    [guest, { id: 'claim-g', type: 'claim', teamId: 't2' }],
    [host, { id: 'ready-h', type: 'ready' }],
    [guest, { id: 'ready-g', type: 'ready' }],
    [host, { id: 'start', type: 'start' }],
  ] satisfies [User, Action][]) room = applyAction(room, user.id, action, now);
  return room;
}
function completedRoom(code = 'ABCDEF'): Room {
  let room = liveRoom(code);
  for (const [user, action] of [
    [guest, { id: 'bid', type: 'bid', playerId: 'p1', amount: 100 }],
    [host, { id: 'end', type: 'end' }],
  ] satisfies [User, Action][]) room = applyAction(room, user.id, action, now);
  return room;
}
const deleteBody = JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' });
function deleteRequest(token = 'guest') {
  return { method: 'DELETE', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: deleteBody };
}
const noopRoom = () => new FakeRoomNamespace(() => Response.json({ ok: true }));
async function json(response: Response) { return await response.json() as Record<string, any>; }

describe('Worker account directory', () => {
  it('lists privacy-minimised rooms and preserves the no-directory response', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(waitingRoom(), now);
    const app = createWorkerApp({ verify, now: () => now });
    const response = await app.request('/api/me', { headers: auth('guest') }, environment(noopRoom(), namespace));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toEqual({
      user: guest,
      rooms: [{ code: 'ABCDEF', name: waitingRoom().name, status: 'WAITING', role: 'member', memberCount: 2, updatedAt: now }],
    });
    const payload = JSON.stringify(body);
    expect(payload).not.toContain(host.id);
    expect(payload).not.toContain(host.name);

    const bare = await app.request('/api/me', { headers: auth('guest') }, environment(noopRoom()));
    expect(await json(bare)).toEqual({ user: guest, rooms: [] });
  });

  it('exports only the caller profile, listings and archives', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(completedRoom(), now);
    const app = createWorkerApp({ verify, now: () => now + 1000 });
    const response = await app.request('/api/me/export', { headers: auth('guest') }, environment(noopRoom(), namespace));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="auctionarena-export-');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(body.user).toEqual(guest);
    expect(body.rooms).toHaveLength(1);
    expect(body.archives).toHaveLength(1);
    const payload = JSON.stringify(body);
    expect(payload).not.toContain(host.id);
    expect(payload).not.toContain(host.name);
  });

  it('requires typed confirmation, a fresh first factor and no active hosted room', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(liveRoom(), now);
    const removed: string[] = [];
    const app = createWorkerApp({
      verify, requireReverification: true, deleteIdentity: async id => { removed.push(id); }, now: () => now,
    });
    const env = environment(noopRoom(), namespace);

    const missing = await app.request('/api/me', { method: 'DELETE', headers: auth('fresh-host') }, env);
    expect(missing.status).toBe(400);
    expect(await json(missing)).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const wrong = await app.request('/api/me', {
      method: 'DELETE', headers: { ...auth('fresh-host'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'delete' }),
    }, env);
    expect(wrong.status).toBe(400);
    expect(await json(wrong)).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });

    const stale = await app.request('/api/me', deleteRequest('stale-host'), env);
    expect(stale.status).toBe(403);
    expect(await json(stale)).toMatchObject({ clerk_error: { reason: 'reverification-error' } });

    const active = await app.request('/api/me', deleteRequest('fresh-host'), env);
    expect(active.status).toBe(409);
    expect(await json(active)).toMatchObject({ code: 'ACTIVE_HOSTED_ROOMS' });
    expect(removed).toEqual([]);
    expect(object.directory.isDeleted(host.id)).toBe(false);
  });

  it('deletes a member after provider deletion, room fan-out and directory completion', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(completedRoom(), now);
    const removed: string[] = [];
    const room = new FakeRoomNamespace(() => Response.json({ removed: false, missing: false }));
    const app = createWorkerApp({ verify, deleteIdentity: async id => { removed.push(id); }, now: () => now + 1000 });
    const env = environment(room, namespace);

    const response = await app.request('/api/me', deleteRequest('guest'), env);
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({
      accepted: true, message: 'Account deletion is queued. Access has ended.', completed: true,
    });
    expect(removed).toEqual([guest.id]);
    const calls = room.stubs.get('ABCDEF')!.requests;
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/internal/users/user_guest/delete');
    expect(calls[0]!.headers.get('x-auction-operation')).toBe('delete-user');
    expect(object.directory.isDeleted(guest.id)).toBe(true);
    expect(object.directory.listRooms(guest.id)).toEqual([]);
    expect(object.directory.listRooms(host.id)).toHaveLength(1);
    expect(object.directory.archives(host.id)).toHaveLength(1);
    expect(object.directory.archives(guest.id)).toEqual([]);

    const retry = await app.request('/api/me', deleteRequest('guest'), env);
    expect(retry.status).toBe(202);
    expect((await json(retry)).completed).toBe(true);
    expect(removed).toEqual([guest.id]);
    expect(calls).toHaveLength(1);
  });

  it('removes a sole-member room from the directory after the room object removes it', async () => {
    const { object, namespace } = directorySetup();
    const solo = completedRoom();
    solo.members = solo.members.filter(member => member.id === host.id);
    object.directory.upsertRoom(solo, now);
    const room = new FakeRoomNamespace(() => Response.json({ removed: true, missing: false }));
    const app = createWorkerApp({ verify, deleteIdentity: async () => undefined, now: () => now + 1000 });

    const response = await app.request('/api/me', deleteRequest('host'), environment(room, namespace));
    expect(response.status).toBe(202);
    expect((await json(response)).completed).toBe(true);
    expect(object.directory.listRooms(host.id)).toEqual([]);
    expect(object.directory.archives(host.id)).toEqual([]);
    expect(room.stubs.get('ABCDEF')!.requests).toHaveLength(1);
  });

  it('keeps the job open when identity provider deletion fails and resumes on retry', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(completedRoom(), now);
    const calls: string[] = [];
    let failing = true;
    const room = new FakeRoomNamespace(() => Response.json({ removed: false, missing: false }));
    const app = createWorkerApp({
      verify,
      deleteIdentity: async id => { calls.push(id); if (failing) throw new Error('provider down'); },
      now: () => now + 1000,
    });
    const env = environment(room, namespace);

    const failed = await app.request('/api/me', deleteRequest('guest'), env);
    expect(failed.status).toBe(502);
    expect(await json(failed)).toMatchObject({ code: 'DELETION_INCOMPLETE' });
    expect(object.directory.isDeleted(guest.id)).toBe(true);
    expect(object.directory.deletionJob(guest.id)).toMatchObject({
      providerDeleted: false, completedAt: null, attempts: 1,
    });
    expect(room.stubs.size).toBe(0);

    failing = false;
    const resumed = await app.request('/api/me', deleteRequest('guest'), env);
    expect(resumed.status).toBe(202);
    expect((await json(resumed)).completed).toBe(true);
    expect(calls).toEqual([guest.id, guest.id]);
    expect(room.stubs.get('ABCDEF')!.requests).toHaveLength(1);
    expect(object.directory.deletionJob(guest.id)).toMatchObject({ providerDeleted: true, completedAt: now + 1000 });
  });

  it('keeps the job open when a room fan-out fails and resumes on retry', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(completedRoom(), now);
    let failing = true;
    const room = new FakeRoomNamespace(() => failing
      ? Response.json({ code: 'SERVICE_ERROR' }, { status: 500 })
      : Response.json({ removed: false, missing: false }));
    const app = createWorkerApp({ verify, deleteIdentity: async () => undefined, now: () => now + 1000 });
    const env = environment(room, namespace);

    const failed = await app.request('/api/me', deleteRequest('guest'), env);
    expect(failed.status).toBe(502);
    expect(await json(failed)).toMatchObject({ code: 'DELETION_INCOMPLETE', pendingRooms: ['ABCDEF'] });
    expect(object.directory.deletionJob(guest.id)).toMatchObject({
      providerDeleted: true, completedAt: null, attempts: 1,
    });

    failing = false;
    const resumed = await app.request('/api/me', deleteRequest('guest'), env);
    expect(resumed.status).toBe(202);
    expect((await json(resumed)).completed).toBe(true);
    expect(room.stubs.get('ABCDEF')!.requests).toHaveLength(2);
    expect(object.directory.deletionJob(guest.id)?.completedAt).toBe(now + 1000);
  });

  it('refuses deletion and export when the directory or provider is not configured', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(completedRoom(), now);
    const app = createWorkerApp({ verify, now: () => now });

    const noDirectoryDelete = await app.request('/api/me', deleteRequest('guest'), environment(noopRoom()));
    expect(noDirectoryDelete.status).toBe(503);
    expect(await json(noDirectoryDelete)).toMatchObject({ code: 'DELETION_UNAVAILABLE' });
    const noDirectoryExport = await app.request('/api/me/export', { headers: auth('guest') }, environment(noopRoom()));
    expect(noDirectoryExport.status).toBe(503);
    expect(await json(noDirectoryExport)).toMatchObject({ code: 'EXPORT_UNAVAILABLE' });

    const noProvider = await app.request('/api/me', deleteRequest('guest'), environment(noopRoom(), namespace));
    expect(noProvider.status).toBe(503);
    expect(await json(noProvider)).toMatchObject({ code: 'DELETION_UNAVAILABLE' });
    expect(object.directory.isDeleted(guest.id)).toBe(false);
  });

  it('maps a failed directory request to a dependency error', async () => {
    const failing = new FakeDirectoryNamespace(new DirectoryDurableObject(new FakeState(new DatabaseSync(':memory:'))));
    failing.get = () => ({ fetch: async () => { throw new Error('binding unavailable'); } });
    const app = createWorkerApp({ verify, now: () => now });
    const response = await app.request('/api/me', { headers: auth('guest') }, environment(noopRoom(), failing));
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({ code: 'DIRECTORY_UNAVAILABLE' });
  });
});

describe('Worker room deletion', () => {
  it('forwards a trusted delete operation to the authoritative room object', async () => {
    const { namespace } = directorySetup();
    const room = new FakeRoomNamespace(() => Response.json({ deleted: true, alreadyDeleted: false }));
    const app = createWorkerApp({ verify, now: () => now + 1000 });

    const response = await app.request('/api/rooms/ABCDEF', {
      method: 'DELETE',
      headers: { ...auth('host'), 'X-Auction-Operation': 'delete-user' },
    }, environment(room, namespace));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ deleted: true, alreadyDeleted: false });

    const calls = room.stubs.get('ABCDEF')!.requests;
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/api/rooms/ABCDEF');
    expect(calls[0]!.method).toBe('DELETE');
    expect(calls[0]!.headers.get('x-auction-operation')).toBe('delete-room');
    expect(calls[0]!.headers.get('x-auction-user-id')).toBe(host.id);
  });

  it('passes through an active-room refusal without touching the directory', async () => {
    const { object, namespace } = directorySetup();
    object.directory.upsertRoom(liveRoom(), now);
    const room = new FakeRoomNamespace(() => Response.json({
      code: 'ROOM_ACTIVE', message: 'Only completed or closed rooms can be deleted.',
    }, { status: 409 }));
    const app = createWorkerApp({ verify, now: () => now + 1000 });

    const response = await app.request('/api/rooms/ABCDEF', {
      method: 'DELETE', headers: auth('host'),
    }, environment(room, namespace));
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: 'ROOM_ACTIVE' });
    expect(object.directory.listRooms(host.id)).toHaveLength(1);
  });

  it('rejects malformed room codes before reaching a room object', async () => {
    const { namespace } = directorySetup();
    const room = new FakeRoomNamespace(() => Response.json({ deleted: true }));
    const app = createWorkerApp({ verify, now: () => now });
    const response = await app.request('/api/rooms/not-a-code', {
      method: 'DELETE', headers: auth('host'),
    }, environment(room, namespace));
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    expect(room.stubs.size).toBe(0);
  });
});
