import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createWorkerApp } from '../../apps/api/src/worker/app';
import type { DurableObjectIdLike, DurableObjectNamespaceLike, DurableObjectStubLike, IdentityVerifier, WorkerEnv } from '../../apps/api/src/worker/types';

class FakeStub implements DurableObjectStubLike {
  requests: Request[] = [];
  constructor(private handler: (request: Request, code: string) => Promise<Response> | Response, private code: string) {}
  async fetch(request: Request) { this.requests.push(request); return this.handler(request, this.code); }
}
class FakeNamespace implements DurableObjectNamespaceLike {
  names: string[] = [];
  stubs = new Map<string, FakeStub>();
  constructor(private handler: (request: Request, code: string) => Promise<Response> | Response) {}
  idFromName(name: string): DurableObjectIdLike { this.names.push(name); return { toString: () => name }; }
  get(id: DurableObjectIdLike) {
    const name = id.toString();
    let stub = this.stubs.get(name);
    if (!stub) { stub = new FakeStub(this.handler, name); this.stubs.set(name, stub); }
    return stub;
  }
}
function assets() {
  const calls: string[] = [];
  return { calls, fetch: async (request: Request) => { calls.push(new URL(request.url).pathname); return new Response('asset', { status: 200 }); } };
}
const verify: IdentityVerifier = async token => {
  if (token === 'host') return { id: 'user_host', name: 'Verified Host' };
  if (token === 'guest') return { id: 'user_guest', name: 'Verified Guest' };
  throw new Error('invalid');
};
const auth = (token = 'host') => ({ Authorization: `Bearer ${token}` });
function environment(room: FakeNamespace, overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return { ROOM: room, ASSETS: assets(), CLERK_JWT_KEY: 'test-key', WS_TICKET_SECRET: 'test-secret', ...overrides };
}
const privacy = { code: 'ROOM_NOT_FOUND', message: 'Room unavailable. Check your invitation or ask the host for access.' };
const noopRoom = () => new FakeNamespace(() => Response.json({ ok: true }));

