/**
 * Career statistics lookup, generated from the owner-supplied CSV.
 *
 * Deliberately separate from the catalog and from room state: statistics are
 * static, so they are never copied into room snapshots or WebSocket broadcasts.
 * A missing value is `null` (unavailable) and is never rendered as zero.
 */
import data from './data/player-stats.json';

export interface BattingStats {
  innings: number | null;
  runs: number | null;
  ballsFaced: number | null;
  notOuts: number | null;
  highestScore: string | null;
  average: number | null;
  strikeRate: number | null;
  fifties: number | null;
  hundreds: number | null;
  fours: number | null;
  sixes: number | null;
  ducks: number | null;
}

export interface BowlingStats {
  innings: number | null;
  overs: number | null;
  runsConceded: number | null;
  wickets: number | null;
  average: number | null;
  economy: number | null;
  strikeRate: number | null;
  best: string | null;
  threeWicketHauls: number | null;
  fiveWicketHauls: number | null;
}

export interface PlayerStats {
  source: string | null;
  method: string | null;
  firstSeason: number | null;
  lastSeason: number | null;
  seasonsPlayed: number | null;
  matches: number | null;
  batting: BattingStats;
  bowling: BowlingStats;
}

export const playerStatsVersion: string = data.datasetVersion;
export const playerStatsSeasons: readonly number[] = data.seasons;
export const playerStatsSourceNote: string = data.sourceNote;
export const playerStats: Readonly<Record<string, PlayerStats>> = data.players as Readonly<Record<string, PlayerStats>>;

/** Returns undefined when the player has no statistics row at all. */
export function statsFor(playerId: string): PlayerStats | undefined {
  return playerStats[playerId];
}
