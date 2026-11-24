import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/api/src/app';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { applyAction, createRoom, settle } from '../../packages/engine/src/index';
import { settingsSchema, type Action, type Room, type User } from '../../packages/shared/src/index';
import { roomSnapshot } from '../../packages/shared/src/room-sync';

const host: User = { id: 'plan_host', name: 'Plan Host' };
const guest: User = { id: 'plan_guest', name: 'Plan Guest' };
const dirs: string[] = [];
let sequence = 0;

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), 'auctionarena-plan-'));
  dirs.push(dir);
  return join(dir, 'db.json');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fixture(options: { path?: string; now?: () => number; autoAdvance?: boolean } = {}) {
  const now = options.now ?? (() => 100000);
  const store = new LocalRoomStore(options.path ?? null, now);
  const { app } = createApp(store, { localDevAuth: true });
  const hostSession = store.session(host.name), guestSession = store.session(guest.name);
  const hostUser = hostSession.user, guestUser = guestSession.user;
  const hostToken = hostSession.token, guestToken = guestSession.token;
  // Explicitly isolated legacy fixture: plan previews may use either mode, which
  // a fixed-mode HTTP room no longer allows, so it is created through the store.
  const legacySettings = settingsSchema.parse({ teamCount: 4, minSquad: 2, maxSquad: 8, maxOverseas: 4, autoAdvance: options.autoAdvance ?? false });
  const legacy = store.create(hostUser, legacySettings);
  const room = legacy.room, inviteToken = legacy.inviteToken;
  store.join(room.code, guestUser, inviteToken);
  for (const [token, teamId] of [[hostToken, 't1'], [guestToken, 't2']] as const) {
    const response = await app.request(`/api/rooms/${room.code}/actions`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ id: `claim-${teamId}`, type: 'claim', teamId }),
    });
    expect(response.status).toBe(200);
  }
  const action = (user: User, token: string, body: Record<string, unknown>) => app.request(`/api/rooms/${room.code}/actions`, {
    method: 'POST', headers: auth(token), body: JSON.stringify(body),
  });
  return { app, store, code: room.code, hostToken, guestToken, hostUser, guestUser, now, action };
}

