import type { Settings } from './index';

export interface User { id: string; name: string }
export interface Member extends User { connected: boolean; ready: boolean; lastSeen: number }
export const auctionModes = ['quick', 'standard', 'mega'] as const;
export type AuctionMode = typeof auctionModes[number];
export const auctionModeLabels: Record<AuctionMode, string> = { quick: 'Quick', standard: 'Standard', mega: 'Mega' };
export interface AuctionModeRules {
  players: number;
  purse: number;
  squad: number;
  minIndian: number;
  minOverseas: number;
  maxOverseas: number;
  timerSeconds: number;
}
/** Fixed rules for newly created auctions. Existing rooms without a mode keep their saved rules. */
export const auctionModeRules: Record<AuctionMode, AuctionModeRules> = {
  quick: { players: 80, purse: 6000, squad: 5, minIndian: 3, minOverseas: 2, maxOverseas: 2, timerSeconds: 15 },
  standard: { players: 120, purse: 9000, squad: 11, minIndian: 7, minOverseas: 0, maxOverseas: 4, timerSeconds: 15 },
  mega: { players: 250, purse: 12000, squad: 11, minIndian: 7, minOverseas: 0, maxOverseas: 4, timerSeconds: 15 },
};
export const auctionModeSizes: Record<AuctionMode, number> = {
  quick: auctionModeRules.quick.players,
  standard: auctionModeRules.standard.players,
  mega: auctionModeRules.mega.players,
};
export const auctionModeDescriptions: Record<AuctionMode, string> = {
  quick: 'A focused five-player squad with a short player pool.',
  standard: 'A full eleven-player squad with a balanced player pool.',
  mega: 'The complete catalog for the deepest auction night.',
};
/** Human-readable nationality requirement; Quick is exact, Standard/Mega are "at least". */
export function modeNationalityLabel(mode: AuctionMode): string {
  const rules = auctionModeRules[mode];
  const indian = rules.minOverseas > 0 ? `Exactly ${rules.minIndian} Indian` : `At least ${rules.minIndian} Indian`;
  const overseas = rules.minOverseas > 0 && rules.minOverseas === rules.maxOverseas
    ? `exactly ${rules.maxOverseas} overseas` : `max ${rules.maxOverseas} overseas`;
  return `${indian} · ${overseas}`;
}
export function settingsForMode(mode: AuctionMode, overrides: Partial<Settings> = {}): Settings {
  const rules = auctionModeRules[mode];
  return {
    name: 'Friday Night Auction',
    teamCount: 4,
    budget: rules.purse,
    minSquad: rules.squad,
    maxSquad: rules.squad,
    maxOverseas: rules.maxOverseas,
    timerSeconds: rules.timerSeconds,
    lateExtension: true,
    bidIncrement: 10,
    autoAdvance: true,
    resultSeconds: 5,
    spectators: true,
    ...overrides,
    mode,
  };
}
/** Fixed nationality rules are enforced only for mode-based rooms; legacy rooms keep their saved rules. */
export function modeNationalityRules(settings: Pick<Settings, 'mode'>): { minIndian: number; maxOverseas: number } | undefined {
  if (!settings.mode) return undefined;
  const rules = auctionModeRules[settings.mode];
  return { minIndian: rules.minIndian, maxOverseas: rules.maxOverseas };
}
export const playerRoles = ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper'] as const;
export type PlayerRole = typeof playerRoles[number];
export const playerTiers = ['A', 'B', 'C', 'D', 'E'] as const;
export type PlayerTier = typeof playerTiers[number];
export interface PlayerStats { matches:number; runs:number; wickets:number; strikeRate:number }
export interface Player {
  id: string; name: string; country: string; role: PlayerRole; basePrice: number; overseas: boolean;
  isSample: boolean; battingStyle: string; bowlingStyle: string;
  stats?: PlayerStats;
  status: 'upcoming'|'open'|'sold'|'unsold'; soldTo?:string; soldPrice?:number;
  tier?: PlayerTier; marquee?: boolean; image?: string | null; imageStatus?: 'bundled'|'missing'|'unconverted';
}
export interface PlanSetBoundary { name: string; start: number; count: number }
/** Persisted plan fields only: IDs and boundaries, never player objects. */
export interface RoomPlan {
  catalogVersion: string; mode: AuctionMode; seed: string; planVersion: number;
  approvedAt: number; approvedBy: string; orderedPlayerIds: string[]; setBoundaries: PlanSetBoundary[];
  recallEnabled?: true;
}
export type RecallRound = { status: 'offered' } | { status: 'active'; playerIds: string[]; index: number };
export interface RecallSummary { status: 'offered' | 'active'; position: number; total: number }
/** Pre-approval draft: only the fields needed to reproduce the preview deterministically. */
export interface PlanDraft { catalogVersion: string; mode: AuctionMode; seed: string; planVersion: number }
export interface PlanSummary {
  mode: AuctionMode; setName: string; setIndex: number; setCount: number;
  position: number; total: number; remaining: number;
}
/** Compact upcoming order derived for snapshots; player details stay in room.players. */
export interface UpcomingPlayer {
  id: string; position: number; setIndex: number; setName: string; status: 'upcoming' | 'open';
}
export interface Team { id: string; name: string; color: string; ownerId: string | null; budget: number; squad: {playerId:string;price:number}[] }
export interface AuctionEvent { id: string; version: number; at: number; type: string; text: string; actorId?:string }
export const completionReasons = ['POOL_EXHAUSTED', 'SQUADS_FULL', 'NO_AFFORDABLE_PLAYERS', 'HOST_ENDED', 'HOST_CLOSED'] as const;
export type CompletionReason = typeof completionReasons[number];
export const completionMessages: Record<CompletionReason, string> = {
  POOL_EXHAUSTED: 'Every player in the pool has been auctioned.',
  SQUADS_FULL: 'Every participating team has filled its squad.',
  NO_AFFORDABLE_PLAYERS: 'No participating team with squad space can afford a remaining player while keeping its minimum squad reserve.',
  HOST_ENDED: 'The host ended the auction. All accepted bids were settled.',
  HOST_CLOSED: 'The host closed the room before bidding started.',
};
export interface Room { code:string; name:string; hostId:string; status:'WAITING'|'LIVE'|'PAUSED'|'RESULT'|'COMPLETED'|'CLOSED'; settings:Settings; bidRule?:'tiered-v1'; members:Member[]; teams:Team[]; players:Player[]; currentPlayerIndex:number; currentBid:number; leadingTeamId:string|null; deadline:number|null; pausedRemaining:number; resultAt:number|null; extensions:number; version:number; history:AuctionEvent[]; historyTruncated?:boolean; createdAt:number; pauseReason?:string; blockedUserIds?:string[]; completion_reason?:CompletionReason; plan?:RoomPlan; planDraft?:PlanDraft; planPosition?:number; planSummary?:PlanSummary; upcoming?:UpcomingPlayer[] }
/** Derived for snapshots; never persisted and never includes the upcoming order. */
export interface Room { recallRound?: RecallRound; recallSummary?: RecallSummary }

