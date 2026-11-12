import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createApp } from '../../apps/api/src/app';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { clerkDevelopmentConfig } from '../../scripts/clerk-config';

// Ephemeral test keys exercise the real Clerk SDK. These are not live Clerk sessions.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const issuer = 'https://test-issuer.clerk.accounts.dev', origin = 'http://127.0.0.1:5173';
function jwt(overrides: Record<string, unknown> = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'local-test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user_host', sid: 'sess_test', iss: issuer, azp: origin, iat: now, nbf: now - 5, exp: now + 60, name: 'Verified Host', ...overrides })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}
function fixture() {
  const store = new LocalRoomStore(null);
  return { store, ...createApp(store, { localDevAuth: false, clerkJwtKey: jwtKey, clerkIssuer: issuer, allowedOrigins: [origin] }) };
}
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

describe('Clerk SDK session verification with ephemeral signing keys', () => {
  it('accepts a valid signed session and derives identity only from verified claims', async () => {
    const { app } = fixture();
    const response = await app.request('/api/me', { headers: headers(jwt()) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'user_host', name: 'Verified Host' }, rooms: [] });
  });
  const invalid: [string, Record<string, unknown>][] = [
    ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }],
    ['not active yet', { nbf: Math.floor(Date.now() / 1000) + 3600 }],
    ['issued in the future', { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ['foreign authorized party', { azp: 'https://attacker.example' }],
    ['missing authorized party', { azp: undefined }],
    ['foreign issuer', { iss: 'https://different.clerk.accounts.dev' }],
    ['missing session', { sid: undefined }],
    ['empty subject', { sub: '' }],
    ['pending session', { sts: 'pending' }],
  ];
  for (const [label, claims] of invalid) it(`rejects ${label} without exposing verification details`, async () => {
    const { app } = fixture();
    const response = await app.request('/api/me', { headers: headers(jwt(claims)) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' });
  });
  it('rejects a foreign signing key and a tampered subject', async () => {
    const { app } = fixture();
    const parts = jwt().split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()), sub: 'user_victim' })).toString('base64url');
    for (const token of [jwt({}, wrongKeys.privateKey), parts.join('.'), 'not-a-token']) {
      expect((await app.request('/api/me', { headers: headers(token) })).status).toBe(401);
    }
  });
  it('keeps private rooms separate when the browser switches verified identities', async () => {
    const { app } = fixture();
    const hostToken = jwt(), guestToken = jwt({ sub: 'user_guest', sid: 'sess_guest', name: 'Verified Guest' });
    const created = await app.request('/api/rooms', { method: 'POST', headers: headers(hostToken), body: '{}' });
    expect(created.status).toBe(201);
    const { room } = await created.json();
    expect(room.hostId).toBe('user_host');
    expect((await app.request(`/api/rooms/${room.code}`, { headers: headers(guestToken) })).status).toBe(404);
    const guest = await app.request('/api/me', { headers: headers(guestToken) });
    expect((await guest.json()).rooms).toEqual([]);
    const host = await app.request('/api/me', { headers: headers(hostToken) });
    expect((await host.json()).rooms.map((item: { code: string }) => item.code)).toEqual([room.code]);
  });
  it('disables local identities and keeps verification configuration out of public responses', async () => {
    const { app, store } = fixture();
    const local = store.session('Local profile');
    expect((await app.request('/api/me', { headers: headers(local.token) })).status).toBe(401);
    expect((await app.request('/api/dev/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Bypass"}' })).status).toBe(403);
    const response = await app.request('/api/config');
    expect(await response.json()).toEqual({ localDevAuth: false, clerkConfigured: true });
  });
  it('refuses an empty origin allowlist which would disable SDK origin checks', () => {
    expect(() => createApp(new LocalRoomStore(null), { localDevAuth: false, allowedOrigins: [] })).toThrow('ALLOWED_ORIGINS');
    expect(() => createApp(new LocalRoomStore(null), { localDevAuth: false, allowedOrigins: ['*'] })).toThrow('ALLOWED_ORIGINS');
  });
});

describe('Clerk development launcher configuration', () => {
  const publicKey = 'pk_test_' + Buffer.from('test-issuer.clerk.accounts.dev$').toString('base64');
  const env = { VITE_CLERK_PUBLISHABLE_KEY: publicKey, CLERK_SECRET_KEY: 'sk_test_synthetic_placeholder' };
  it('derives the issuer, isolates local data and overrides local profile auth', () => {
    const config = clerkDevelopmentConfig({ ...env, LOCAL_DEV_AUTH: 'true' });
    expect(config.env.LOCAL_DEV_AUTH).toBe('false');
    expect(config.env.CLERK_ISSUER).toBe(issuer);
    expect(config.env.DATA_FILE).toBe('.data/auctionarena-clerk.json');
    expect(config.env.ALLOWED_ORIGINS).toContain(origin);
  });
  it('uses explicit nondefault ports for the API proxy and authorized party', () => {
    const config = clerkDevelopmentConfig({ ...env, API_PORT: '3201', WEB_PORT: '5373' });
    expect(config.apiPort).toBe(3201); expect(config.webPort).toBe(5373);
    expect(config.env.ALLOWED_ORIGINS).toContain('http://127.0.0.1:5373');
  });
  it('rejects absent/live keys, mismatched issuers and invalid ports without printing keys', () => {
    for (const overrides of [
      { CLERK_SECRET_KEY: undefined }, { CLERK_SECRET_KEY: 'sk_live_synthetic' }, { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_invalid' },
      { CLERK_ISSUER: 'https://wrong.example' }, { API_PORT: '-1' }, { API_PORT: '5173' }, { ALLOWED_ORIGINS: 'https://wrong.example' },
    ]) {
      try { clerkDevelopmentConfig({ ...env, ...overrides }); throw new Error('Should have rejected invalid config'); }
      catch (error) { expect(String(error)).not.toContain('Should have rejected'); expect(String(error)).not.toContain('synthetic'); }
    }
  });
});
