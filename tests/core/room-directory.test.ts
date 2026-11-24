import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Settings } from '../../packages/shared/src/index';
import { settingsSchema, type Action } from '../../packages/shared/src/index';
import type { Room, User } from '../../packages/shared/src/domain';
import { applyAction, createRoom } from '../../packages/engine/src/index';
import { NodeSqliteDriver } from '../../packages/storage/src/node-sqlite';
import { DirectoryError, SqliteRoomDirectory } from '../../packages/directory/src/index';

const host: User = { id: 'user_host', name: 'Host' };
const guest: User = { id: 'user_guest', name: 'Guest' };
const outsider: User = { id: 'user_outsider', name: 'Outsider' };
const now = 1_800_000_000_000;
const settings: Settings = settingsSchema.parse({ teamCount: 2, minSquad: 1, maxSquad: 2, budget: 1000, timerSeconds: 10, resultSeconds: 2 });
const drivers: NodeSqliteDriver[] = [];

function database(path = ':memory:') {
  const driver = new NodeSqliteDriver(path);
  drivers.push(driver);
  return driver;
}
function directory(path = ':memory:') {
  return new SqliteRoomDirectory(database(path));
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
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.close();
});

describe('SQLite room directory', () => {
  it('indexes memberships for discovery without exposing host identity in listings', () => {
    const store = directory(), room = waitingRoom();
    store.upsertRoom(room, now);
    expect(store.listRooms(host.id)).toEqual([{ code: 'ABCDEF', name: room.name, status: 'WAITING', role: 'host', memberCount: 2, updatedAt: now }]);
    expect(store.listRooms(guest.id)).toEqual([{ code: 'ABCDEF', name: room.name, status: 'WAITING', role: 'member', memberCount: 2, updatedAt: now }]);
    expect(store.listRooms(outsider.id)).toEqual([]);
    expect(JSON.stringify(store.listRooms(guest.id))).not.toContain(host.id);
  });

  it('drops stale projections and removes a room only at or beyond its indexed version', () => {
    const store = directory(), room = waitingRoom();
    const latest = { ...room, version: 5, name: 'Latest name' };
    store.upsertRoom(latest, now);
    store.upsertRoom({ ...room, version: 4, name: 'Stale name' }, now + 1000);
    expect(store.listRooms(host.id)[0]!.name).toBe('Latest name');
    expect(store.removeRoom('ABCDEF', 4)).toBe(false);
    expect(store.listRooms(host.id)).toHaveLength(1);
    expect(store.removeRoom('ABCDEF', 5)).toBe(true);
    expect(store.listRooms(host.id)).toEqual([]);
  });

  it('excludes blocked members and keeps the room visible to everyone else', () => {
    const store = directory(), room = waitingRoom();
    room.blockedUserIds = [guest.id];
    store.upsertRoom(room, now);
    expect(store.listRooms(guest.id)).toEqual([]);
    expect(store.listRooms(host.id)[0]!.memberCount).toBe(1);
  });

  it('reconciles changed memberships without rewriting stable entries on each version', () => {
    const driver = database(), store = new SqliteRoomDirectory(driver), room = waitingRoom();
    store.upsertRoom(room, now);
    driver.run('CREATE TABLE membership_writes (kind TEXT)');
    for (const kind of ['INSERT', 'UPDATE', 'DELETE']) {
      driver.run(`CREATE TRIGGER membership_${kind} AFTER ${kind} ON dir_memberships
        BEGIN INSERT INTO membership_writes VALUES ('${kind}'); END`);
    }
    store.upsertRoom({ ...room, version: 1 }, now + 1);
    expect(driver.all('SELECT kind FROM membership_writes')).toEqual([]);
    store.upsertRoom({ ...room, version: 2, blockedUserIds: [guest.id] }, now + 2);
    expect(driver.all('SELECT kind FROM membership_writes')).toEqual([{ kind: 'DELETE' }]);
    expect(store.listRooms(guest.id)).toEqual([]);
    expect(store.listRooms(host.id)[0]).toMatchObject({ memberCount: 1, updatedAt: now + 2 });
    expect(driver.all('SELECT user_id FROM dir_participants WHERE code=? AND user_id=?', room.code, guest.id)).toHaveLength(1);
  });

  it('archives a completed room once, immutably, and exposes it only to participants', () => {
    const store = directory(), room = completedRoom();
    expect(room.status).toBe('COMPLETED');
    store.upsertRoom(room, now);
    const first = store.archives(host.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: `ABCDEF:${room.version}`, code: 'ABCDEF', completedVersion: room.version, participantCount: 2 });
    expect(first[0]!.results.find(result => result.playerId === 'p1')).toMatchObject({ status: 'sold', teamId: 't2', teamName: room.teams[1]!.name, price: 100 });
    const payload = JSON.stringify(first);
    expect(payload).not.toContain(host.id);
    expect(payload).not.toContain(guest.id);
    expect(payload).not.toContain(guest.name);

    store.upsertRoom({ ...room, name: 'Changed after completion' }, now + 5000);
    const later = store.archives(host.id);
    expect(later).toHaveLength(1);
    expect(later[0]).toEqual(first[0]);
    expect(store.archives(guest.id)).toHaveLength(1);
    expect(store.archives(outsider.id)).toEqual([]);
  });

  it('exports profile, listings and archives without other participants identities', () => {
    const store = directory(), room = completedRoom();
    store.upsertRoom(room, now);
    const exported = store.exportUser(host, now + 1000);
    expect(exported).toMatchObject({ user: host, exportedAt: now + 1000 });
    expect(exported.rooms).toHaveLength(1);
    expect(exported.archives).toHaveLength(1);
    const payload = JSON.stringify(exported);
    expect(payload).not.toContain(guest.id);
    expect(payload).not.toContain(guest.name);
  });

  it('queues deletion, denies access immediately and completes idempotently', () => {
    const store = directory(), room = completedRoom();
    store.upsertRoom(room, now);
    const job = store.requestDeletion(guest.id, now + 1000);
    expect(job).toMatchObject({ userId: guest.id, providerDeleted: false, completedAt: null, attempts: 0 });
    expect(job.rooms.map(item => item.code)).toEqual(['ABCDEF']);
    expect(store.isDeleted(guest.id)).toBe(true);
    expect(store.listRooms(guest.id)).toEqual([]);
    expect(() => store.exportUser(guest, now + 1000)).toThrowError(DirectoryError);
    expect(store.markProviderDeleted(guest.id, now + 2000).providerDeleted).toBe(true);
    const retried = store.retryDeletion(guest.id, now + 3000);
    expect(retried.attempts).toBe(1);
    expect(retried.retryAt).toBeGreaterThan(now + 3000);
    const completed = store.completeDeletion(guest.id, now + 4000);
    expect(completed.completedAt).toBe(now + 4000);
    expect(completed.rooms).toEqual([]);
    expect(store.listRooms(host.id)).toHaveLength(1);
    expect(store.completeDeletion(guest.id, now + 5000).completedAt).toBe(now + 4000);
  });

  it('does not let a delayed room snapshot re-add a deleted member', () => {
    const driver = database(), store = new SqliteRoomDirectory(driver), room = completedRoom();
    store.upsertRoom(room, now);
    store.requestDeletion(guest.id, now + 1000);
    store.completeDeletion(guest.id, now + 2000);
    store.upsertRoom({ ...room, version: room.version + 1 }, now + 3000);
    expect(driver.all('SELECT * FROM dir_memberships WHERE user_id=?', guest.id)).toEqual([]);
    expect(store.listRooms(host.id)[0]!.memberCount).toBe(1);
  });

  it('finds rooms for deletion after a member left but history still names them', () => {
    const store = directory(), room = completedRoom();
    store.upsertRoom(room, now);
    const left = { ...room, version: room.version + 1, members: room.members.filter(member => member.id !== guest.id) };
    store.upsertRoom(left, now + 1000);
    expect(store.listRooms(guest.id)).toEqual([]);
    const job = store.requestDeletion(guest.id, now + 2000);
    expect(job.rooms.map(item => item.code)).toEqual(['ABCDEF']);
    expect(job.rooms[0]!.role).toBe('member');
  });

  it('removes a sole-member room and survives a file-backed restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'auctionarena-directory-'));
    const path = join(root, 'directory.sqlite');
    try {
      const firstDriver = new NodeSqliteDriver(path);
      const first = new SqliteRoomDirectory(firstDriver);
      const room = completedRoom('ABCDEF');
      first.upsertRoom(room, now);
      first.requestDeletion(host.id, now + 1000);
      first.completeDeletion(host.id, now + 2000, ['ABCDEF']);
      expect(first.listRooms(host.id)).toEqual([]);
      expect(first.archives(host.id)).toEqual([]);
      firstDriver.close();

      const secondDriver = new NodeSqliteDriver(path);
      const second = new SqliteRoomDirectory(secondDriver);
      expect(second.isDeleted(host.id)).toBe(true);
      expect(second.deletionJob(host.id)?.completedAt).toBe(now + 2000);
      expect(second.listRooms(host.id)).toEqual([]);
      secondDriver.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('permanently deletes a room, its archive and participant indexes idempotently', () => {
    const driver = database(), store = new SqliteRoomDirectory(driver), room = completedRoom();
    store.upsertRoom(room, now);
    expect(store.listRooms(host.id)).toHaveLength(1);
    expect(store.archives(guest.id)).toHaveLength(1);

    expect(store.deleteRoom('ABCDEF', now + 1000)).toBe(true);
    expect(store.listRooms(host.id)).toEqual([]);
    expect(store.listRooms(guest.id)).toEqual([]);
    expect(store.archives(host.id)).toEqual([]);
    expect(store.archives(guest.id)).toEqual([]);
    expect(driver.all('SELECT * FROM dir_participants WHERE code=?', 'ABCDEF')).toEqual([]);
    expect(driver.all('SELECT * FROM dir_memberships WHERE code=?', 'ABCDEF')).toEqual([]);
    expect(driver.all('SELECT * FROM dir_archive_members')).toEqual([]);
    expect(driver.all('SELECT * FROM dir_rooms WHERE code=?', 'ABCDEF')).toEqual([]);

    expect(store.deleteRoom('ABCDEF', now + 2000)).toBe(false);
    expect(store.deleteRoom('ZZZZZZ', now + 2000)).toBe(false);
  });

  it('ignores delayed snapshots for a deleted room but allows a newer room to reuse its code', () => {
    const store = directory(), room = completedRoom();
    store.upsertRoom(room, now);
    store.deleteRoom('ABCDEF', now + 1000);

    expect(store.upsertRoom(room, now + 2000)).toBeNull();
    expect(store.upsertRoom({ ...room, version: room.version + 1 }, now + 2000)).toBeNull();
    expect(store.archive(room, now + 2000)).toBeNull();
    expect(store.listRooms(host.id)).toEqual([]);
    expect(store.archives(guest.id)).toEqual([]);

    const reused = createRoom('ABCDEF', host, settings, now + 5000);
    expect(store.upsertRoom(reused, now + 6000)).not.toBeNull();
    expect(store.listRooms(host.id)[0]).toMatchObject({ code: 'ABCDEF', status: 'WAITING', role: 'host' });
  });
});