export function planSummaryFor(room: Room): PlanSummary | undefined {
  const plan = room.plan;
  if (!plan) return undefined;
  const total = plan.orderedPlayerIds.length;
  const position = Math.min(total, Math.max(0, (room.planPosition ?? -1) + 1));
  let setIndex = plan.setBoundaries.findIndex(boundary => position <= boundary.start + boundary.count);
  if (setIndex < 0) setIndex = Math.max(0, plan.setBoundaries.length - 1);
  const boundary = plan.setBoundaries[setIndex];
  const upcoming = new Set(room.players.filter(player => player.status === 'upcoming').map(player => player.id));
  const remaining = plan.orderedPlayerIds.slice(position).filter(id => upcoming.has(id)).length;
  return {
    mode: plan.mode, setName: boundary?.name ?? 'Auction', setIndex,
    setCount: plan.setBoundaries.length, position, total, remaining,
  };
}
/** Remaining players in the approved order. Sold/unsold players are omitted. */
export function upcomingFor(room: Room): UpcomingPlayer[] {
  const byId = new Map(room.players.map(player => [player.id, player]));
  const remaining: UpcomingPlayer[] = [];
  if (room.plan) {
    const boundaries = room.plan.setBoundaries;
    let setIndex = 0;
    room.plan.orderedPlayerIds.forEach((id, index) => {
      while (setIndex < boundaries.length - 1 && index >= boundaries[setIndex]!.start + boundaries[setIndex]!.count) setIndex++;
      const player = byId.get(id);
      if (!player || (player.status !== 'upcoming' && player.status !== 'open')) return;
      remaining.push({
        id, position: index + 1, setIndex,
        setName: boundaries[setIndex]?.name ?? 'Auction', status: player.status,
      });
    });
    return remaining;
  }
  room.players.forEach((player, index) => {
    if (player.status !== 'upcoming' && player.status !== 'open') return;
    remaining.push({ id: player.id, position: index + 1, setIndex: 0, setName: 'Auction', status: player.status });
  });
  return remaining;
}
/** Only ended rooms may be permanently deleted; a live auction is never deletable. */
export const deletableRoomStatuses = ['COMPLETED', 'CLOSED'] as const;
export function isDeletableRoomStatus(status: Room['status']): boolean {
  return (deletableRoomStatuses as readonly string[]).includes(status);
}
export const money = (lakhs:number) => lakhs >= 100 ? `₹${(lakhs/100).toFixed(2)} Cr` : `₹${lakhs} L`;
/** Unversioned persisted rooms retain the flat increment they were created with. */
export function bidIncrement(room: Room, amount: number) {
  return room.bidRule === 'tiered-v1' ? amount < 200 ? 10 : amount <= 500 ? 20 : 25 : room.settings.bidIncrement;
}
export function nextBid(room: Room) { return room.currentBid ? room.currentBid + bidIncrement(room, room.currentBid) : room.players[room.currentPlayerIndex]?.basePrice ?? 0; }
/** Validate a saved bid against its room's original ladder without iterating over every rung. */
export function validBidOnLadder(room: Room, base: number, amount: number) {
  if (!Number.isSafeInteger(base) || base <= 0 || !Number.isSafeInteger(amount) || amount < base) return false;
  if (room.bidRule !== 'tiered-v1') return (amount - base) % room.settings.bidIncrement === 0;
  let current = base;
  while (current < amount) {
    const step = bidIncrement(room, current);
    const nextTier = current < 200 ? 200 : current <= 500 ? 501 : Infinity;
    const count = Math.min(Math.ceil((amount - current) / step), Math.ceil((nextTier - current) / step));
    current += count * step;
  }
  return current === amount;
}
/** Franchise order is stable: index 0 is t1 (host) and index 1 is t2 (guest). */
export const teamNames = ['Mumbai Indians','Chennai Super Kings','Royal Challengers Bengaluru','Kolkata Knight Riders','Sunrisers Hyderabad','Rajasthan Royals','Delhi Capitals','Punjab Kings','Gujarat Titans','Lucknow Super Giants'];
/** Official short code per franchise, used where space is tight. */
export const teamShortNames: Record<string,string> = {
  'Chennai Super Kings':'CSK',
  'Mumbai Indians':'MI',
  'Royal Challengers Bengaluru':'RCB',
  'Kolkata Knight Riders':'KKR',
  'Sunrisers Hyderabad':'SRH',
  'Rajasthan Royals':'RR',
  'Delhi Capitals':'DC',
  'Punjab Kings':'PBKS',
  'Gujarat Titans':'GT',
  'Lucknow Super Giants':'LSG',
};
export function teamShortName(name:string):string {
  return teamShortNames[name] ?? name.split(' ').map(part => part[0]).join('');
}
/** Runtime logo per franchise. Rajasthan Royals has no supplied file and falls back to initials. */
export const teamLogos: Record<string,string> = {
  'Chennai Super Kings':'/assets/teams/csk.svg',
  'Mumbai Indians':'/assets/teams/mi.svg',
  'Royal Challengers Bengaluru':'/assets/teams/rcb.svg',
  'Kolkata Knight Riders':'/assets/teams/kkr.svg',
  'Sunrisers Hyderabad':'/assets/teams/srh.svg',
  'Delhi Capitals':'/assets/teams/dc.svg',
  'Punjab Kings':'/assets/teams/pbks.svg',
  'Gujarat Titans':'/assets/teams/gt.svg',
  'Lucknow Super Giants':'/assets/teams/lsg.svg',
};
export const teamColors = ['#45b7ff','#f5c451','#b594ff','#fb7185','#6ed8bc','#ff9257','#e5a0dc','#a3d35e','#f2a65a','#7dd3fc'];
export function samplePlayers():Player[] { const names=['Arjun Rathore','Kabir Mehta','Liam Fletcher','Dev Malhotra','Ishaan Sethi','Noah Brooks','Rohan Desai','Vihaan Kapoor','Ethan Walsh','Aditya Nair','Zayn Siddiqui','Oliver Hayes','Aarav Menon','Dhruv Shah','Theo Bennett','Reyansh Rao','Samar Khanna','Finn Clarke','Yash Bhatia','Neel Joshi','Oscar Reed','Kunal Verma','Rishi Anand','Leo Morgan']; return names.map((name,i)=>({id:`p${i+1}`,name,country:i%3===2?'Australia':'India',role:(['Batter','Bowler','All-rounder','Wicketkeeper'] as const)[i%4]!,basePrice:[100,50,75,25][i%4]!,overseas:i%3===2,isSample:true,battingStyle:i%2?'Left-hand bat':'Right-hand bat',bowlingStyle:i%2?'Right-arm pace':'Off spin',stats:{matches:30+i*3,runs:240+i*93,wickets:8+i*2,strikeRate:125+i},status:'upcoming'})); }
