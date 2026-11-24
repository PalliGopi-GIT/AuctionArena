import type { AuctionMode, PlayerRole, PlayerTier } from '../../shared/src/domain';
import type {
  Catalog, CatalogPlayer, PlanAdjustment, PlanRequest, PlanResult, PlanRules, PlanSet, Tier,
} from './types';

export const tiers: readonly Tier[] = ['A', 'B', 'C', 'D', 'E'];
export const roleOrder: readonly PlayerRole[] = ['Wicketkeeper', 'Batter', 'All-rounder', 'Bowler'];

export const defaultQuotas: Record<AuctionMode, Record<Tier, number>> = {
  quick: { A: 20, B: 25, C: 20, D: 10, E: 5 },
  standard: { A: 26, B: 35, C: 35, D: 16, E: 8 },
  mega: { A: 26, B: 45, C: 62, D: 71, E: 46 },
};

const tierRank: Record<Tier, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
const tierRedistribution: readonly Tier[] = ['B', 'C', 'D', 'E', 'A'];

/** Deterministic PRNG. The same seed always produces the same stream. */
export function createRng(seed: string) {
  let state = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  const next = () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const output = [...items];
    for (let index = output.length - 1; index > 0; index--) {
      const swap = Math.floor(next() * (index + 1));
      [output[index], output[swap]] = [output[swap]!, output[index]!];
    }
    return output;
  };
  return { next, shuffle };
}

function catalogPlayers(catalog: CatalogPlayer[] | Catalog): CatalogPlayer[] {
  return Array.isArray(catalog) ? catalog : catalog.players;
}

function countTiers(players: readonly CatalogPlayer[]): Record<Tier, number> {
  const counts: Record<Tier, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const player of players) counts[player.tier]++;
  return counts;
}

/** Fill each quota; move an unmet deficit to the next tier that has spare players. */
function resolveQuotas(counts: Record<Tier, number>, desired: Record<Tier, number>, adjustments: PlanAdjustment[]) {
  const quota = { ...desired };
  let deficit = 0;
  for (const tier of tiers) {
    if (counts[tier] < quota[tier]) {
      deficit += quota[tier] - counts[tier];
      adjustments.push({
        code: `QUOTA_${tier}`,
        message: `Tier ${tier} has ${counts[tier]} players, below the ${quota[tier]} requested; the shortfall moves to later tiers.`,
      });
      quota[tier] = counts[tier];
    }
  }
  for (const tier of tierRedistribution) {
    if (deficit <= 0) break;
    const spare = Math.max(0, counts[tier] - quota[tier]);
    const take = Math.min(spare, deficit);
    if (take > 0) {
      quota[tier] += take;
      deficit -= take;
      adjustments.push({
        code: `QUOTA_${tier}_UP`,
        message: `Tier ${tier} gains ${take} player${take === 1 ? '' : 's'} to keep the pool at its requested size.`,
      });
    }
  }
  return { quota, deficit };
}

function largestRemainder(counts: Record<PlayerRole, number>, quota: number): Record<PlayerRole, number> {
  const total = roleOrder.reduce((sum, role) => sum + counts[role], 0);
  const result = { Wicketkeeper: 0, Batter: 0, 'All-rounder': 0, Bowler: 0 } as Record<PlayerRole, number>;
  if (total === 0 || quota <= 0) return result;
  const fractions: { role: PlayerRole; value: number; index: number }[] = [];
  let assigned = 0;
  roleOrder.forEach((role, index) => {
    const exact = counts[role] * quota / total;
    const base = Math.min(counts[role], Math.floor(exact));
    result[role] = base;
    assigned += base;
    fractions.push({ role, value: exact - base, index });
  });
  const remaining = Math.min(quota, total) - assigned;
  fractions.sort((left, right) => right.value - left.value || left.index - right.index);
  for (let index = 0; index < remaining; index++) {
    const candidate = fractions.find(item => result[item.role] < counts[item.role]);
    if (!candidate) break;
    result[candidate.role]++;
    candidate.value = -1;
  }
  return result;
}

