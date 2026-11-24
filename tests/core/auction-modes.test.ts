import { describe, expect, it } from 'vitest';
import { createRoom, applyAction, RuleError, startProblems } from '../../packages/engine/src/index';
import {
  auctionModeRules, settingsForMode, type AuctionMode, type Player, type Room, type User,
} from '../../packages/shared/src/domain';
import { bidReserve, purchaseRestriction } from '../../packages/shared/src/bid-rules';
import { settingsErrors } from '../../packages/shared/src/settings-rules';
import { settingsSchema } from '../../packages/shared/src/index';

const host: User = { id: 'mode_host', name: 'Mode Host' };
const guest: User = { id: 'mode_guest', name: 'Mode Guest' };
const now = 1_000_000;

/** Approved final rules. Starting purse is stored in lakhs. */
const approved = {
  quick: { players: 80, purse: 6000, squad: 5, minIndian: 3, minOverseas: 2, maxOverseas: 2, timerSeconds: 15 },
  standard: { players: 120, purse: 9000, squad: 11, minIndian: 7, minOverseas: 0, maxOverseas: 4, timerSeconds: 15 },
  mega: { players: 250, purse: 12000, squad: 11, minIndian: 7, minOverseas: 0, maxOverseas: 4, timerSeconds: 15 },
} as const;

function modeSettings(mode: AuctionMode, teamCount = 2) {
  return settingsSchema.parse({ ...settingsForMode(mode), teamCount });
}

/** A room with two claimed teams and hand-built squads, without running the whole lobby. */
function claimedRoom(mode: AuctionMode): Room {
  const room = createRoom('ABCDEF', host, modeSettings(mode), now);
  room.members.push({ ...guest, connected: true, ready: false, lastSeen: now });
  room.teams[0]!.ownerId = host.id;
  room.teams[1]!.ownerId = guest.id;
  return room;
}

function squadOf(room: Room, teamIndex: number, indian: number, overseas: number) {
  const team = room.teams[teamIndex]!;
  team.squad = [];
  const locals = room.players.filter(p => !p.overseas).slice(0, indian);
  const foreign = room.players.filter(p => p.overseas).slice(0, overseas);
  for (const p of [...locals, ...foreign]) team.squad.push({ playerId: p.id, price: 10 });
}

function restriction(room: Room, teamIndex: number, player: Player) {
  return purchaseRestriction(room, room.teams[teamIndex]!, player, 100);
}

describe('approved auction-mode rules', () => {
  it('match the approved table exactly', () => {
    for (const mode of ['quick', 'standard', 'mega'] as const) {
      expect(auctionModeRules[mode]).toEqual(approved[mode]);
    }
  });

  it('preset the fixed purse, squad, nationality and timer per mode', () => {
    for (const mode of ['quick', 'standard', 'mega'] as const) {
      const settings = settingsForMode(mode);
      const rules = approved[mode];
      expect(settings.mode).toBe(mode);
      expect(settings.budget).toBe(rules.purse);
      expect(settings.minSquad).toBe(rules.squad);
      expect(settings.maxSquad).toBe(rules.squad);
      expect(settings.maxOverseas).toBe(rules.maxOverseas);
      expect(settings.timerSeconds).toBe(rules.timerSeconds);
    }
  });

  it('rejects a settings payload that deviates from the mode', () => {
    const base = settingsForMode('standard');
    expect(settingsErrors({ ...base, budget: 5000 }).join(' ')).toMatch(/fixed purse/i);
    expect(settingsErrors({ ...base, minSquad: 9 }).join(' ')).toMatch(/squad of exactly 11/i);
    expect(settingsErrors({ ...base, maxOverseas: 6 }).join(' ')).toMatch(/overseas/i);
    expect(settingsErrors({ ...base, timerSeconds: 30 }).join(' ')).toMatch(/15-second/i);
    expect(settingsErrors({ ...base, mode: 'legendary' }).join(' ')).toMatch(/quick, standard or mega/i);
  });

  it('accepts every legal team count from 2 to 10 and rejects the rest', () => {
    for (const teamCount of [2, 6, 10]) expect(settingsErrors(modeSettings('quick', teamCount))).toEqual([]);
    expect(settingsErrors({ ...modeSettings('quick'), teamCount: 1 }).length).toBeGreaterThan(0);
    expect(settingsErrors({ ...modeSettings('quick'), teamCount: 11 }).length).toBeGreaterThan(0);
  });
});

