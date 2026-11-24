import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../apps/api/src/app';
import { attachRoomSocket } from '../../apps/api/src/room-socket';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { canDeleteRoom } from '../../apps/web/src/identity-session';
import { createRoom } from '../../packages/engine/src/index';
import { settingsSchema } from '../../packages/shared/src/index';

const settings = settingsSchema.parse({});
const auth = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

function fixture() {
  let now = 100000;
  const store = new LocalRoomStore(null, () => now);
  const host = store.session('Deleting Host'), guest = store.session('Guest Captain');
  const created = store.create(host.user, settings);
  store.join(created.room.code, guest.user, created.inviteToken);
  return {
    store, code: created.room.code, host: host.user, guest: guest.user,
    hostToken: host.token, guestToken: guest.token,
    advance: (ms: number) => { now += ms; },
  };
}
function closeRoom(store: LocalRoomStore, code: string, host: { id: string; name: string }) {
  store.action(code, host, { id: 'close-room', type: 'end' });
  expect(store.get(code, host).status).toBe('CLOSED');
}
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn();
  close = vi.fn((_code?: number, _reason?: string) => { this.readyState = 3; this.emit('close'); });
}

describe('local room deletion', () => {
  it('permanently removes an ended room from memory and the database file', () => {
    const root = mkdtempSync(join(tmpdir(), 'auctionarena-room-delete-'));
    try {
      const path = join(root, 'rooms.json');
      let store = new LocalRoomStore(path, () => 100000);
      const host = store.session('Host').user;
      const created = store.create(host, settings);
      closeRoom(store, created.room.code, host);
      expect(store.list(host)).toHaveLength(1);

      expect(store.deleteRoom(created.room.code, host)).toEqual({ deleted: true, alreadyDeleted: false });
      expect(store.list(host)).toEqual([]);
      expect(() => store.get(created.room.code, host)).toThrow(/unavailable/);

      store = new LocalRoomStore(path, () => 100000);
      expect(store.list(host)).toEqual([]);
      expect(store.deleteRoom(created.room.code, host)).toEqual({ deleted: true, alreadyDeleted: true });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('protects active rooms, foreign hosts and unknown rooms consistently', () => {
    const f = fixture();
    expect(() => f.store.deleteRoom(f.code, f.host)).toThrow('Only completed or closed rooms can be deleted.');
    expect(f.store.get(f.code, f.host).status).toBe('WAITING');
    closeRoom(f.store, f.code, f.host);
    expect(() => f.store.deleteRoom(f.code, f.guest)).toThrow('Only the host can delete this room.');
    expect(f.store.get(f.code, f.host).status).toBe('CLOSED');
    expect(f.store.deleteRoom('ZZZZZZ', f.host)).toEqual({ deleted: true, alreadyDeleted: true });
  });

  it('closes admitted sockets with a room-deleted event and removes its listeners', () => {
    const f = fixture();
    const socket = new Socket();
    attachRoomSocket(f.store, f.code, f.host, socket);
    expect(socket.close).not.toHaveBeenCalled();
    closeRoom(f.store, f.code, f.host);
    f.store.deleteRoom(f.code, f.host);
    expect(socket.close).toHaveBeenCalledWith(1001, 'Room deleted');
    expect(f.store.listenerCount('room-deleted')).toBe(0);
    expect(f.store.listenerCount('room')).toBe(0);
  });

  it('exposes deletion over HTTP with server-side ownership and status checks', async () => {
    const f = fixture(), { app } = createApp(f.store, { localDevAuth: true });
    const remove = (token: string, code = f.code) => app.request(`/api/rooms/${code}`, { method: 'DELETE', headers: auth(token) });

    const active = await remove(f.hostToken);
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ code: 'ROOM_ACTIVE' });

    closeRoom(f.store, f.code, f.host);
    const foreign = await remove(f.guestToken);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: 'HOST_ONLY' });
    expect(f.store.list(f.host)).toHaveLength(1);

    const deleted = await remove(f.hostToken);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ deleted: true, alreadyDeleted: false });
    expect(f.store.list(f.host)).toEqual([]);
    expect((await app.request(`/api/rooms/${f.code}`, { headers: auth(f.hostToken) })).status).toBe(404);

    const repeated = await remove(f.hostToken);
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ deleted: true, alreadyDeleted: true });
  });

  it('makes concurrent repeated deletion safe', async () => {
    const f = fixture(), { app } = createApp(f.store, { localDevAuth: true });
    closeRoom(f.store, f.code, f.host);
    const remove = () => app.request(`/api/rooms/${f.code}`, { method: 'DELETE', headers: auth(f.hostToken) });
    const [first, second] = await Promise.all([remove(), remove()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const bodies = [await first.json(), await second.json()] as Array<{ alreadyDeleted: boolean }>;
    expect(bodies.map(body => body.alreadyDeleted).sort()).toEqual([false, true]);
    expect(f.store.list(f.host)).toEqual([]);
  });

  it('gates the History control on host ownership and an ended room', () => {
    const room = createRoom('ABCDEF', { id: 'user_host', name: 'Host' }, settings, 100000);
    expect(canDeleteRoom(room, 'user_host')).toBe(false);
    for (const status of ['COMPLETED', 'CLOSED'] as const) {
      room.status = status;
      expect(canDeleteRoom(room, 'user_host')).toBe(true);
      expect(canDeleteRoom(room, 'user_other')).toBe(false);
      expect(canDeleteRoom(room, undefined)).toBe(false);
    }
    for (const status of ['WAITING', 'LIVE', 'PAUSED', 'RESULT'] as const) {
      room.status = status;
      expect(canDeleteRoom(room, 'user_host')).toBe(false);
    }
  });
});
