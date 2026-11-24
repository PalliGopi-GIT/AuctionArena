import { auctionModeRules, money, nextBid, type Player, type Room, type Team } from './domain';

export interface BidRestriction { code: string; message: string }
export const BID_SAFETY_MARGIN_MS = 150;
/** Latch the deadline cutoff until a later deadline or a different lot is observed. */
export function createBidDeadlineGuard() {
  let code: string | undefined, playerIndex: number | undefined, deadline: number | null = null, locked = false;
  return (room: Room, now: number) => {
    if (code !== room.code || playerIndex !== room.currentPlayerIndex) {
      code = room.code; playerIndex = room.currentPlayerIndex; deadline = room.deadline; locked = false;
    } else if (room.deadline !== null && deadline !== null && room.deadline > deadline) {
      deadline = room.deadline; locked = false;
    } else if (deadline === null && room.deadline !== null) deadline = room.deadline;
    if (room.status === 'LIVE' && room.deadline !== null && now >= room.deadline - BID_SAFETY_MARGIN_MS) locked = true;
    return locked;
  };
}

/** Architecture section 5.8: reserve uses the minimum base price in the whole pool. */
export function bidReserve(room: Room, team: Team): number {
  const cheapest = Math.min(...room.players.map(player => player.basePrice));
  return Math.max(0, room.settings.minSquad - team.squad.length - 1) * (Number.isFinite(cheapest) ? cheapest : 0);
}

/**
 * The remaining purchase slots must be able to reach the mode's final composition.
 * Quick requires exactly 3 Indian and exactly 2 overseas, so once a slot cannot be
 * filled by the other nationality the bid is refused instead of leaving the squad
 * impossible to complete. Legacy rooms have no mode and keep the overseas cap only.
 */
function compositionRestriction(room: Room, team: Team, player: Player): BidRestriction | null {
  const rules = room.settings.mode ? auctionModeRules[room.settings.mode] : undefined;
  if (!rules) return null;
  const overseas = team.squad.filter(purchase => room.players.find(item => item.id === purchase.playerId)?.overseas).length;
  const indian = team.squad.length - overseas;
  // Slots that will still be open after this purchase, split by the nationality actually bought.
  const remainingSlots = Math.max(0, room.settings.maxSquad - team.squad.length - 1);
  const indianAfter = indian + (player.overseas ? 0 : 1);
  const overseasAfter = overseas + (player.overseas ? 1 : 0);
  if (rules.minOverseas > 0 && overseasAfter > rules.minOverseas) {
    return { code: 'NATIONALITY_LIMIT', message: `This mode allows exactly ${rules.minOverseas} overseas players. You cannot sign another overseas player.` };
  }
  if (rules.minOverseas > 0 && overseasAfter + remainingSlots < rules.minOverseas) {
    return { code: 'NATIONALITY_LIMIT', message: `This mode requires ${rules.minOverseas} overseas players. Sign them before your squad is full.` };
  }
  if (rules.minIndian > 0 && indianAfter + remainingSlots < rules.minIndian) {
    return { code: 'NATIONALITY_LIMIT', message: `This mode requires at least ${rules.minIndian} Indian players. Sign them before your squad is full.` };
  }
  return null;
}

/** Purchase rules shared by server validation and the client explanation. */
export function purchaseRestriction(room: Room, team: Team, player: Player, amount: number): BidRestriction | null {
  if (team.squad.length >= room.settings.maxSquad) return { code: 'SQUAD_FULL', message: 'Your squad is full. You cannot sign more players.' };
  const overseas = team.squad.filter(purchase => room.players.find(item => item.id === purchase.playerId)?.overseas).length;
  if (player.overseas && overseas >= room.settings.maxOverseas) return { code: 'OVERSEAS_LIMIT', message: 'Your overseas player limit is reached. You can still bid on local players.' };
  const composition = compositionRestriction(room, team, player);
  if (composition) return composition;
  const reserve = bidReserve(room, team);
  if (team.budget - amount < reserve) return {
    code: 'INSUFFICIENT_BUDGET',
    message: reserve > 0
      ? `You need ${money(amount)} for this bid and must keep ${money(reserve)} for your minimum squad.`
      : `Your remaining purse cannot cover the next bid of ${money(amount)}.`,
  };
  return null;
}

/** The server clock is supplied by the caller; no wall-clock reads or mutation. */
export function bidRestriction(room: Room, userId: string | undefined, now: number): BidRestriction | null {
  if (room.blockedUserIds?.includes(userId ?? '')) return { code: 'ROOM_BLOCKED', message: 'The host removed you from this room.' };
  if (room.status === 'PAUSED') return { code: 'NOT_LIVE', message: 'Bidding is paused. Wait for the host to resume.' };
  if (room.status === 'RESULT') return { code: 'NOT_LIVE', message: 'This player has a confirmed result. Bidding will reopen for the next player.' };
  if (room.status !== 'LIVE') return { code: 'NOT_LIVE', message: 'Bidding is not live.' };
  if (room.deadline === null || now >= room.deadline - BID_SAFETY_MARGIN_MS) return { code: 'TOO_LATE', message: 'Bidding is closing. Wait for the confirmed result.' };
  const player = room.players[room.currentPlayerIndex];
  if (!player || player.status !== 'open') return { code: 'STALE_PLAYER', message: 'Wait for the next player to open for bidding.' };
  const team = room.teams.find(item => item.ownerId === userId);
  if (!team) return { code: 'NO_TEAM', message: 'You are spectating this auction. Only team owners can bid.' };
  if (room.leadingTeamId === team.id) return { code: 'ALREADY_LEADING', message: 'Your team is leading. Wait for another bid or the confirmed result.' };
  return purchaseRestriction(room, team, player, nextBid(room));
}