describe('nationality and squad invariants during bidding', () => {
  it('quick refuses a fourth Indian and requires two overseas before the squad fills', () => {
    const room = claimedRoom('quick'); // squad size 5, exactly 3 Indian and 2 overseas
    const indian = room.players.find(p => !p.overseas)!;
    const overseas = room.players.find(p => p.overseas)!;

    squadOf(room, 0, 3, 0);
    // A 4th Indian is impossible: only 2 slots remain and both must be overseas.
    expect(restriction(room, 0, indian)?.code).toBe('NATIONALITY_LIMIT');
    expect(restriction(room, 0, overseas)).toBeNull();

    squadOf(room, 0, 3, 2);
    expect(restriction(room, 0, indian)?.code).toBe('SQUAD_FULL');
    expect(restriction(room, 0, overseas)?.code).toBe('SQUAD_FULL');
  });

  it('quick forces two overseas players before the squad can fill', () => {
    const room = claimedRoom('quick'); // 5 slots, exactly 3 Indian and 2 overseas
    const indian = room.players.find(p => !p.overseas)!;
    const overseas = room.players.find(p => p.overseas)!;
    squadOf(room, 0, 3, 0); // 2 slots left, both must be overseas
    expect(restriction(room, 0, indian)?.code).toBe('NATIONALITY_LIMIT');
    expect(restriction(room, 0, overseas)).toBeNull();
  });

  it('quick refuses a third overseas player', () => {
    const room = claimedRoom('quick');
    const overseas = room.players.find(p => p.overseas)!;
    squadOf(room, 0, 2, 2); // one slot left, still needs a third Indian
    expect(restriction(room, 0, overseas)?.code).toBe('OVERSEAS_LIMIT');
    expect(restriction(room, 0, room.players.find(p => !p.overseas)!)).toBeNull();
  });

  it('standard caps overseas at four', () => {
    const room = claimedRoom('standard');
    const overseas = room.players.find(p => p.overseas)!;
    squadOf(room, 0, 5, 4); // 9 signed, 2 slots left
    expect(restriction(room, 0, overseas)?.code).toBe('OVERSEAS_LIMIT');
    expect(restriction(room, 0, room.players.find(p => !p.overseas)!)).toBeNull();
  });

  it('an eleven-player squad with a four-overseas cap always keeps seven Indians', () => {
    // minIndian 7 is exactly squad size minus the overseas cap, so the cap enforces it.
    for (const mode of ['standard', 'mega'] as const) {
      const rules = approved[mode];
      expect(rules.squad - rules.maxOverseas).toBe(rules.minIndian);
    }
    expect(approved.quick.squad - approved.quick.maxOverseas).toBe(approved.quick.minIndian);
  });

  it('a team may bid while its squad is incomplete but not past the squad size', () => {
    const room = claimedRoom('standard');
    const indian = room.players.find(p => !p.overseas)!;
    squadOf(room, 0, 0, 0);
    expect(restriction(room, 0, indian)).toBeNull();
    squadOf(room, 0, 7, 4);
    expect(restriction(room, 0, indian)?.code).toBe('SQUAD_FULL');
  });

  it('reserves budget for the remaining required slots', () => {
    const room = claimedRoom('quick');
    const team = room.teams[0]!;
    squadOf(room, 0, 0, 0);
    const reserve = bidReserve(room, team);
    expect(reserve).toBe((room.settings.minSquad - 1) * Math.min(...room.players.map(p => p.basePrice)));
    const indian = room.players.find(p => !p.overseas)!;
    team.budget = reserve; // enough for the reserve but nothing more
    expect(restriction(room, 0, indian)?.code).toBe('INSUFFICIENT_BUDGET');
  });

  it('legacy rooms without a mode keep only the overseas cap', () => {
    const legacy = createRoom('ABCDEF', host, settingsSchema.parse({ teamCount: 2, minSquad: 2, maxSquad: 5, maxOverseas: 1, budget: 1000, timerSeconds: 10 }), now);
    legacy.members.push({ ...guest, connected: true, ready: false, lastSeen: now });
    legacy.teams[0]!.ownerId = host.id;
    legacy.teams[1]!.ownerId = guest.id;
    squadOf(legacy, 0, 2, 1); // below maxSquad, at the overseas cap
    // The overseas cap still applies (as it did before modes), but there is no new composition rule.
    const atCap = purchaseRestriction(legacy, legacy.teams[0]!, legacy.players.find(p => p.overseas)!, 100);
    expect(atCap?.code).toBe('OVERSEAS_LIMIT');
    expect(restriction(legacy, 0, legacy.players.find(p => !p.overseas)!)).toBeNull();
  });

  it('the server rejects an invalid bid even when the client sends it', () => {
    const room = claimedRoom('quick');
    room.status = 'LIVE';
    room.deadline = now + 15_000;
    squadOf(room, 0, 3, 0); // both remaining slots must be overseas
    room.currentPlayerIndex = room.players.findIndex(p => !p.overseas);
    room.players[room.currentPlayerIndex]!.status = 'open';
    const player = room.players[room.currentPlayerIndex]!;
    let error: unknown;
    try {
      applyAction(room, host.id, { id: 'race', type: 'bid', amount: player.basePrice, playerId: player.id }, now);
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(RuleError);
    expect((error as RuleError).code).toBe('NATIONALITY_LIMIT');
  });
});

describe('pool feasibility before starting', () => {
  it('blocks a pool that cannot fill ten squads of eleven', () => {
    const room = createRoom('ABCDEF', host, settingsSchema.parse({ ...settingsForMode('standard'), teamCount: 10 }), now);
    const owners = Array.from({ length: 10 }, (_, index) => ({ id: `owner_${index}`, name: `Owner ${index}`, connected: true, ready: false, lastSeen: now }));
    room.members.push(...owners);
    room.teams.forEach((team, index) => { team.ownerId = index === 0 ? host.id : owners[index]!.id; });
    // Ten teams need 110 slots. The 24-player sample pool cannot satisfy them.
    expect(startProblems(room).join(' ')).toMatch(/24 players but 10 teams need 110/i);
  });

  it('blocks a pool with too few Indian players for the mode', () => {
    const room = claimedRoom('quick');
    room.players = room.players.map(player => ({ ...player, overseas: true }));
    expect(startProblems(room).join(' ')).toMatch(/Indian players/i);
  });
});
