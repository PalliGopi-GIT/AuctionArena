import { money, nextBid, type Player, type Room, type Team } from './domain';

export interface BidRestriction { code: string; message: string }

/** Architecture section 5.8: reserve uses the minimum base price in the whole pool. */
export function bidReserve(room: Room, team: Team): number {
  const cheapest = Math.min(...room.players.map(player => player.basePrice));
  return Math.max(0, room.settings.minSquad - team.squad.length - 1) * (Number.isFinite(cheapest) ? cheapest : 0);
}

/** Purchase rules shared by server validation and the client explanation. */
export function purchaseRestriction(room: Room, team: Team, player: Player, amount: number): BidRestriction | null {
  if (team.squad.length >= room.settings.maxSquad) return { code: 'SQUAD_FULL', message: 'Your squad is full. You cannot sign more players.' };
  const overseas = team.squad.filter(purchase => room.players.find(item => item.id === purchase.playerId)?.overseas).length;
  if (player.overseas && overseas >= room.settings.maxOverseas) return { code: 'OVERSEAS_LIMIT', message: 'Your overseas player limit is reached. You can still bid on local players.' };
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
  if (room.deadline === null || now >= room.deadline) return { code: 'TOO_LATE', message: 'The deadline has passed. Wait for the confirmed result.' };
  const player = room.players[room.currentPlayerIndex];
  if (!player || player.status !== 'open') return { code: 'STALE_PLAYER', message: 'Wait for the next player to open for bidding.' };
  const team = room.teams.find(item => item.ownerId === userId);
  if (!team) return { code: 'NO_TEAM', message: 'You are spectating this auction. Only team owners can bid.' };
  if (room.leadingTeamId === team.id) return { code: 'ALREADY_LEADING', message: 'Your team is leading. Wait for another bid or the confirmed result.' };
  return purchaseRestriction(room, team, player, nextBid(room));
}