describe('Cloudflare Worker entry', () => {
  it('serves public health/config and reports Clerk configuration without secrets', async () => {
    const room = noopRoom(), app = createWorkerApp({ verify });
    const health = await app.request('/api/health', {}, environment(room));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, mode: 'cloudflare-worker', maxMembers: 20 });
    const configured = await app.request('/api/config', {}, environment(room));
    expect(await configured.json()).toEqual({ localDevAuth: false, clerkConfigured: true });
    const bare = await app.request('/api/config', {}, environment(room, { CLERK_JWT_KEY: undefined }));
    expect(await bare.json()).toEqual({ localDevAuth: false, clerkConfigured: false });
  });

  it('requires a verified bearer session and keeps identity out of request JSON', async () => {
    const room = noopRoom(), app = createWorkerApp({ verify }), env = environment(room);
    expect((await app.request('/api/me', {}, env)).status).toBe(401);
    const invalid = await app.request('/api/me', { headers: auth('nope') }, env);
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ code: 'SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' });
    const me = await app.request('/api/me', { headers: auth() }, env);
    expect(await me.json()).toEqual({ user: { id: 'user_host', name: 'Verified Host' }, rooms: [] });
    const changed = await app.request('/api/me', { headers: { ...auth(), 'X-Auction-Subject': 'user_guest' } }, env);
    expect(changed.status).toBe(409);
    expect(room.names).toEqual([]);
  });

  it('refuses protected routes when Clerk verification is not configured', async () => {
    const app = createWorkerApp(), room = noopRoom();
    const response = await app.request('/api/me', { headers: auth() }, environment(room, { CLERK_JWT_KEY: undefined }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured.' });
    expect(room.names).toEqual([]);
  });

  it('normalizes the room code before deterministic routing and strips client identity headers', async () => {
    const room = new FakeNamespace(request => Response.json({
      code: request.headers.get('x-auction-room-code'),
      user: request.headers.get('x-auction-user-id'),
      name: decodeURIComponent(request.headers.get('x-auction-user-name') ?? ''),
      authorization: request.headers.get('authorization'),
      subject: request.headers.get('x-auction-subject'),
      traceForwardAt: request.headers.get('x-auction-local-forward-at'),
    }));
    const app = createWorkerApp({ verify });
    const response = await app.request('/api/rooms/abcdef', {
      headers: { ...auth(), 'X-Auction-User-Id': 'attacker', 'X-Auction-Room-Code': 'ZZZZZZ', 'X-Auction-Subject': 'user_host',
        'X-Auction-Local-Forward-At': '1' },
    }, environment(room));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 'ABCDEF', user: 'user_host', name: 'Verified Host', authorization: null, subject: null, traceForwardAt: null });
    expect(room.names).toEqual(['ABCDEF']);
  });

  it('rejects malformed or unknown room codes without touching an object', async () => {
    const room = noopRoom(), app = createWorkerApp({ verify }), env = environment(room);
    for (const path of ['/api/rooms/abc', '/api/rooms/ABCDE', '/api/rooms/ZZZZZZ', '/api/rooms/%2e%2e%2fsecret', '/ws']) {
      const response = await app.request(path, { headers: auth() }, env);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'ROOM_NOT_FOUND', message: privacy.message });
    }
    expect(room.names).toEqual([]);
  });

  it('passes missing and unauthorized room responses through unchanged', async () => {
    const room = new FakeNamespace(() => Response.json(privacy, { status: 404 }));
    const app = createWorkerApp({ verify });
    const missing = await app.request('/api/rooms/AAAAAA', { headers: auth() }, environment(room));
    const forbidden = await app.request('/api/rooms/BBBBBB', { headers: auth('guest') }, environment(room));
    expect(missing.status).toBe(404); expect(forbidden.status).toBe(404);
    expect(await missing.json()).toEqual(await forbidden.json());
    expect(room.names).toEqual(['AAAAAA', 'BBBBBB']);
  });

  it('retries room creation on a code collision and forwards normalized settings', async () => {
    const codes = ['AAAAAA', 'BBBBBB'];
    const bodies: unknown[] = [];
    const room = new FakeNamespace(async (request, code) => {
      if (code === 'AAAAAA') return Response.json({ code: 'ROOM_EXISTS' }, { status: 409 });
      bodies.push(await request.json());
      return Response.json({ room: { code }, inviteToken: 'invite' }, { status: 201 });
    });
    const app = createWorkerApp({ verify, generateCode: () => codes.shift()! });
    const response = await app.request('/api/rooms', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamCount: 2, minSquad: 1, maxSquad: 2 }),
    }, environment(room));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ room: { code: 'BBBBBB' }, inviteToken: 'invite' });
    expect(room.names).toEqual(['AAAAAA', 'BBBBBB']);
    expect(bodies[0]).toMatchObject({ teamCount: 2, minSquad: 1, maxSquad: 2, name: 'Friday Night Auction' });
  });

  it('rejects invalid creation bodies and exhausted code allocation', async () => {
    const app = createWorkerApp({ verify });
    const badJson = await app.request('/api/rooms', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: '{' }, environment(noopRoom()));
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).code).toBe('INVALID_INPUT');
    const badSettings = await app.request('/api/rooms', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ teamCount: 99 }) }, environment(noopRoom()));
    expect(badSettings.status).toBe(400);
    expect((await badSettings.json()).code).toBe('INVALID_INPUT');
    const full = new FakeNamespace(() => Response.json({ code: 'ROOM_EXISTS' }, { status: 409 }));
    const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE'];
    const exhausted = await createWorkerApp({ verify, generateCode: () => codes.shift()! }).request('/api/rooms', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: '{}',
    }, environment(full));
    expect(exhausted.status).toBe(503);
    expect((await exhausted.json()).code).toBe('ROOM_CODE_UNAVAILABLE');
  });

  it('forwards methods, queries and bodies to the room object', async () => {
    const room = new FakeNamespace(async request => Response.json({
      method: request.method, url: new URL(request.url).pathname + new URL(request.url).search,
      body: request.method === 'GET' ? null : await request.text(),
    }));
    const app = createWorkerApp({ verify }), env = environment(room);
    const history = await app.request('/api/rooms/ABCDEF/history?before=10&limit=5', { headers: auth() }, env);
    expect(await history.json()).toEqual({ method: 'GET', url: '/api/rooms/ABCDEF/history?before=10&limit=5', body: null });
    const actions = await app.request('/api/rooms/ABCDEF/actions', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: '{"id":"a1"}' }, env);
    expect(await actions.json()).toEqual({ method: 'POST', url: '/api/rooms/ABCDEF/actions', body: '{"id":"a1"}' });
    for (const path of ['join', 'invite']) {
      const response = await app.request(`/api/rooms/ABCDEF/${path}`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: '{"inviteToken":"t"}' }, env);
      expect((await response.json()).body).toBe('{"inviteToken":"t"}');
    }
  });

  it('issues short-lived socket tickets after an authorized room check', async () => {
    const room = new FakeNamespace(request => request.headers.get('x-auction-operation') === 'authorize'
      ? Response.json({ ok: true }) : Response.json({ unexpected: true }, { status: 500 }));
    const app = createWorkerApp({ verify }), env = environment(room);
    const response = await app.request('/api/rooms/ABCDEF/ws-ticket', { method: 'POST', headers: auth() }, env);
    expect(response.status).toBe(200);
    const { ticket } = await response.json();
    expect(typeof ticket).toBe('string');
    expect(room.stubs.get('ABCDEF')!.requests[0]!.headers.get('x-auction-operation')).toBe('authorize');
    const unauthorized = new FakeNamespace(() => Response.json(privacy, { status: 404 }));
    const denied = await createWorkerApp({ verify }).request('/api/rooms/ABCDEF/ws-ticket', { method: 'POST', headers: auth('guest') }, environment(unauthorized));
    expect(denied.status).toBe(404);
    const unconfigured = await app.request('/api/rooms/ABCDEF/ws-ticket', { method: 'POST', headers: auth() }, environment(room, { WS_TICKET_SECRET: undefined }));
    expect(unconfigured.status).toBe(503);
  });

  it('routes socket upgrades by room code and verifies the ticket identity', async () => {
    const room = new FakeNamespace(request => Response.json({
      upgrade: request.headers.get('upgrade'), user: request.headers.get('x-auction-user-id'),
      name: decodeURIComponent(request.headers.get('x-auction-user-name') ?? ''), code: request.headers.get('x-auction-room-code'),
    }));
    const app = createWorkerApp({ verify }), env = environment(room);
    const issued = await app.request('/api/rooms/ABCDEF/ws-ticket', { method: 'POST', headers: auth() }, env);
    const { ticket } = await issued.json();
    const response = await app.request('/ws?room=abcdef', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `ticket.${ticket}` } }, env);
    expect(await response.json()).toEqual({ upgrade: 'websocket', user: 'user_host', name: 'Verified Host', code: 'ABCDEF' });
    expect(room.names).toEqual(['ABCDEF', 'ABCDEF']);
    const wrongRoom = await app.request('/ws?room=BBBBBB', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `ticket.${ticket}` } }, env);
    expect(wrongRoom.status).toBe(401);
    const tampered = await app.request('/ws?room=ABCDEF', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'ticket.invalid' } }, env);
    expect(tampered.status).toBe(401);
    const unconfigured = await app.request('/ws?room=ABCDEF', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `ticket.${ticket}` } }, environment(room, { WS_TICKET_SECRET: undefined }));
    expect(unconfigured.status).toBe(503);
  });

  it('serves assets outside the API and never falls through API misses to assets', async () => {
    const room = noopRoom(), env = environment(room), app = createWorkerApp({ verify });
    const page = await app.request('/', {}, env);
    expect(await page.text()).toBe('asset');
    const miss = await app.request('/api/unknown', { headers: auth() }, env);
    expect(miss.status).toBe(404);
    expect(await miss.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect((env.ASSETS as unknown as { calls: string[] }).calls).toEqual(['/']);
  });

  it('applies exact-origin CORS and refuses an invalid allowlist', async () => {
    const room = noopRoom(), app = createWorkerApp({ verify }), env = environment(room);
    const allowed = await app.request('/api/health', { headers: { Origin: 'http://127.0.0.1:5173' } }, env);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    const foreign = await app.request('/api/health', { headers: { Origin: 'https://attacker.example' } }, env);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    const invalid = await app.request('/api/health', {}, environment(room, { ALLOWED_ORIGINS: '*' }));
    expect(invalid.status).toBe(503);
    expect((await invalid.json()).code).toBe('CONFIGURATION_ERROR');
  });

  it('limits oversized bodies and per-isolate request bursts', async () => {
    const room = noopRoom(), env = environment(room);
    const app = createWorkerApp({ verify, rateLimit: 2, now: () => 1000 });
    const oversized = await app.request('/api/rooms/ABCDEF/actions', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: 'x'.repeat(5000) }, env);
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).code).toBe('PAYLOAD_TOO_LARGE');
    expect((await app.request('/api/me', { headers: auth() }, env)).status).toBe(200);
    expect((await app.request('/api/me', { headers: auth() }, env)).status).toBe(200);
    expect((await app.request('/api/me', { headers: auth() }, env)).status).toBe(429);
    expect((await app.request('/api/me', { headers: auth('guest') }, env)).status).toBe(200);
  });

  it('updates a display name through the injected provider and validates it', async () => {
    const renames: Array<[string, string]> = [];
    const app = createWorkerApp({ verify, renameIdentity: async (id, name) => { renames.push([id, name]); } });
    const env = environment(noopRoom());
    const headers = { ...auth(), 'Content-Type': 'application/json' };
    const accepted = await app.request('/api/me', { method: 'PATCH', headers, body: JSON.stringify({ displayName: '  New   Name  ' }) }, env);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ user: { id: 'user_host', name: 'New Name' } });
    expect(renames).toEqual([['user_host', 'New Name']]);
    const short = await app.request('/api/me', { method: 'PATCH', headers, body: JSON.stringify({ displayName: 'x' }) }, env);
    expect(short.status).toBe(400);
    expect((await short.json()).code).toBe('INVALID_NAME');
    const extra = await app.request('/api/me', { method: 'PATCH', headers, body: JSON.stringify({ displayName: 'Valid Name', role: 'host' }) }, env);
    expect(extra.status).toBe(400);
    expect((await extra.json()).code).toBe('INVALID_INPUT');
    expect(renames).toHaveLength(1);
  });

  it('fails display-name updates closed without a provider secret', async () => {
    const app = createWorkerApp({ verify });
    const response = await app.request('/api/me', {
      method: 'PATCH',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Valid Name' }),
    }, environment(noopRoom()));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('PROFILE_UPDATE_UNAVAILABLE');
  });

  it('fans a display-name change out to the user rooms', async () => {
    const operations: string[] = [];
    const room = new FakeNamespace(request => {
      if (request.url.endsWith('/profile')) {
        operations.push(request.headers.get('x-auction-operation') ?? '');
        return Response.json({ updated: true, missing: false });
      }
      return Response.json({ ok: true });
    });
    const directory = new FakeNamespace(request => {
      if (request.url.endsWith('/deleted')) return Response.json({ deleted: false });
      if (request.url.includes('/rooms')) return Response.json({ rooms: [{ code: 'ABCDEF' }] });
      return Response.json({ ok: true });
    });
    const app = createWorkerApp({ verify, renameIdentity: async () => {} });
    const response = await app.request('/api/me', {
      method: 'PATCH',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'New Name' }),
    }, environment(room, { DIRECTORY: directory }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'user_host', name: 'New Name' } });
    expect(operations).toEqual(['update-profile']);
    const profile = room.stubs.get('ABCDEF')!.requests.find(item => item.url.endsWith('/profile'))!;
    expect(await profile.json()).toEqual({ name: 'New Name' });
  });

  it('strips client-supplied internal operation headers', async () => {
    const room = new FakeNamespace(request => Response.json({ operation: request.headers.get('x-auction-operation') }));
    const app = createWorkerApp({ verify });
    const response = await app.request('/api/rooms/ABCDEF', {
      headers: { ...auth(), 'X-Auction-Operation': 'delete-user' },
    }, environment(room));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ operation: null });
  });

  it('verifies real Clerk-signed sessions with ephemeral keys', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwtKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const issuer = 'https://test-issuer.clerk.accounts.dev', origin = 'http://127.0.0.1:5173';
    const now = Math.floor(Date.now() / 1000);
    const token = (key = keys.privateKey) => {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'local-test-key' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ sub: 'user_host', sid: 'sess_test', iss: issuer, azp: origin, iat: now, nbf: now - 5, exp: now + 60, name: 'Worker Host' })).toString('base64url');
      const body = `${header}.${payload}`;
      return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
    };
    const room = noopRoom(), app = createWorkerApp();
    const env = environment(room, { CLERK_JWT_KEY: jwtKey, CLERK_ISSUER: issuer, ALLOWED_ORIGINS: origin });
    const accepted = await app.request('/api/me', { headers: auth(token()) }, env);
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).user).toEqual({ id: 'user_host', name: 'Worker Host' });
    const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect((await app.request('/api/me', { headers: auth(token(wrong.privateKey)) }, env)).status).toBe(401);
    expect(room.names).toEqual([]);
  });
});
