import { test, expect } from 'vitest';
import { applyAction, createRoom } from '../../packages/engine/src/index';
import { settingsForMode } from '../../packages/shared/src/domain';
import { planAuction } from '../../packages/catalog/src/planner';
import { catalog } from '../../packages/catalog/src/index';

const host = { id: 'host1', name: 'Host' };

test('a new room seeds the real catalog immediately, never sample players', () => {
  for (const [mode, expected, pool] of [['quick', 80, 80], ['standard', 120, 120], ['mega', 250, 250]] as const) {
    const settings = settingsForMode(mode);
    const room = createRoom('ABCDEF', host, settings, 1000);
    expect(room.players, mode).toHaveLength(expected);
    expect(room.players.filter(p => p.isSample), mode).toHaveLength(0);
    // Real catalog identities only.
    for (const player of room.players) {
      expect(player.id).toMatch(/^P\d{3}$/);
      expect(player.isSample).toBe(false);
    }
    // Stable IDs, no duplicates.
    expect(new Set(room.players.map(p => p.id)).size).toBe(room.players.length);
    // The pool is exactly the seeded planner selection for this mode, in order.
    const result = planAuction({ catalog, mode, seed: 'initial-' + mode + '-' + pool, rules: room.settings });
    expect(result.ok).toBe(true);
    expect(new Set(result.poolIds)).toEqual(new Set(room.players.map(p => p.id)));
    // Sequence, not just membership: the pool follows the catalog's own order so
    // the approved plan (which is separate) is the only source of lot ordering.
    const catalogOrder = catalog.players.map(p => p.id).filter(id => result.poolIds.includes(id));
    expect(room.players.map(p => p.id)).toEqual(catalogOrder);
    // A draft exists so the plan preview works without extra host action.
    expect(room.planDraft?.mode).toBe(mode);
  }
});

test('a room cannot be created without an auction mode', () => {
  const legacy = { ...settingsForMode('standard') } as Record<string, unknown>;
  delete legacy.mode;
  // Rejected before any pool is built, so a fictional sample room is unreachable.
  expect(() => createRoom('ABCDEF', host, legacy as never, 1000)).toThrow();
  // And a valid mode never yields sample players.
  const room = createRoom('ABCDEF', host, settingsForMode('standard'), 1000);
  expect(room.players.filter(p => p.isSample)).toHaveLength(0);
});

test('no fictional name from the legacy sample pool appears in a new room', () => {
  const fictional = ['Arjun Rathore', 'Kabir Mehta', 'Liam Fletcher', 'Dev Malhotra'];
  const room = createRoom('ABCDEF', host, settingsForMode('standard'), 1000);
  for (const name of fictional) {
    expect(room.players.some(p => p.name === name), name).toBe(false);
  }
  // Real IPL players are present.
  expect(room.players.some(p => p.name === 'KL Rahul')).toBe(true);
});

test('approving the plan reproduces the same player pool rather than replacing it', () => {
  const settings = settingsForMode('quick');
  const room = createRoom('ABCDEF', host, settings, 1000);
  const before = room.players.map(p => p.id).sort();
  // Claim two teams and approve the pre-seeded draft.
  room.teams[0].ownerId = 'host1';
  room.teams[1].ownerId = 'guest1';
  room.members.push({ id: 'guest1', name: 'Guest', connected: true, ready: false, lastSeen: 1000 });
  const approved = applyAction(room, 'host1', { id: 'a1', type: 'plan-approve', planVersion: room.planDraft!.planVersion }, 1001);
  expect(approved.players.map(p => p.id).sort()).toEqual(before);
  expect(approved.players).toHaveLength(80);
  expect(approved.plan?.mode).toBe('quick');
});
