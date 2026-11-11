import type { Room } from '../packages/shared/src/domain';

export interface ClerkTwoUserFixture { testUsers: { host: string; guest: string }; roomCode: string }

/** Only reuse identifiers from a failed run; remote metadata is verified before sign-in. */
export function clerkTwoUserFixture(value: unknown): ClerkTwoUserFixture {
  const prior = value as { status?: string; testUsers?: { host?: string; guest?: string }; roomCode?: string } | null;
  const users = prior?.testUsers;
  if (prior?.status !== 'failed' || !users ||
      !/^user_[A-Za-z0-9]+$/.test(users.host || '') || !/^user_[A-Za-z0-9]+$/.test(users.guest || '') ||
      users.host === users.guest || !/^[A-Z0-9]{6}$/.test(prior.roomCode || '')) {
    throw new Error('A failed two-user report with both synthetic identities and its room is required to resume.');
  }
  return { testUsers: { host: users.host!, guest: users.guest! }, roomCode: prior.roomCode! };
}

/** Refuse to replay auction mutations over an already joined, started or purchased fixture. */
export function assertPristineClerkRoom(room: Room, fixture: ClerkTwoUserFixture): void {
  if (room.code !== fixture.roomCode || room.hostId !== fixture.testUsers.host || room.status !== 'WAITING' ||
      room.members.length !== 1 || room.members[0]?.id !== fixture.testUsers.host ||
      room.blockedUserIds?.length || room.teams.length !== 2 ||
      room.teams[0]?.ownerId !== fixture.testUsers.host || room.teams[1]?.ownerId ||
      room.teams.some(team => team.squad.length || team.budget !== 2000) ||
      room.players.some(player => player.status === 'sold') ||
      room.settings.name !== 'AuctionArena two-user Clerk test' || room.settings.timerSeconds !== 20 ||
      room.settings.autoAdvance || room.settings.lateExtension) {
    throw new Error('The retained room is no longer an untouched two-user test lobby; it was left unchanged.');
  }
}
