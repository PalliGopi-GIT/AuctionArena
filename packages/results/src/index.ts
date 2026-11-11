import type { Player, Room, Team } from '../../shared/src/domain';
import { completionMessages } from '../../shared/src/domain';

export const playerRoles: Player['role'][] = ['Batter', 'Bowler', 'All-rounder', 'Wicketkeeper'];

export interface ResultPurchase {
  playerId: string;
  player: Player | undefined;
  price: number;
}

export interface TeamResult {
  team: Team;
  ownerName: string;
  startingBudget: number;
  spent: number;
  remainingBudget: number;
  budgetReconciles: boolean;
  lineup: ResultPurchase[];
  roles: Record<Player['role'], number>;
  nationalities: { country: string; count: number }[];
  localCount: number;
  overseasCount: number;
  missingPlayerDetails: number;
  minimumMissing: number;
  remainingSlots: number;
}

/** A read-only projection of confirmed purchases. It does not score or rank squad strength. */
export function deriveAuctionResults(room: Room) {
  const playersById = new Map(room.players.map(player => [player.id, player]));
  const membersById = new Map(room.members.map(member => [member.id, member]));
  const teams: TeamResult[] = room.teams.map(team => {
    const lineup = team.squad.map(purchase => ({ ...purchase, player: playersById.get(purchase.playerId) }));
    const roles: Record<Player['role'], number> = { Batter: 0, Bowler: 0, 'All-rounder': 0, Wicketkeeper: 0 };
    const countries = new Map<string, number>();
    let localCount = 0;
    let overseasCount = 0;
    let missingPlayerDetails = 0;
    for (const purchase of lineup) {
      if (!purchase.player) { missingPlayerDetails++; continue; }
      const player = purchase.player;
      roles[player.role]++;
      countries.set(player.country, (countries.get(player.country) ?? 0) + 1);
      if (player.overseas) overseasCount++; else localCount++;
    }
    const spent = lineup.reduce((sum, purchase) => sum + purchase.price, 0);
    return {
      team,
      ownerName: team.ownerId ? membersById.get(team.ownerId)?.name ?? 'Former participant' : 'Unclaimed',
      startingBudget: room.settings.budget,
      spent,
      remainingBudget: team.budget,
      budgetReconciles: spent + team.budget === room.settings.budget,
      lineup,
      roles,
      nationalities: [...countries].map(([country, count]) => ({ country, count })).sort((a, b) => a.country.localeCompare(b.country)),
      localCount,
      overseasCount,
      missingPlayerDetails,
      minimumMissing: Math.max(0, room.settings.minSquad - lineup.length),
      remainingSlots: Math.max(0, room.settings.maxSquad - lineup.length),
    };
  });
  const sold = room.players.filter(player => player.status === 'sold');
  const unsold = room.players.filter(player => player.status === 'unsold');
  // Ending early never turns a player who was not auctioned into an unsold result.
  const unauctioned = room.players.filter(player => player.status === 'upcoming' || player.status === 'open');
  const highestPrice = sold.reduce((highest, player) => Math.max(highest, player.soldPrice ?? 0), 0);
  const highestSpend = teams.reduce((highest, team) => Math.max(highest, team.spent), 0);
  return {
    completionReason: room.completion_reason ?? null,
    // Older saved results remain readable without inventing an end reason.
    completionMessage: room.completion_reason ? completionMessages[room.completion_reason] : 'Confirmed sales and squads are preserved.',
    teams,
    sold,
    unsold,
    unauctioned,
    totalSpent: teams.reduce((sum, team) => sum + team.spent, 0),
    totalRemaining: teams.reduce((sum, team) => sum + team.remainingBudget, 0),
    participatingTeams: teams.filter(team => team.team.ownerId !== null).length,
    highestPrice,
    highestSales: highestPrice > 0 ? sold.filter(player => player.soldPrice === highestPrice) : [],
    highestSpend,
    highestSpendingTeams: highestSpend > 0 ? teams.filter(team => team.spent === highestSpend) : [],
  };
}
