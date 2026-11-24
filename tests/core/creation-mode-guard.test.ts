import { test, expect } from 'vitest';
import { createApp } from '../../apps/api/src/app';
import { createWorkerApp } from '../../apps/api/src/worker/app';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { settingsForMode, type Room } from '../../packages/shared/src/index';

/**
 * Both real creation paths must refuse to build a room that carries the
 * fictional sample pool. Mode-less requests are rejected outright.
 */
const FICTIONAL = ['Arjun Rathore', 'Kabir Mehta', 'Liam Fletcher', 'Dev Malhotra'];

test('the local API rejects a room creation without an auction mode', async () => {
  const store = new LocalRoomStore(null);
  const { app } = createApp(store, { localDevAuth: true });
  const session = store.session('Mode Guard');
  // A synthetic legacy body that used to create a fictional sample room.
  const response = await app.request('/api/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamCount: 4, minSquad: 2, maxSquad: 8, maxOverseas: 4 }),
  });
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe('MODE_REQUIRED');
});

test('the Worker rejects a room creation without an auction mode', async () => {
  const app = createWorkerApp({
    verify: async () => ({ id: 'u1', name: 'Guard' }),
    generateCode: () => 'AAAAAA',
  });
  const response = await app.request('/api/rooms', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamCount: 4, minSquad: 2, maxSquad: 8, maxOverseas: 4 }),
  }, {
    ROOM: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ code: 'UNREACHABLE' }, { status: 500 }) }) },
    ASSETS: { fetch: async () => new Response('') },
  } as never);
  expect(response.status).toBe(400);
  expect((await response.json()).code).toBe('MODE_REQUIRED');
});

test('both creation paths produce a real catalog pool when a mode is given', async () => {
  const store = new LocalRoomStore(null);
  const { app } = createApp(store, { localDevAuth: true });
  const session = store.session('Mode Guard');
  const response = await app.request('/api/rooms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(settingsForMode('quick', { teamCount: 2 })),
  });
  expect(response.status).toBe(201);
  const { room } = await response.json() as { room: Room };
  expect(room.players).toHaveLength(80);
  expect(room.players.some(player => player.isSample)).toBe(false);
  for (const name of FICTIONAL) expect(room.players.some(player => player.name === name)).toBe(false);
});
