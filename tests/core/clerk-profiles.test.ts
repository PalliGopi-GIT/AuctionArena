import { describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../../apps/api/src/app';
import { ClerkProfiles, clerkProfileName, displayName, type ClerkProfile } from '../../apps/api/src/clerk-profiles';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { attachRoomSocket } from '../../apps/api/src/room-socket';
import { deriveAuctionResults } from '../../packages/results/src/index';
import { actionSchema, settingsSchema, type Action } from '../../packages/shared/src/index';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const issuer = 'https://profiles-test.clerk.accounts.dev', origin = 'http://127.0.0.1:5173';
function token(id = 'user_host', claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'profiles-test' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: id, sid: 'sess_' + id, iss: issuer, azp: origin, iat: now, nbf: now - 5, exp: now + 60, ...claims })).toString('base64url')].join('.');
  return body + '.' + sign('RSA-SHA256', Buffer.from(body), keys.privateKey).toString('base64url');
}
const profile = (id = 'user_host', firstName = 'Verified', lastName = 'Captain'): ClerkProfile => ({ id, firstName, lastName, username: null });
const headers = (id = 'user_host', claims?: Record<string, unknown>) => ({ Authorization: 'Bearer ' + token(id, claims), 'Content-Type': 'application/json' });
const options = { localDevAuth: false, clerkJwtKey: jwtKey, clerkIssuer: issuer, allowedOrigins: [origin] };

