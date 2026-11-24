import type { Room, User } from '../../shared/src/domain';
import type { Action } from '../../shared/src/index';
import { applyAction, event, RuleError, tick } from '../../engine/src/index';
import { HISTORY_LIMIT, LEGACY_RECEIPT_LIMIT, RECEIPT_LIMIT } from '../../shared/src/room-sync';

export interface Receipt { fingerprint: string; expectedVersion?: number }
export interface StoredRoom { room: Room; inviteHash: string; inviteExpires: number; receipts: Record<string, Receipt> }

export function boundStoredRoom(entry: StoredRoom) {
  if (entry.room.history.length > HISTORY_LIMIT) {
    entry.room.history = entry.room.history.slice(-HISTORY_LIMIT); entry.room.historyTruncated = true;
  }
  const bounded = Object.entries(entry.receipts).filter(([, receipt]) => receipt.expectedVersion !== undefined);
  for (const [key] of bounded.slice(0, Math.max(0, bounded.length - RECEIPT_LIMIT))) delete entry.receipts[key];
}

export function authorizeRoom(entry: StoredRoom | null, user: User): asserts entry is StoredRoom {
  if (!entry) throw new RuleError('ROOM_NOT_FOUND', 'Room unavailable. Check your invitation or ask the host for access.');
  if (entry.room.blockedUserIds?.includes(user.id)) throw new RuleError('ROOM_BLOCKED', 'The host removed you from this room.');
  if (!entry.room.members.some(member => member.id === user.id)) throw new RuleError('ROOM_NOT_FOUND', 'Room unavailable. Check your invitation or ask the host for access.');
}

/** Caller verifies account access, advances due work, and commits the returned record atomically. */
export function applyStoredAction(entry: StoredRoom, user: User, action: Action, now: number, fingerprint: string): StoredRoom {
  authorizeRoom(entry, user);
  const key = `${user.id}:${action.id}`, receipt = entry.receipts[key];
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new RuleError('ID_REUSED', 'Action ID was reused with different content.');
    return entry;
  }
  if (action.expectedVersion !== undefined && action.expectedVersion !== entry.room.version) throw new RuleError('STALE_VERSION', 'The room changed. Review the latest state before trying again.');
  if (action.expectedVersion === undefined && Object.values(entry.receipts).filter(item => item.expectedVersion === undefined).length >= LEGACY_RECEIPT_LIMIT) throw new RuleError('CLIENT_UPDATE_REQUIRED', 'Refresh the application before sending more actions.');
  const next = { ...entry, room: applyAction(entry.room, user.id, action, now), receipts: { ...entry.receipts,
    [key]: { fingerprint, ...(action.expectedVersion === undefined ? {} : { expectedVersion: action.expectedVersion }) } } };
  boundStoredRoom(next);
  return next;
}

/** Existing local deadline/host-presence ordering, shared with persistent room adapters. */
export function advanceRoom(room: Room, now: number, presence?: ReadonlyMap<string, number>) {
  const host = room.members.find(member => member.id === room.hostId);
  for (const member of room.members) {
    // Live sockets are the source of truth for presence between persistence
    // points; callers without a presence map keep the stored timestamps.
    const seen = presence?.get(member.id);
    if (seen !== undefined && seen > member.lastSeen) member.lastSeen = seen;
  }
  const absentAt = host ? host.lastSeen + 10000 : now;
  for (const member of room.members) if (member.connected && now - member.lastSeen > 10000) {
    member.connected = false; event(room, now, 'disconnected', member.name + ' disconnected.', member.id);
  }
  const pause = (at: number) => { room.pausedRemaining = Math.max(0, room.deadline! - at); room.deadline = null; room.status = 'PAUSED'; room.pauseReason = 'Host disconnected. Waiting for the host to return.'; event(room, now, 'paused', room.pauseReason); };
  if (room.status === 'LIVE' && !host?.connected && absentAt < room.deadline!) pause(Math.min(now, absentAt));
  tick(room, now);
  if (room.status === 'LIVE' && !host?.connected) pause(now);
}
