import type { Room } from '../../shared/src/domain';
import { applyAction, event } from '../../engine/src/index';
import { boundStoredRoom, type StoredRoom } from './record';

const IDENTITY_EVENTS = new Set(['joined', 'left', 'member_removed', 'team_claimed', 'ready', 'disconnected', 'connected']);

export interface RoomDeletionResult {
  next: StoredRoom | null;
  changed: boolean;
  removed: boolean;
}

/**
 * Remove one user from one persisted room. The caller supplies a stable,
 * non-reversible anonymous ID because Web Crypto is asynchronous and this
 * function must run inside a synchronous storage transaction.
 *
 * Shared financial state is preserved: accepted sales, squads and budgets stay,
 * while member identities, team ownership, receipts and authored history are
 * replaced or redacted. A room whose only member is the deleted user is removed.
 */
export function anonymizeUserInRoom(entry: StoredRoom, userId: string, anonymousId: string, now: number): RoomDeletionResult {
  const room = entry.room;
  const member = room.members.find(item => item.id === userId);
  const related = !!member || room.blockedUserIds?.includes(userId) || room.history.some(item => item.actorId === userId);
  if (!related) return { next: entry, changed: false, removed: false };
  if (member && room.members.length === 1) return { next: null, changed: true, removed: true };

  let working: Room = structuredClone(room);
  if (working.hostId === userId && member && working.status !== 'COMPLETED' && working.status !== 'CLOSED') {
    working = applyAction(working, userId, { id: 'account-deleted', type: 'end' }, now);
  }
  for (const item of working.members) if (item.id === userId) {
    item.id = anonymousId; item.name = 'Deleted player'; item.connected = false; item.ready = false; item.lastSeen = 0;
  }
  if (working.hostId === userId) working.hostId = anonymousId;
  for (const team of working.teams) if (team.ownerId === userId) team.ownerId = anonymousId;
  working.blockedUserIds = working.blockedUserIds?.map(id => id === userId ? anonymousId : id);
  // Actor IDs allow targeted redaction after a rename or lobby leave. Legacy
  // identity prose has no reliable author, so redact it while preserving bids.
  for (const history of working.history) {
    if (history.actorId === userId || IDENTITY_EVENTS.has(history.type) && !history.actorId) {
      history.text = 'Participant details removed after account deletion.';
    }
    history.text = history.text.split(userId).join(anonymousId);
    if (history.actorId === userId) history.actorId = anonymousId;
  }
  const receipts = { ...entry.receipts };
  for (const key of Object.keys(receipts)) if (key.startsWith(userId + ':')) delete receipts[key];
  event(working, now, 'account_deleted', 'Personal details were removed. Accepted sales are preserved.');
  const next = { ...entry, room: working, receipts };
  boundStoredRoom(next);
  return { next, changed: true, removed: false };
}