describe('server-derived participant names', () => {
  it('uses full name, partial name, username or a private fallback, with bounded Unicode-safe display text', () => {
    expect(clerkProfileName(profile())).toBe('Verified Captain');
    expect(clerkProfileName({ ...profile(), firstName: null })).toBe('Captain');
    expect(clerkProfileName({ ...profile(), firstName: '  आशा\n', lastName: '  Rao\u0000 ' })).toBe('आशा Rao');
    expect(clerkProfileName({ id: 'user_x', firstName: null, lastName: null, username: ' Captain42 ' })).toBe('Captain42');
    expect(clerkProfileName({ ...profile(), firstName: null, lastName: null, emailAddress: 'private@example.com' } as ClerkProfile)).toBe('Auction fan');
    expect(displayName('😀'.repeat(70))).toBe('😀'.repeat(60));
    expect(displayName({ name: 'not a string' })).toBe('');
  });

  it('loads only after real token verification, persists only public name data, and caches repeated reads', async () => {
    const store = new LocalRoomStore(null, () => 100000);
    const lookup = vi.fn(async (id: string) => ({ ...profile(id), emailAddress: 'private@example.com', privateMetadata: { secret: 'never-public' } }));
    const { app } = createApp(store, { ...options, clerkProfileLookup: lookup });
    expect((await app.request('/api/me', { headers: headers('user_host', { iss: 'https://foreign.example' }) })).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) {
      const response = await app.request('/api/me', { headers: headers('user_host', { name: 'Old token name' }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ user: { id: 'user_host', name: 'Verified Captain' }, rooms: [] });
    }
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_host');
    expect(store.profile('user_host')?.user).toEqual({ id: 'user_host', name: 'Verified Captain' });
  });

  it('separates colliding provider names without changing verified ownership or host permissions', async () => {
    const store = new LocalRoomStore(null, () => 100000);
    const { app } = createApp(store, { ...options, clerkProfileLookup: async id => profile(id) });
    const created = await app.request('/api/rooms', { method: 'POST', headers: headers(), body: '{}' });
    const { room, inviteToken } = await created.json();
    expect(room.members[0]).toMatchObject({ id: 'user_host', name: 'Verified Captain' });
    expect((await app.request(`/api/rooms/${room.code}`, { headers: headers('user_guest') })).status).toBe(403);
    await app.request(`/api/rooms/${room.code}/join`, { method: 'POST', headers: headers('user_guest'), body: JSON.stringify({ inviteToken }) });
    for (const [id, teamId] of [['user_host', 't1'], ['user_guest', 't2']]) {
      const response = await app.request(`/api/rooms/${room.code}/actions`, { method: 'POST', headers: headers(id), body: JSON.stringify({ id: crypto.randomUUID(), type: 'claim', teamId }) });
      expect(response.status).toBe(200);
    }
    const saved = store.get(room.code, { id: 'user_host', name: '' });
    expect(saved.members[0]?.name).toBe('Verified Captain');
    expect(saved.members[1]?.name.startsWith('Verified Captain')).toBe(true);
    expect(new Set(saved.members.map(member=>member.name)).size).toBe(2);
    expect(saved.teams.slice(0, 2).map(team => team.ownerId)).toEqual(['user_host', 'user_guest']);
    const denied = await app.request(`/api/rooms/${room.code}/actions`, { method: 'POST', headers: headers('user_guest'), body: JSON.stringify({ id: crypto.randomUUID(), type: 'start' }) });
    expect((await denied.json()).code).toBe('HOST_ONLY');
  });

  it('coalesces concurrent lookups, refreshes expired data and never fetches for an intent or socket ticket', async () => {
    let now = 100000;
    const store = new LocalRoomStore(null, () => now);
    const lookup = vi.fn(async (id: string) => profile(id));
    const resolver = new ClerkProfiles(store, lookup, () => now);
    const verified = { id: 'user_host', name: 'Auction fan' };
    await Promise.all([resolver.resolve(verified, true), resolver.resolve(verified, true), resolver.resolve(verified, true)]);
    expect(lookup).toHaveBeenCalledTimes(1);
    now += 300001;
    expect((await resolver.resolve(verified, false)).name).toBe('Verified Captain');
    expect(lookup).toHaveBeenCalledTimes(1);
    await resolver.resolve(verified, true);
    expect(lookup).toHaveBeenCalledTimes(2);
    const freshStore = new LocalRoomStore(null, () => now);
    const { room } = freshStore.create(verified, settingsSchema.parse({}));
    const { app } = createApp(freshStore, { ...options, clerkProfileLookup: lookup });
    await app.request(`/api/rooms/${room.code}/ws-ticket`, { method: 'POST', headers: headers(), body: '{}' });
    await app.request(`/api/rooms/${room.code}/actions`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: crypto.randomUUID(), type: 'claim', teamId: 't1' }) });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(freshStore.profile(verified.id)).toBeUndefined();
  });

  it('backs off provider failures and keeps a known name through outages and subject mismatches', async () => {
    let now = 100000;
    const store = new LocalRoomStore(null, () => now);
    store.projectProfile({ id: 'user_host', name: 'Saved Name' }, 0);
    now += 300001;
    const lookup = vi.fn(async () => { throw new Error('sensitive provider details'); });
    const resolver = new ClerkProfiles(store, lookup, () => now);
    const verified = { id: 'user_host', name: 'Auction fan' };
    expect((await resolver.resolve(verified, true)).name).toBe('Saved Name');
    await resolver.resolve(verified, true);
    expect(lookup).toHaveBeenCalledTimes(1);
    now += 30001;
    await resolver.resolve(verified, true);
    expect(lookup).toHaveBeenCalledTimes(2);
    const mismatched = new ClerkProfiles(store, async () => profile('user_other'), () => now);
    expect((await mismatched.resolve(verified, true)).name).toBe('Saved Name');
    expect(store.profile('user_other')).toBeUndefined();
  });

  it('limits lookup latency, ignores a late response and allows first use during a provider outage', async () => {
    const store = new LocalRoomStore(null);
    let finish!: (profile: ClerkProfile) => void;
    const resolver = new ClerkProfiles(store, () => new Promise(resolve => { finish = resolve; }), Date.now, 10);
    expect(await resolver.resolve({ id: 'user_host', name: 'Signed Claim' }, true)).toEqual({ id: 'user_host', name: 'Signed Claim' });
    finish(profile());
    await Promise.resolve();
    expect(store.profile('user_host')).toBeUndefined();
    const { app } = createApp(store, { ...options, clerkProfileLookup: async () => { throw new Error('private backend response'); } });
    const response = await app.request('/api/rooms', { method: 'POST', headers: headers(), body: '{}' });
    expect(response.status).toBe(201);
    expect((await response.json()).room.members[0].name).toBe('Auction fan');
  });

  it('projects renamed completed-room owners durably and broadcasts without changing auction state', () => {
    const directory = mkdtempSync(join(process.cwd(), '.data', 'profile-test-'));
    const path = join(directory, 'db.json');
    try {
      let now = 100000;
      const host = { id: 'user_host', name: 'Auction fan' }, guest = { id: 'user_guest', name: 'Auction fan' };
      const store = new LocalRoomStore(path, () => now);
      const { room, inviteToken } = store.create(host, settingsSchema.parse({ teamCount: 2, minSquad: 1, maxSquad: 2, maxOverseas: 2, timerSeconds: 10, autoAdvance: false, lateExtension: false }));
      store.join(room.code, guest, inviteToken);
      const action = (user: typeof host, type: Action['type'], extra: object = {}) => store.action(room.code, user, actionSchema.parse({ id: crypto.randomUUID(), type, ...extra }));
      action(host, 'claim', { teamId: 't1' }); action(guest, 'claim', { teamId: 't2' }); action(host, 'start');
      action(guest, 'bid', { amount: 100, playerId: 'p1' });
      const deadline = store.get(room.code, host).deadline!;
      now = deadline - 1; store.get(room.code, host, true);
      now = deadline + 1; store.sweep();
      action(host, 'end');
      const before = store.get(room.code, host);
      const frames: string[] = [];
      attachRoomSocket(store, room.code, host, { readyState: 1, bufferedAmount: 0, send: data => frames.push(data), close: () => {}, on: () => {} }, () => now);
      store.projectProfile({ ...guest, name: 'Verified Guest' }, now);
      const after = store.get(room.code, host);
      expect(after.members.find(member => member.id === guest.id)?.name).toBe('Verified Guest');
      expect(after.teams).toEqual(before.teams); expect(after.players).toEqual(before.players);
      expect(after.status).toBe('COMPLETED'); expect(after.hostId).toBe(before.hostId);
      expect(after.currentBid).toBe(before.currentBid); expect(after.deadline).toBe(before.deadline);
      expect(after.version).toBe(before.version + 1);
      expect(JSON.parse(frames.at(-1)!).room.members[1].name).toBe('Verified Guest');
      expect(deriveAuctionResults(after).teams[1]!.ownerName).toBe('Verified Guest');
      expect(deriveAuctionResults(after).teams[1]!.spent).toBe(100);
      store.projectProfile({ ...guest, name: 'Verified Guest' }, now + 1);
      expect(store.get(room.code, host).version).toBe(after.version);
      const restored = new LocalRoomStore(path, () => now);
      expect(restored.profile(guest.id)?.user.name).toBe('Verified Guest');
      expect(restored.get(room.code, guest).members[1]!.name).toBe('Verified Guest');
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      delete saved.profiles; writeFileSync(path, JSON.stringify(saved));
      expect(() => new LocalRoomStore(path, () => now)).not.toThrow();
      saved.profiles = { user_host: { name: 'bad', fetchedAt: 'invalid' } }; writeFileSync(path, JSON.stringify(saved));
      expect(() => new LocalRoomStore(path, () => now)).toThrow('Profile invariant');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