function selectTier(players: readonly CatalogPlayer[], quota: number, rng: ReturnType<typeof createRng>): CatalogPlayer[] {
  if (quota <= 0) return [];
  const byRole: Record<PlayerRole, CatalogPlayer[]> = { Wicketkeeper: [], Batter: [], 'All-rounder': [], Bowler: [] };
  for (const player of players) byRole[player.role].push(player);
  const targets = largestRemainder({
    Wicketkeeper: byRole.Wicketkeeper.length,
    Batter: byRole.Batter.length,
    'All-rounder': byRole['All-rounder'].length,
    Bowler: byRole.Bowler.length,
  }, quota);
  const picked: CatalogPlayer[] = [];
  const used = new Set<string>();
  for (const role of roleOrder) {
    const take = Math.min(targets[role], byRole[role].length);
    for (const player of rng.shuffle(byRole[role]).slice(0, take)) { picked.push(player); used.add(player.id); }
  }
  if (picked.length < quota) {
    const rest = rng.shuffle(players.filter(player => !used.has(player.id)));
    picked.push(...rest.slice(0, quota - picked.length));
  }
  return picked;
}

function partitionSizes(remaining: number, minSize = 5, maxSize = 8): number[] {
  if (remaining <= 0) return [];
  let count = Math.ceil(remaining / maxSize);
  while (count < remaining && remaining / count < minSize) count++;
  const base = Math.floor(remaining / count), extra = remaining % count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

/** Alternate low/high set indices so a tier is visible in the opening, middle and late rounds. */
function spreadIndices(from: number, to: number): number[] {
  const indices: number[] = [];
  let low = from, high = to;
  while (low <= high) {
    indices.push(low);
    if (low !== high) indices.push(high);
    low++; high--;
  }
  return indices;
}

function groupByRole(players: readonly CatalogPlayer[]): Record<PlayerRole, CatalogPlayer[]> {
  const groups: Record<PlayerRole, CatalogPlayer[]> = { Wicketkeeper: [], Batter: [], 'All-rounder': [], Bowler: [] };
  for (const player of players) groups[player.role].push(player);
  return groups;
}

function roleCounts(players: readonly CatalogPlayer[]): Record<PlayerRole, number> {
  const counts: Record<PlayerRole, number> = { Wicketkeeper: 0, Batter: 0, 'All-rounder': 0, Bowler: 0 };
  for (const player of players) counts[player.role]++;
  return counts;
}

/** A role can avoid a run longer than three only when the other roles supply enough separators. */
function mixedFeasible(counts: Record<PlayerRole, number>, total: number): boolean {
  return roleOrder.every(role => counts[role] <= 3 * (total - counts[role] + 1));
}

/**
 * Tier spreading can accidentally stack one role into a mixed set. Swap players
 * with another mixed set until every mixed roster can satisfy the three-run cap.
 */
function repairMixedRosters(rosters: CatalogPlayer[][], roleSets: ReadonlyMap<number, PlayerRole>) {
  const canUse = (index: number) => index > 0 && !roleSets.has(index);
  for (let pass = 0; pass < rosters.length * 3; pass++) {
    let repaired = false;
    for (let index = 0; index < rosters.length; index++) {
      if (!canUse(index)) continue;
      const roster = rosters[index]!;
      const counts = roleCounts(roster);
      const bad = roleOrder.find(role => counts[role] > 3 * (roster.length - counts[role] + 1));
      if (!bad) continue;
      let target: { index: number; player: CatalogPlayer } | null = null;
      // Prefer a swap that keeps both sets feasible; fall back to any different role.
      for (let donorIndex = 0; donorIndex < rosters.length && !target; donorIndex++) {
        if (donorIndex === index || !canUse(donorIndex)) continue;
        const donorRoster = rosters[donorIndex]!;
        const donorCounts = roleCounts(donorRoster);
        for (const player of donorRoster) {
          if (player.role === bad) continue;
          const nextRoster = { ...counts, [bad]: counts[bad] - 1, [player.role]: counts[player.role] + 1 };
          const nextDonor = { ...donorCounts, [player.role]: donorCounts[player.role] - 1, [bad]: donorCounts[bad] + 1 };
          if (mixedFeasible(nextRoster, roster.length) && mixedFeasible(nextDonor, donorRoster.length)) { target = { index: donorIndex, player }; break; }
        }
      }
      if (!target) {
        for (let donorIndex = 0; donorIndex < rosters.length && !target; donorIndex++) {
          if (donorIndex === index || !canUse(donorIndex)) continue;
          const player = rosters[donorIndex]!.find(entry => entry.role !== bad);
          if (player) target = { index: donorIndex, player };
        }
      }
      if (!target) continue;
      const outgoing = roster.find(entry => entry.role === bad)!;
      const sameTier = rosters[target.index]!.find(entry => entry.role === target!.player.role && entry.tier === outgoing.tier);
      const incoming = sameTier ?? target.player;
      rosters[index] = roster.map(entry => entry === outgoing ? incoming : entry);
      rosters[target.index] = rosters[target.index]!.map(entry => entry === incoming ? outgoing : entry);
      repaired = true;
    }
    if (!repaired) break;
  }
}

function tierPreference(index: number, totalSets: number): Tier[] {
  return index >= totalSets * 0.6 ? ['D', 'E', 'C', 'B', 'A'] : ['B', 'C', 'D', 'E', 'A'];
}

/** Arrange a mixed set so no role runs longer than three consecutive players. */
function arrangeMixed(players: readonly CatalogPlayer[], rng: ReturnType<typeof createRng>): CatalogPlayer[] {
  const shuffled = rng.shuffle(players);
  const queues = groupByRole(shuffled);
  for (const role of roleOrder) queues[role] = rng.shuffle(queues[role]);
  const output: CatalogPlayer[] = [];
  let runRole: PlayerRole | null = null, runLength = 0;
  while (output.length < shuffled.length) {
    const available = roleOrder.filter(role => queues[role].length > 0);
    if (!available.length) break;
    const legal = available.filter(role => !(role === runRole && runLength >= 3));
    const pool = legal.length ? legal : available;
    pool.sort((left, right) => queues[right].length - queues[left].length || roleOrder.indexOf(left) - roleOrder.indexOf(right));
    const role = pool[0]!;
    output.push(queues[role].pop()!);
    runLength = role === runRole ? runLength + 1 : 1;
    runRole = role;
  }
  return output;
}

function setLabel(players: readonly CatalogPlayer[], role: PlayerRole | null, used: Map<string, number>, opening: boolean): string {
  let base: string;
  if (opening) base = 'Opening Marquee';
  else if (role) base = role === 'All-rounder' ? 'All-rounders' : `${role}s`;
  else {
    const average = players.reduce((sum, player) => sum + tierRank[player.tier], 0) / Math.max(1, players.length);
    base = average <= 1.8 ? 'Established Mix' : average <= 2.8 ? 'Balanced Mix' : average <= 4.2 ? 'Emerging Mix' : 'Squad Builders';
  }
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base} ${count}`;
}

export function planAuction(request: PlanRequest): PlanResult {
  const adjustments: PlanAdjustment[] = [];
  const players = catalogPlayers(request.catalog);
  const byId = new Map(players.map(player => [player.id, player]));
  if (byId.size !== players.length) {
    return { ok: false, blockedReason: 'The catalog contains duplicate player IDs.', poolIds: [], sets: [], adjustments };
  }
  const rules = request.rules;
  const minimumPlayers = Math.max(2, rules.teamCount * rules.minSquad);
  if (players.length < minimumPlayers) {
    return {
      ok: false,
      blockedReason: `The catalog has ${players.length} players but ${rules.teamCount} teams with a minimum squad of ${rules.minSquad} need ${minimumPlayers}.`,
      poolIds: [], sets: [], adjustments,
    };
  }
  const rng = createRng(`${request.seed}:${request.mode}:plan-v1`);
  const counts = countTiers(players);
  let quota: Record<Tier, number>;
  if (request.mode === 'mega') {
    quota = { ...counts };
  } else {
    const resolved = resolveQuotas(counts, defaultQuotas[request.mode], adjustments);
    quota = resolved.quota;
    if (resolved.deficit > 0) {
      return {
        ok: false,
        blockedReason: `The catalog cannot supply the requested ${request.mode} pool of ${tiers.reduce((sum, tier) => sum + defaultQuotas[request.mode][tier], 0)} players.`,
        poolIds: [], sets: [], adjustments,
      };
    }
  }

  const selected: CatalogPlayer[] = [];
  for (const tier of tiers) selected.push(...selectTier(players.filter(player => player.tier === tier), quota[tier], rng));
  const unique = new Set(selected.map(player => player.id));
  if (unique.size !== selected.length) {
    return { ok: false, blockedReason: 'The planner selected a player more than once.', poolIds: [], sets: [], adjustments };
  }

  // Keep enough domestic players for every team to reach its minimum squad under the overseas cap.
  const domesticNeeded = rules.teamCount * Math.max(0, rules.minSquad - rules.maxOverseas);
  const domesticSelected = selected.filter(player => !player.overseas);
  if (domesticSelected.length < domesticNeeded) {
    const selectedIds = new Set(selected.map(player => player.id));
    const spareDomestic = players.filter(player => !player.overseas && !selectedIds.has(player.id));
    let swaps = domesticNeeded - domesticSelected.length;
    for (const overseas of selected.filter(player => player.overseas).reverse()) {
      if (swaps <= 0) break;
      const replacement = spareDomestic.find(player => player.tier === overseas.tier) ?? spareDomestic[0];
      if (!replacement) break;
      const index = selected.indexOf(overseas);
      selected[index] = replacement;
      spareDomestic.splice(spareDomestic.indexOf(replacement), 1);
      swaps--;
      adjustments.push({
        code: 'DOMESTIC_BALANCE',
        message: `${overseas.name} was replaced by ${replacement.name} to keep enough domestic players for ${rules.teamCount} teams.`,
      });
    }
    if (selected.filter(player => !player.overseas).length < domesticNeeded) {
      return {
        ok: false,
        blockedReason: 'The catalog cannot supply enough domestic players for the squad rules.',
        poolIds: [], sets: [], adjustments,
      };
    }
  }

  const marquee = selected.filter(player => player.marquee);
  const openingSize = Math.min(8, marquee.length);
  if (openingSize < 6) {
    return {
      ok: false,
      blockedReason: 'The catalog needs at least six marquee players for a mixed opening set.',
      poolIds: [], sets: [], adjustments,
    };
  }
  const marqueeByRole = groupByRole(rng.shuffle(marquee));
  const opening: CatalogPlayer[] = [];
  const openingRoles: PlayerRole[] = rng.shuffle(roleOrder) as PlayerRole[];
  while (opening.length < openingSize) {
    let added = false;
    for (const role of openingRoles) {
      const player = marqueeByRole[role].pop();
      if (player) { opening.push(player); added = true; }
      if (opening.length >= openingSize) break;
    }
    if (!added) break;
  }
  if (new Set(opening.map(player => player.role)).size < 2) {
    return {
      ok: false,
      blockedReason: 'The catalog cannot supply a mixed-role marquee opening set.',
      poolIds: [], sets: [], adjustments,
    };
  }

  const remaining = selected.filter(player => !opening.some(open => open.id === player.id));
  const sizes = partitionSizes(remaining.length);
  const totalSets = 1 + sizes.length;
  const capacities = [opening.length, ...sizes];
  const rosters: CatalogPlayer[][] = Array.from({ length: totalSets }, () => []);
  rosters[0] = opening;
  const assigned = new Set(opening.map(player => player.id));
  const available = remaining.filter(player => !assigned.has(player.id));
  const availableByRole = groupByRole(available);
  for (const role of roleOrder) availableByRole[role] = rng.shuffle(availableByRole[role]);

  const roleSets = new Map<number, PlayerRole>();
  const desiredRoleSets = Math.max(4, Math.round(totalSets * 0.35));
  const candidates = totalSets >= 6
    ? [...new Set(spreadIndices(2, Math.max(2, totalSets - 2)))].sort((left, right) => left - right)
    : [];
  const roleIndices: number[] = [];
  if (candidates.length) {
    const step = candidates.length / desiredRoleSets;
    for (let index = 0; index < desiredRoleSets; index++) {
      const candidate = candidates[Math.min(candidates.length - 1, Math.floor(index * step))]!;
      if (!roleIndices.includes(candidate)) roleIndices.push(candidate);
    }
  }
  roleIndices.forEach((setIndex, order) => {
    const role = roleOrder[order % roleOrder.length]!;
    const capacity = capacities[setIndex]!;
    const queue = availableByRole[role];
    if (queue.length < capacity) return;
    rosters[setIndex] = queue.splice(0, capacity);
    for (const player of rosters[setIndex]!) assigned.add(player.id);
    roleSets.set(setIndex, role);
  });

  /** Cycle through an index order, spreading each tier instead of filling the first set. */
  const spreadPlacer = (order: readonly number[], maxPerSet: number) => {
    let cursor = 0;
    return (player: CatalogPlayer) => {
      if (assigned.has(player.id)) return;
      for (let attempt = 0; attempt < order.length; attempt++) {
        const index = order[(cursor + attempt) % order.length]!;
        if (rosters[index]!.length >= capacities[index]!) continue;
        if (rosters[index]!.filter(entry => entry.tier === player.tier).length >= maxPerSet) continue;
        rosters[index]!.push(player); assigned.add(player.id); cursor = (cursor + attempt + 1) % order.length; return;
      }
      // Capacity may force a set beyond the soft per-set cap; keep cycling for fairness.
      for (let attempt = 0; attempt < order.length; attempt++) {
        const index = order[(cursor + attempt) % order.length]!;
        if (rosters[index]!.length >= capacities[index]!) continue;
        rosters[index]!.push(player); assigned.add(player.id); cursor = (cursor + attempt + 1) % order.length; return;
      }
      for (let index = 1; index < totalSets; index++) {
        if (rosters[index]!.length < capacities[index]!) { rosters[index]!.push(player); assigned.add(player.id); return; }
      }
    };
  };

  const ascending = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
  const tailStart = Math.max(1, totalSets - Math.max(2, Math.round(totalSets * 0.25)));
  const tailFirst = [...Array.from({ length: totalSets - tailStart }, (_, index) => totalSets - 1 - index), ...ascending(1, tailStart - 1)];

  const byTier = new Map<Tier, CatalogPlayer[]>();
  for (const tier of tiers) byTier.set(tier, rng.shuffle(selected.filter(player => player.tier === tier && !assigned.has(player.id))));
  const placeA = spreadPlacer(ascending(1, totalSets - 1), 1);
  const placeB = spreadPlacer(ascending(1, Math.max(1, totalSets - 2)), 2);
  const placeC = spreadPlacer(ascending(1, totalSets - 1), 2);
  const placeLate = spreadPlacer(tailFirst, 8);
  for (const player of byTier.get('A')!) placeA(player);
  for (const player of byTier.get('B')!) placeB(player);
  for (const player of byTier.get('C')!) placeC(player);
  for (const tier of ['D', 'E'] as const) for (const player of byTier.get(tier)!) placeLate(player);
  const placeRest = spreadPlacer(ascending(1, totalSets - 1), 8);
  for (const player of remaining) placeRest(player);
  for (const player of available) placeRest(player);
  repairMixedRosters(rosters, roleSets);

  if (rosters.some(roster => roster.length < 5)) {
    return {
      ok: false,
      blockedReason: 'The catalog cannot form auction sets of at least five players.',
      poolIds: [], sets: [], adjustments,
    };
  }

  const usedNames = new Map<string, number>();
  const sets: PlanSet[] = rosters.map((roster, index) => {
    const role = roleSets.get(index) ?? null;
    const ordered = role ? rng.shuffle(roster) : arrangeMixed(roster, rng);
    return { name: setLabel(ordered, role, usedNames, index === 0), playerIds: ordered.map(player => player.id) };
  });

  const poolIds = selected.map(player => player.id);
  if (poolIds.length !== new Set(poolIds).size) {
    return { ok: false, blockedReason: 'The planner produced a duplicate pool entry.', poolIds: [], sets: [], adjustments };
  }
  return { ok: true, poolIds, sets, adjustments };
}

/** Counts used by the host preview and tests. */
export function summarizeSelection(players: readonly CatalogPlayer[]) {
  const byTier: Record<Tier, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const byRole: Record<PlayerRole, number> = { Wicketkeeper: 0, Batter: 0, 'All-rounder': 0, Bowler: 0 };
  let overseas = 0;
  for (const player of players) {
    byTier[player.tier]++;
    byRole[player.role]++;
    if (player.overseas) overseas++;
  }
  return { total: players.length, byTier, byRole, overseas, domestic: players.length - overseas, marquee: players.filter(player => player.marquee).length };
}
