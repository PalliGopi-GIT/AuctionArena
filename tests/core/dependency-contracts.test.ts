import { describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { actionSchema, settingsSchema, type Room } from '../../packages/shared/src/index';
import { createApp } from '../../apps/api/src/app';
import { LocalRoomStore } from '../../apps/realtime/src/store';

describe('validation contracts across dependency upgrades', () => {
  it('keeps creation defaults, trimmed names and explicit false/zero values', () => {
    expect(settingsSchema.parse({})).toEqual({
      name: 'Friday Night Auction', teamCount: 4, budget: 8000, minSquad: 2,
      maxSquad: 8, maxOverseas: 4, timerSeconds: 30, lateExtension: true,
      bidIncrement: 10, autoAdvance: true, resultSeconds: 5, spectators: true,
    });
    expect(settingsSchema.parse({ name: '  Friends Auction  ', maxOverseas: 0,
      lateExtension: false, autoAdvance: false, spectators: false })).toMatchObject({
      name: 'Friends Auction', maxOverseas: 0, lateExtension: false,
      autoAdvance: false, spectators: false,
    });
  });

  it('rejects unknown settings, coercion, fractions, nulls and out-of-range values', () => {
    for (const input of [null, [], { extra: true }, { budget: '8000' },
      { teamCount: 2.5 }, { timerSeconds: null }, { budget: 199 },
      { maxSquad: 13 }, { spectators: 0 }, { name: '  x  ' },
      { teamCount: Infinity }, { budget: NaN }]) {
      expect(settingsSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it('still runs both squad and pool refinements after applying defaults', () => {
    expect(settingsSchema.safeParse({ minSquad: 4, maxSquad: 2 }).success).toBe(false);
    expect(settingsSchema.safeParse({ teamCount: 8, minSquad: 4 }).success).toBe(false);
    expect(settingsSchema.safeParse({ teamCount: 8, minSquad: 3 }).success).toBe(true);
  });

  it('requires complete settings for updates and rejects extra action fields', () => {
    const settings = settingsSchema.parse({});
    const update = { id: 'update-1', type: 'update-settings', settings };
    expect(actionSchema.parse(update)).toEqual(update);
    for (const invalid of [{ ...update, settings: {} },
      { ...update, settings: { ...settings, budget: undefined } },
      { ...update, settings: { ...settings, hostId: 'another-user' } },
      { ...update, hostId: 'another-user' },
      { id: 'bid-1', type: 'bid', amount: 100, playerId: 'p1', teamId: 't2' },
      { id: 'start-1', type: 'start', userId: 'host' }]) {
      expect(actionSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps action dispatch strict and accepts only positive safe integer bids', () => {
    const bid = { id: 'bid-1', type: 'bid', amount: 100, playerId: 'p1' };
    expect(actionSchema.parse(bid)).toEqual(bid);
    for (const amount of [0, -1, 10.5, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(actionSchema.safeParse({ ...bid, amount }).success).toBe(false);
    }
    for (const input of [{ ...bid, type: 'set-winner' }, { ...bid, id: '' },
      { ...bid, playerId: null }, { ...bid, amount: undefined }]) {
      expect(actionSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('real Node HTTP adapter compatibility', () => {
  it('preserves auth, JSON errors, body limits and state when validation fails', async () => {
    const store = new LocalRoomStore(null, () => 100000);
    const origin = 'http://127.0.0.1:5273';
    const { app } = createApp(store, { localDevAuth: true, allowedOrigins: [origin] });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, mode: 'single-process-local' });
      const denied = await fetch(`${base}/api/me`);
      expect(denied.status).toBe(401);
      await denied.text();
      const session = store.session('Contract Host');
      const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', Origin: origin };
      const request = (path: string, body: unknown) => fetch(`${base}${path}`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      const created = await request('/api/rooms', { name: '  Contract Room  ' });
      expect(created.status).toBe(201);
      expect(created.headers.get('access-control-allow-origin')).toBe(origin);
      const { room } = await created.json() as { room: Room };
      expect(room.settings.name).toBe('Contract Room');
      const before = store.get(room.code, session.user);
      for (const body of [
        { id: 'forged-start', type: 'start', userId: session.user.id },
        { id: 'incomplete-settings', type: 'update-settings', settings: {} },
        { id: 'invalid-bid', type: 'bid', amount: '100', playerId: 'p1' },
      ]) {
        const response = await request(`/api/rooms/${room.code}/actions`, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: 'INVALID_INPUT',
          message: expect.any(String), requestId: expect.stringMatching(/^[a-f0-9]{16}$/) });
      }
      expect(store.get(room.code, session.user)).toEqual(before);
      const tooLarge = await request('/api/rooms', { name: 'x'.repeat(5000) });
      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', requestId: expect.any(String) });
      // Streamed requests have no Content-Length: the adapter must still enforce the 4KB cap.
      const oversized = await fetch(`${base}/api/rooms`, {
        method: 'POST', headers, duplex: 'half',
        body: new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ name: 'x'.repeat(5000) })));
          controller.close();
        } }),
      } as RequestInit & { duplex: 'half' });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', requestId: expect.any(String) });
      expect(store.list(session.user)).toHaveLength(1);
    } finally {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    }
  });
});
