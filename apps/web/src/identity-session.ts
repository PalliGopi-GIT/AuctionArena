import { isDeletableRoomStatus, type Room } from '../../../packages/shared/src/domain';

/** Account listings are privacy-preserving summaries without member identities. */
export interface RoomSummary {
  code: string;
  name: string;
  status: string;
  hostId?: string;
  role?: 'host' | 'member';
  memberCount?: number;
  members?: Array<{ id: string }>;
  blockedUserIds?: string[];
}

/**
 * Cached room content is renderable only for the current, nonblocked member.
 * Listings are already scoped to the caller and omit other identities, so they
 * must not be treated as rooms missing their member list.
 */
export function canViewRoom(room: Room | RoomSummary, userId: string | undefined): boolean {
  if (!userId || room.blockedUserIds?.includes(userId)) return false;
  if (!Array.isArray(room.members)) return true;
  return room.members.some(member => member.id === userId);
}

/** Only the host may delete an ended room; the server repeats this check. */
export function canDeleteRoom(room: { hostId?: string; role?: 'host' | 'member'; status: string }, userId: string | undefined): boolean {
  if (!userId || !isDeletableRoomStatus(room.status as Room['status'])) return false;
  // Worker listings expose a role instead of the host's subject.
  return room.hostId !== undefined ? room.hostId === userId : room.role === 'host';
}

/** Invitation credentials belong to the signed-in identity, not its next user. */
export function clearInvitationCache(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): void {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith('invite-')) storage.removeItem(key);
  }
}

/** Clerk may reload during sign-out, so the previous identity must survive React remounts. */
export function syncIdentitySession(storage: Pick<Storage, 'length' | 'key' | 'removeItem' | 'getItem' | 'setItem'>, userId: string | undefined): boolean {
  const previous = storage.getItem('aa-session-identity');
  const changed = !!previous && previous !== userId;
  if (changed) clearInvitationCache(storage);
  if (userId) storage.setItem('aa-session-identity', userId);
  else storage.removeItem('aa-session-identity');
  return changed;
}
