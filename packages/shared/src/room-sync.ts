import { planSummaryFor, upcomingFor, type AuctionEvent, type Room } from './domain';

export const HISTORY_LIMIT = 1000;
export const RECEIPT_LIMIT = 1024;
export const LEGACY_RECEIPT_LIMIT = 4096;
export const SNAPSHOT_EVENTS = 100;
export const SNAPSHOT_BYTES = 128 * 1024;
export const HEARTBEAT_FLUSH_MS = 1000;
export interface HistoryPage { events: AuctionEvent[]; nextBefore: number | null; truncated: boolean }
export interface Replay { events: AuctionEvent[]; resetRequired: boolean; afterVersion: number }

/** A bounded recent-history view; retain team owners for result attribution. */
export function roomSnapshot(room: Room): Room {
  // Never expose the plan or its seed. During bidding, the remaining order is a
  // deliberate product requirement; sold players and the full seed stay private.
  const { blockedUserIds, plan: _plan, planDraft: _planDraft, planPosition: _planPosition, planSummary: _planSummary, upcoming: _upcoming, recallRound, recallSummary: _recallSummary, ...state } = room;
  const summary = planSummaryFor(room);
  const upcoming = ['LIVE', 'PAUSED', 'RESULT'].includes(room.status) ? upcomingFor(room) : [];
  const history = room.history.slice(-SNAPSHOT_EVENTS);
  const members = room.members.filter(member => !blockedUserIds?.includes(member.id) || room.teams.some(team => team.ownerId === member.id));
  const visibleBlocked = blockedUserIds?.filter(id => members.some(member => member.id === id));
  const snapshot = { ...state, members, ...(visibleBlocked?.length ? {blockedUserIds:visibleBlocked} : {}),
    ...(summary ? { planSummary: summary } : {}),
    ...(upcoming.length ? { upcoming } : {}),
    ...(recallRound ? { recallSummary: recallRound.status === 'active'
      ? { status: 'active' as const, position: recallRound.index + 1, total: recallRound.playerIds.length }
      : { status: 'offered' as const, position: 0, total: 0 } } : {}),
    history, historyTruncated: !!room.historyTruncated || history.length < room.history.length };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > SNAPSHOT_BYTES - 4096) {
    throw new Error('Room snapshot exceeds its size budget.');
  }
  return snapshot;
}
