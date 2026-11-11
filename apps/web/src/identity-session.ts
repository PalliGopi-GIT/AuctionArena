import type { Room } from '../../../packages/shared/src/domain';

/** Cached room content is renderable only for the current, nonblocked member. */
export function canViewRoom(room: Room, userId: string | undefined): boolean {
  return !!userId && !room.blockedUserIds?.includes(userId) && room.members.some(member => member.id === userId);
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
