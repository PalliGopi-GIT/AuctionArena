import { describe, it, expect } from 'vitest';
import { clerkTwoUserFixture, assertPristineClerkRoom } from '../../scripts/clerk-two-user-fixture';
import { createRoom } from '../../packages/engine/src/index';
import { settingsSchema } from '../../packages/shared/src/index';

const fixture = { testUsers: { host: 'user_host1', guest: 'user_guest1' }, roomCode: 'ABC123' };
function lobby() {
  const room = createRoom(fixture.roomCode, { id: fixture.testUsers.host, name: 'Test host' }, settingsSchema.parse({
    name: 'AuctionArena two-user Clerk test', teamCount: 2, budget: 2000, minSquad: 1, maxSquad: 2,
    maxOverseas: 2, timerSeconds: 20, autoAdvance: false, lateExtension: false,
  }), 100000);
  room.teams[0]!.ownerId = fixture.testUsers.host;
  return room;
}

describe('retained real Clerk test fixture', () => {
  it('reads identifiers from a failed attempt without carrying any other fields', () => {
    expect(clerkTwoUserFixture({ status: 'failed', ...fixture, error: { arbitrary: 'discard' } })).toEqual(fixture);
  });
  it.each([null, {}, { status: 'passed', ...fixture }, { status: 'failed', ...fixture, roomCode: '../bad' },
    { status: 'failed', ...fixture, testUsers: { host: 'user_same', guest: 'user_same' } },
    { status: 'failed', ...fixture, testUsers: { host: 'user_host1' } },
  ])('refuses an incomplete or successful attempt: %j', value => {
    expect(() => clerkTwoUserFixture(value)).toThrow();
  });
  it('accepts the original claimed, unstarted host lobby', () => {
    expect(() => assertPristineClerkRoom(lobby(), fixture)).not.toThrow();
  });
  it.each(['identity', 'joined', 'started', 'purchase', 'settings'] as const)('refuses to replay a changed %s fixture', change => {
    const room = lobby();
    if (change === 'identity') room.hostId = 'user_other';
    if (change === 'joined') room.members.push({ ...room.members[0]!, id: fixture.testUsers.guest });
    if (change === 'started') room.status = 'LIVE';
    if (change === 'purchase') { room.teams[0]!.budget -= 100; room.teams[0]!.squad.push({ playerId: 'p1', price: 100 }); }
    if (change === 'settings') room.settings.autoAdvance = true;
    expect(() => assertPristineClerkRoom(room, fixture)).toThrow();
  });
});
