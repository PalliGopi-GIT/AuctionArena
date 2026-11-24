import type { AuctionMode, PlanSetBoundary, Player, Room, RoomPlan } from '../../shared/src/domain';
import { auctionModeLabels, planSummaryFor } from '../../shared/src/domain';
import type { Action } from '../../shared/src/index';
import { planAuction, summarizeSelection } from './planner';
import type { Catalog, CatalogPlayer, PlanAdjustment } from './types';

export function toRoomPlayers(players: readonly CatalogPlayer[]): Player[] {
  return players.map(player => ({
    id: player.id, name: player.name, country: player.country, role: player.role,
    basePrice: player.basePrice, overseas: player.overseas, isSample: false,
    battingStyle: player.battingStyle, bowlingStyle: player.bowlingStyle,
    tier: player.tier, marquee: player.marquee, image: player.image, imageStatus: player.imageStatus,
    status: 'upcoming' as const,
  }));
}

export function setBoundaries(sets: readonly { name: string; playerIds: string[] }[]): PlanSetBoundary[] {
  let start = 0;
  return sets.map(set => {
    const boundary = { name: set.name, start, count: set.playerIds.length };
    start += set.playerIds.length;
    return boundary;
  });
}

export interface ApprovedPlanResult {
  ok: boolean;
  blockedReason?: string;
  plan?: RoomPlan;
  players?: Player[];
  adjustments: PlanAdjustment[];
}

/** Reproduce the plan from its seed and commit only IDs and boundaries to the room. */
export function approvePlan(room: Room, catalog: Catalog, draft: { mode: AuctionMode; seed: string; planVersion: number }, now: number, approvedBy: string): ApprovedPlanResult {
  const result = planAuction({ catalog, mode: draft.mode, seed: draft.seed, rules: room.settings });
  if (!result.ok) return { ok: false, blockedReason: result.blockedReason, adjustments: result.adjustments };
  const ordered = result.sets.flatMap(set => set.playerIds);
  const selectedIds = new Set(result.poolIds);
  // room.players stays in catalog order so snapshots cannot leak the plan order.
  const pool = catalog.players.filter(player => selectedIds.has(player.id));
  return {
    ok: true,
    adjustments: result.adjustments,
    players: toRoomPlayers(pool),
    plan: {
      catalogVersion: catalog.catalogVersion,
      mode: draft.mode,
      seed: draft.seed,
      planVersion: draft.planVersion,
      approvedAt: now,
      approvedBy,
      orderedPlayerIds: ordered,
      setBoundaries: setBoundaries(result.sets),
    },
  };
}

export { planSummaryFor };

export interface PreviewSet { name: string; count: number; players: CatalogPlayer[] }
export interface PlanPreview {
  ok: boolean;
  mode: AuctionMode;
  planVersion: number;
  catalogVersion: string;
  approved: boolean;
  approvedAt?: number;
  approvedBy?: string;
  blockedReason?: string;
  adjustments: PlanAdjustment[];
  counts: ReturnType<typeof summarizeSelection>;
  sets: PreviewSet[];
  poolIds: string[];
}

function approvedPreview(room: Room, catalog: Catalog): PlanPreview {
  const plan = room.plan!;
  const byId = new Map(catalog.players.map(player => [player.id, player]));
  const sets: PreviewSet[] = plan.setBoundaries.map(boundary => {
    const players = plan.orderedPlayerIds.slice(boundary.start, boundary.start + boundary.count)
      .map(id => byId.get(id)).filter((player): player is CatalogPlayer => !!player);
    return { name: boundary.name, count: players.length, players };
  });
  const selected = plan.orderedPlayerIds.map(id => byId.get(id)).filter((player): player is CatalogPlayer => !!player);
  return {
    ok: true, mode: plan.mode, planVersion: plan.planVersion, catalogVersion: plan.catalogVersion,
    approved: true, approvedAt: plan.approvedAt, approvedBy: plan.approvedBy,
    adjustments: [], counts: summarizeSelection(selected), sets, poolIds: selected.map(player => player.id),
  };
}

/** Host-only preview; participants never receive the seed or the order. */
export function buildPlanPreview(room: Room, catalog: Catalog): PlanPreview {
  if (room.plan) return approvedPreview(room, catalog);
  const draft = room.planDraft;
  if (!draft) throw new Error('No auction plan has been previewed for this room.');
  const result = planAuction({ catalog, mode: draft.mode, seed: draft.seed, rules: room.settings });
  const byId = new Map(catalog.players.map(player => [player.id, player]));
  const selected = result.poolIds.map(id => byId.get(id)).filter((player): player is CatalogPlayer => !!player);
  return {
    ok: result.ok,
    mode: draft.mode,
    planVersion: draft.planVersion,
    catalogVersion: draft.catalogVersion,
    approved: false,
    ...(result.ok ? {} : { blockedReason: result.blockedReason }),
    adjustments: result.adjustments,
    counts: summarizeSelection(selected),
    sets: result.sets.map(set => ({
      name: set.name,
      count: set.playerIds.length,
      players: set.playerIds.map(id => byId.get(id)).filter((player): player is CatalogPlayer => !!player),
    })),
    poolIds: result.poolIds,
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Host-only review export; drafts are rendered from the catalog, approved plans from the room. */
export function planCsv(room: Room, catalog?: Catalog): string {
  const header = 'position,set name,player ID,name,role,tier,marquee flag,base price,image reference';
  const plan = room.plan;
  if (!plan) {
    if (!catalog || !room.planDraft) throw new Error('Generate and review an auction plan first.');
    const preview = buildPlanPreview(room, catalog);
    if (!preview.ok) throw new Error(preview.blockedReason ?? 'This pool cannot be planned with the current rules.');
    const lines = [header];
    let position = 0;
    for (const set of preview.sets) for (const player of set.players) {
      position++;
      lines.push([
        position, set.name, player.id, player.name, player.role, player.tier,
        player.marquee ? 'yes' : 'no', player.basePrice, player.image ?? '',
      ].map(csvCell).join(','));
    }
    return lines.join('\n') + '\n';
  }
  const players = new Map(room.players.map(player => [player.id, player]));
  const lines = [header];
  let setIndex = 0;
  plan.orderedPlayerIds.forEach((id, index) => {
    while (setIndex < plan.setBoundaries.length - 1 && index >= plan.setBoundaries[setIndex]!.start + plan.setBoundaries[setIndex]!.count) setIndex++;
    const boundary = plan.setBoundaries[setIndex];
    const player = players.get(id);
    lines.push([
      index + 1, boundary?.name ?? 'Auction', id, player?.name ?? '', player?.role ?? '',
      player?.tier ?? '', player?.marquee ? 'yes' : 'no', player?.basePrice ?? '',
      player?.image ?? '',
    ].map(csvCell).join(','));
  });
  return lines.join('\n') + '\n';
}

export function planModeLabel(mode: AuctionMode): string {
  return auctionModeLabels[mode];
}

/** The server injects the seed; the client never chooses it. */
export function withPlanSeed(action: Action, seed: () => string): Action {
  if (action.type === 'plan-preview' || action.type === 'plan-regenerate') return { ...action, seed: seed() };
  return action;
}