describe('WP-H room plan persistence and host-only access', () => {
  it('persists the recall decision in the local API and lets the host finish without reopening unsold lots', async () => {
    let now = 100_000;
    const path = tempPath();
    const f = await fixture({ path, now: () => now, autoAdvance: true });
    const send = async (body: Record<string, unknown>) => {
      const response = await f.action(f.hostUser, f.hostToken, body);
      expect(response.status).toBe(200);
      return (await response.json() as { room: Room }).room;
    };
    await send({ type: 'plan-preview', mode: 'quick', id: 'skip-preview' });
    let state = await send({ type: 'plan-approve', planVersion: 1, id: 'skip-approve' });
    for (let n = 0; n < 80; n++) {
      while (now < state.deadline!) {
        now = Math.min(now + 5_000, state.deadline!);
        f.store.get(f.code, f.hostUser, true);
      }
      const result = f.store.get(f.code, f.hostUser);
      expect(result.status).toBe('RESULT');
      if (n < 79) {
        now = result.resultAt!;
        state = f.store.get(f.code, f.hostUser, true);
        expect(state.status).toBe('LIVE');
      }
    }
    state = f.store.get(f.code, f.hostUser);
    expect(state).toMatchObject({ status: 'RESULT', recallRound: { status: 'offered' }, resultAt: null });
    const reopened = new LocalRoomStore(path, () => now);
    const recovered = createApp(reopened, { localDevAuth: true }).app;
    const get = () => recovered.request('/api/rooms/' + f.code, { headers: auth(f.hostToken) });
    expect(await (await get()).json()).toMatchObject({ room: { recallSummary: { status: 'offered' } } });
    const response = await recovered.request('/api/rooms/' + f.code + '/actions', {
      method: 'POST', headers: auth(f.hostToken),
      body: JSON.stringify({ type: 'next', id: 'skip-finish' }),
    });
    expect(response.status).toBe(200);
    const final = (await response.json() as { room: Room }).room;
    expect(final).toMatchObject({ status: 'COMPLETED', completion_reason: 'POOL_EXHAUSTED' });
    expect(final.players.every(player => player.status === 'unsold')).toBe(true);
    expect(final.recallSummary).toBeUndefined();
  }, 60_000);
  it('injects the seed on the server and never exposes it to participants', async () => {
    const f = await fixture();
    const preview = await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'standard' });
    expect(preview.status).toBe(200);
    const body = await preview.json() as { room: Room };
    expect(body.room.planSummary).toBeUndefined();
    const stored = f.store.get(f.code, f.hostUser);
    expect(stored.planDraft).toMatchObject({ mode: 'standard', planVersion: 1 });
    expect(stored.planDraft!.seed.length).toBeGreaterThan(16);
    expect(JSON.stringify(body.room)).not.toContain(stored.planDraft!.seed);
    expect(JSON.stringify(body.room)).not.toContain('orderedPlayerIds');

    const participant = await f.action(guest, f.guestToken, { id: 'plan-guest', type: 'plan-preview', mode: 'standard' });
    expect(participant.status).toBe(400);
    expect(await participant.json()).toMatchObject({ code: 'HOST_ONLY' });
  });

  it('serves the full preview to the host only', async () => {
    const f = await fixture();
    expect((await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'standard' })).status).toBe(200);
    const hostPreview = await f.app.request(`/api/rooms/${f.code}/plan`, { headers: auth(f.hostToken) });
    expect(hostPreview.status).toBe(200);
    const plan = (await hostPreview.json() as { plan: { counts: { total: number }; sets: unknown[]; poolIds: string[]; approved: boolean } }).plan;
    expect(plan.approved).toBe(false);
    expect(plan.counts.total).toBe(120);
    expect(plan.sets).toHaveLength(15);
    expect(plan.poolIds).toHaveLength(120);
    const guestPreview = await f.app.request(`/api/rooms/${f.code}/plan`, { headers: auth(f.guestToken) });
    expect(guestPreview.status).toBe(403);
    expect(await guestPreview.json()).toMatchObject({ code: 'HOST_ONLY' });
  });

  it('regenerates with a new server seed and rejects a stale approval', async () => {
    const f = await fixture();
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'quick' });
    const first = f.store.get(f.code, f.hostUser).planDraft!;
    await f.action(host, f.hostToken, { id: 'plan-2', type: 'plan-regenerate', mode: 'quick' });
    const second = f.store.get(f.code, f.hostUser).planDraft!;
    expect(second.planVersion).toBe(2);
    expect(second.seed).not.toBe(first.seed);
    const stale = await f.action(host, f.hostToken, { id: 'plan-stale', type: 'plan-approve', planVersion: 1 });
    expect(stale.status).toBe(400);
    expect(await stale.json()).toMatchObject({ code: 'STALE_PLAN' });
    expect(f.store.get(f.code, f.hostUser).plan).toBeUndefined();
  });

  it('approves atomically and follows the persisted order exactly once', async () => {
    const f = await fixture();
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'quick' });
    const approved = await f.action(host, f.hostToken, { id: 'plan-approve-1', type: 'plan-approve', planVersion: 1 });
    expect(approved.status).toBe(200);
    const body = await approved.json() as { room: Room };
    expect(body.room.status).toBe('LIVE');
    expect(body.room.players).toHaveLength(80);
    expect(body.room.plan).toBeUndefined();
    expect(body.room.planDraft).toBeUndefined();
    expect(body.room.planSummary).toMatchObject({ mode: 'quick', setName: 'Opening Marquee', position: 1, total: 80, remaining: 79 });
    const stored = f.store.get(f.code, f.hostUser);
    expect(stored.plan!.orderedPlayerIds).toHaveLength(80);
    expect(new Set(stored.plan!.orderedPlayerIds).size).toBe(80);
    expect(stored.currentPlayerIndex).toBeGreaterThanOrEqual(0);
    expect(stored.players[stored.currentPlayerIndex]!.id).toBe(stored.plan!.orderedPlayerIds[0]);

    // Settle the opening lot and advance; the second lot is the plan's second ID.
    const opened = stored.players[stored.currentPlayerIndex]!;
    settle(stored, stored.deadline!);
    const next = applyAction(stored, f.hostUser.id, { id: 'advance-1', type: 'next' } as Action, f.now() + 90000);
    expect(next.players[next.currentPlayerIndex]!.id).toBe(next.plan!.orderedPlayerIds[1]);
    expect(next.players[next.currentPlayerIndex]!.id).not.toBe(opened.id);
  });

  it('keeps the approved plan immutable after the auction starts', async () => {
    const f = await fixture();
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'quick' });
    await f.action(host, f.hostToken, { id: 'plan-approve-1', type: 'plan-approve', planVersion: 1 });
    for (const body of [
      { id: 'late-preview', type: 'plan-preview', mode: 'mega' },
      { id: 'late-regen', type: 'plan-regenerate', mode: 'mega' },
      { id: 'late-approve', type: 'plan-approve', planVersion: 1 },
    ]) {
      const response = await f.action(host, f.hostToken, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'PLAN_LOCKED' });
    }
  });

  it('exports draft and approved orders as host-only CSV', async () => {
    const f = await fixture();
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'quick' });
    const early = await f.app.request(`/api/rooms/${f.code}/plan/export`, { headers: auth(f.hostToken) });
    expect(early.status).toBe(200);
    const draftLines = (await early.text()).trim().split(/\r?\n/);
    expect(draftLines).toHaveLength(81);
    expect(draftLines[0]).toContain('position,set name,player ID');
    expect(draftLines[1]).toContain('Opening Marquee');
    await f.action(host, f.hostToken, { id: 'plan-approve-1', type: 'plan-approve', planVersion: 1 });
    const response = await f.app.request(`/api/rooms/${f.code}/plan/export`, { headers: auth(f.hostToken) });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const lines = (await response.text()).trim().split(/\r?\n/);
    expect(lines).toHaveLength(81);
    expect(lines[0]).toContain('position,set name,player ID');
    expect(lines[1]).toContain('Opening Marquee');
    expect(lines).toEqual(draftLines);
    const guestResponse = await f.app.request(`/api/rooms/${f.code}/plan/export`, { headers: auth(f.guestToken) });
    expect(guestResponse.status).toBe(403);
  });

  it('auto-approves a pending preview when the host presses start', async () => {
    const f = await fixture();
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'standard' });
    const started = await f.action(host, f.hostToken, { id: 'start-1', type: 'start' });
    expect(started.status).toBe(200);
    const body = await started.json() as { room: Room };
    expect(body.room.status).toBe('LIVE');
    expect(body.room.planSummary).toMatchObject({ mode: 'standard', total: 120 });
    expect(body.room.plan).toBeUndefined();
  });

  it('survives a local restart with the same order and current lot', async () => {
    const path = tempPath();
    const f = await fixture({ path });
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'quick' });
    await f.action(host, f.hostToken, { id: 'plan-approve-1', type: 'plan-approve', planVersion: 1 });
    const before = f.store.get(f.code, f.hostUser);
    const restarted = new LocalRoomStore(path, f.now);
    const after = restarted.get(f.code, f.hostUser);
    expect(after.plan).toEqual(before.plan);
    expect(after.currentPlayerIndex).toBe(before.currentPlayerIndex);
    expect(after.status).toBe('PAUSED');
    expect(after.pauseReason).toContain('restarted');
    const snapshot = roomSnapshot(after);
    expect(snapshot.planSummary).toEqual(roomSnapshot(before).planSummary);
    expect(snapshot.plan).toBeUndefined();
    expect(snapshot.planDraft).toBeUndefined();
    expect(snapshot.planPosition).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain(after.plan!.seed);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(128 * 1024);
  });

  it('persists a mega plan without leaking the order into snapshots', async () => {
    const f = await fixture();
    await f.action(host, f.hostToken, { id: 'plan-1', type: 'plan-preview', mode: 'mega' });
    const approved = await f.action(host, f.hostToken, { id: 'plan-approve-1', type: 'plan-approve', planVersion: 1 });
    expect(approved.status).toBe(200);
    const stored = f.store.get(f.code, f.hostUser);
    expect(stored.players).toHaveLength(250);
    expect(stored.plan!.orderedPlayerIds).toHaveLength(250);
    expect(stored.plan!.setBoundaries).toHaveLength(32);
    const snapshot = roomSnapshot(stored);
    expect(snapshot.plan).toBeUndefined();
    expect(snapshot.planSummary).toMatchObject({ mode: 'mega', total: 250, position: 1 });
    expect(JSON.stringify(snapshot)).not.toContain(stored.plan!.seed);
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(128 * 1024);
  });

  it('rejects a plan preview before any draft exists', async () => {
    const f = await fixture();
    const response = await f.app.request(`/api/rooms/${f.code}/plan`, { headers: auth(f.hostToken) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'PLAN_REQUIRED' });
  });

  it('keeps legacy rooms on the sample pool until a plan is approved', () => {
    // Historical, mode-less rooms are the one place the legacy sample pool is
    // legitimate; the HTTP creation paths never reach this shape (see the
    // creation-mode-guard suite).
    const room = createRoom('LEGACY', host, settingsSchema.parse({}), 1000);
    expect(room.players[0]!.isSample).toBe(true);
    expect(room.plan).toBeUndefined();
    expect(room.players.every(player => player.stats !== undefined)).toBe(true);
  });
});
