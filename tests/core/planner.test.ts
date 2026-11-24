import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { settingsSchema, type Settings } from '../../packages/shared/src/index';
import { createRoom } from '../../packages/engine/src/index';
import { catalog } from '../../packages/catalog/src/index';
import { defaultQuotas, planAuction } from '../../packages/catalog/src/planner';
import { approvePlan, planSummaryFor, setBoundaries } from '../../packages/catalog/src/room-plan';
import type { AuctionMode } from '../../packages/shared/src/domain';

const modes: AuctionMode[] = ['quick', 'standard', 'mega'];
const seeds = Array.from({ length: 30 }, (_, index) => `wp-h-seed-${index}`);
const rules = { teamCount: 8, minSquad: 3, maxSquad: 12, maxOverseas: 4 };
const byId = new Map(catalog.players.map(player => [player.id, player]));
const expectedSizes: Record<AuctionMode, number> = { quick: 80, standard: 120, mega: 250 };

function plan(mode: AuctionMode, seed: string, planRules = rules) {
  const result = planAuction({ catalog, mode, seed, rules: planRules });
  expect(result.ok, result.blockedReason).toBe(true);
  return result;
}

function rolesOf(ids: readonly string[]) {
  return ids.map(id => byId.get(id)!.role);
}

describe('WP-H seeded auction planner', () => {
  it('selects the requested pool size once per player for every mode and seed', () => {
    for (const mode of modes) {
      for (const seed of seeds) {
        const result = plan(mode, seed);
        expect(result.poolIds).toHaveLength(expectedSizes[mode]);
        expect(new Set(result.poolIds).size).toBe(expectedSizes[mode]);
        const ordered = result.sets.flatMap(set => set.playerIds);
        expect(ordered).toHaveLength(expectedSizes[mode]);
        expect(new Set(ordered).size).toBe(expectedSizes[mode]);
        expect([...ordered].sort()).toEqual([...result.poolIds].sort());
        expect(result.adjustments).toEqual([]);
      }
    }
  });

  it('meets the tier quotas and covers every role', () => {
    for (const mode of modes) {
      const result = plan(mode, 'wp-h-quota');
      const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
      for (const id of result.poolIds) counts[byId.get(id)!.tier]++;
      if (mode === 'mega') {
        const catalogCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        for (const player of catalog.players) catalogCounts[player.tier]++;
        expect(counts).toEqual(catalogCounts);
      } else {
        expect(counts).toEqual(defaultQuotas[mode]);
      }
      const roles = new Set(rolesOf(result.poolIds));
      expect(roles.size).toBe(4);
    }
  });

  it('keeps enough domestic players for the squad rules', () => {
    const strict = { teamCount: 8, minSquad: 5, maxSquad: 12, maxOverseas: 2 };
    for (const mode of modes) {
      const result = plan(mode, 'wp-h-domestic', strict);
      const domestic = result.poolIds.filter(id => !byId.get(id)!.overseas);
      expect(domestic.length).toBeGreaterThanOrEqual(strict.teamCount * (strict.minSquad - strict.maxOverseas));
    }
  });

  it('opens with a mixed-role marquee set of six to eight players', () => {
    for (const mode of modes) {
      for (const seed of seeds) {
        const result = plan(mode, seed);
        const opening = result.sets[0]!;
        expect(opening.name).toBe('Opening Marquee');
        expect(opening.playerIds.length).toBeGreaterThanOrEqual(6);
        expect(opening.playerIds.length).toBeLessThanOrEqual(8);
        expect(opening.playerIds.every(id => byId.get(id)!.marquee)).toBe(true);
        expect(opening.playerIds.every(id => byId.get(id)!.tier === 'A')).toBe(true);
        expect(new Set(rolesOf(opening.playerIds)).size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('uses sets of five to eight players and never repeats a set name', () => {
    for (const mode of modes) {
      const result = plan(mode, 'wp-h-sets');
      for (const set of result.sets) {
        expect(set.playerIds.length).toBeGreaterThanOrEqual(5);
        expect(set.playerIds.length).toBeLessThanOrEqual(8);
      }
      expect(new Set(result.sets.map(set => set.name)).size).toBe(result.sets.length);
    }
  });

  it('spreads marquee players across at least three sets', () => {
    for (const mode of modes) {
      for (const seed of seeds) {
        const result = plan(mode, seed);
        const marqueeSets = result.sets.filter(set => set.playerIds.some(id => byId.get(id)!.marquee));
        expect(marqueeSets.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('never runs more than three consecutive players of one role in a mixed set', () => {
    for (const mode of modes) {
      for (const seed of seeds) {
        const result = plan(mode, seed);
        for (const set of result.sets) {
          const roles = rolesOf(set.playerIds);
          if (new Set(roles).size === 1) continue;
          let runRole: string | null = null, run = 0;
          for (const role of roles) {
            run = role === runRole ? run + 1 : 1;
            runRole = role;
            expect(run, `${set.name} has a ${role} run`).toBeLessThanOrEqual(3);
          }
        }
      }
    }
  });

  it('places lower tiers towards the closing sets', () => {
    for (const mode of modes) {
      const result = plan(mode, 'wp-h-tail');
      const last = result.sets.at(-1)!;
      const tiers = last.playerIds.map(id => byId.get(id)!.tier);
      const late = tiers.filter(tier => tier === 'D' || tier === 'E').length;
      const early = tiers.filter(tier => tier === 'A').length;
      expect(late).toBeGreaterThan(0);
      expect(late).toBeGreaterThanOrEqual(early);
    }
  });

  it('is deterministic per seed and reshuffles for a different seed', () => {
    for (const mode of modes) {
      const first = plan(mode, 'wp-h-stable');
      const again = plan(mode, 'wp-h-stable');
      expect(again).toEqual(first);
      const other = plan(mode, 'wp-h-different');
      expect(other.poolIds).not.toEqual(first.poolIds);
    }
  });

  it('keeps the planner pure: no clock, randomness or environment access', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'catalog', 'src', 'planner.ts'), 'utf8');
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/\bDate\b/);
    expect(source).not.toMatch(/\bperformance\b/);
    expect(source).not.toMatch(/\bprocess\./);
    expect(source).not.toMatch(/\bglobalThis\b/);
    expect(source).not.toMatch(/\bwindow\b/);
    expect(source).not.toMatch(/\bdocument\b/);
  });
});

describe('WP-H plan approval', () => {
  const settings: Settings = settingsSchema.parse({ teamCount: 8, minSquad: 3, maxSquad: 12, maxOverseas: 4 });

  it('persists IDs and boundaries while players stay in catalog order', () => {
    const room = createRoom('ABC123', { id: 'host', name: 'Host' }, settings, 1000);
    const draft = { mode: 'standard' as const, seed: 'wp-h-approve', planVersion: 1 };
    const approved = approvePlan(room, catalog, draft, 5000, 'host');
    expect(approved.ok).toBe(true);
    const plan = approved.plan!;
    expect(plan.catalogVersion).toBe(catalog.catalogVersion);
    expect(plan.approvedAt).toBe(5000);
    expect(plan.approvedBy).toBe('host');
    expect(plan.orderedPlayerIds).toHaveLength(120);
    expect(plan.setBoundaries).toHaveLength(15);
    expect(plan.setBoundaries[0]).toEqual({ name: 'Opening Marquee', start: 0, count: 8 });
    for (const [index, boundary] of plan.setBoundaries.entries()) {
      const next = plan.setBoundaries[index + 1];
      if (next) expect(boundary.start + boundary.count).toBe(next.start);
    }
    const last = plan.setBoundaries.at(-1)!;
    expect(last.start + last.count).toBe(120);
    const catalogOrder = catalog.players.map(player => player.id).filter(id => plan.orderedPlayerIds.includes(id));
    expect(approved.players!.map(player => player.id)).toEqual(catalogOrder);
  });

  it('derives a summary without exposing the upcoming order', () => {
    const room = createRoom('ABC124', { id: 'host', name: 'Host' }, settings, 1000);
    const approved = approvePlan(room, catalog, { mode: 'quick', seed: 'wp-h-summary', planVersion: 1 }, 5000, 'host');
    room.plan = approved.plan!;
    room.players = approved.players!;
    room.planPosition = 0;
    room.players.find(player => player.id === room.plan!.orderedPlayerIds[0]!)!.status = 'open';
    const summary = planSummaryFor(room)!;
    expect(summary.mode).toBe('quick');
    expect(summary.setName).toBe('Opening Marquee');
    expect(summary.position).toBe(1);
    expect(summary.total).toBe(80);
    expect(summary.remaining).toBe(79);
    expect(JSON.stringify(summary)).not.toContain('P0');
  });

  it('keeps set boundaries contiguous for every mode', () => {
    for (const mode of modes) {
      const result = plan(mode, 'wp-h-boundaries');
      const boundaries = setBoundaries(result.sets);
      expect(boundaries[0]!.start).toBe(0);
      expect(boundaries.reduce((sum, boundary) => sum + boundary.count, 0)).toBe(expectedSizes[mode]);
    }
  });
});
