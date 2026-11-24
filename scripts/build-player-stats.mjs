/**
 * Build the runtime career-statistics dataset from the owner-supplied CSV.
 *
 * The CSV is the authoritative source. Values are copied verbatim; an empty CSV
 * cell becomes `null` so "unavailable" is never confused with a real zero.
 * Kept separate from catalog.json so room snapshots and WebSocket broadcasts
 * never carry career statistics.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const source = 'Assets/ipl_player_pool_250_with_career_stats.csv';
const target = 'packages/catalog/src/data/player-stats.json';

const text = readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
const headers = lines[0].split(',');
const rows = lines.slice(1).map(line => {
  // No quoted commas appear in this dataset, but split defensively.
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
  return cells.slice(0, headers.length).map(cell => cell.replace(/,$/, '').replace(/^"|"$/g, ''));
});

const num = cell => (cell === undefined || cell === '' ? null : Number(cell));
const int = cell => (cell === undefined || cell === '' ? null : Number.parseInt(cell, 10));
const str = cell => (cell === undefined || cell === '' ? null : cell);

const stats = {};
const seasons = new Set();
for (const row of rows) {
  const get = name => row[headers.indexOf(name)];
  const id = str(get('seed_id'));
  if (!id) continue;
  const first = int(get('ipl_first_season'));
  const last = int(get('ipl_last_season'));
  if (first) seasons.add(first);
  if (last) seasons.add(last);
  stats[id] = {
    source: str(get('licensed_source')),
    method: str(get('match_method')),
    firstSeason: first,
    lastSeason: last,
    seasonsPlayed: int(get('ipl_seasons_played')),
    matches: int(get('ipl_matches')),
    batting: {
      innings: int(get('bat_innings')),
      runs: int(get('bat_runs')),
      ballsFaced: int(get('balls_faced')),
      notOuts: int(get('not_outs')),
      highestScore: str(get('highest_score')),
      average: num(get('bat_average')),
      strikeRate: num(get('bat_strike_rate')),
      fifties: int(get('fifties')),
      hundreds: int(get('hundreds')),
      fours: int(get('fours')),
      sixes: int(get('sixes')),
      ducks: int(get('ducks')),
    },
    bowling: {
      innings: int(get('bowl_innings')),
      overs: num(get('overs_bowled')),
      runsConceded: int(get('runs_conceded')),
      wickets: int(get('wickets')),
      average: num(get('bowl_average')),
      economy: num(get('economy')),
      strikeRate: num(get('bowl_strike_rate')),
      best: str(get('best_bowling')),
      threeWicketHauls: int(get('three_wkt_hauls')),
      fiveWicketHauls: int(get('five_wkt_hauls')),
    },
  };
}

const seasonsSorted = [...seasons].sort((a, b) => a - b);
const payload = {
  datasetVersion: 'ipl-career-v1',
  generatedFrom: 'ipl_player_pool_250_with_career_stats.csv',
  generatedAt: new Date().toISOString().slice(0, 10),
  sourceNote: 'Owner-supplied dataset. Coverage reported as IPL seasons '
    + seasonsSorted[0] + '-'
    + seasonsSorted[seasonsSorted.length - 1]
    + ' from the CSV columns ipl_first_season/ipl_last_season.',
  seasons: seasonsSorted,
  players: stats,
};
writeFileSync(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');

const ids = Object.keys(stats);
const withBat = ids.filter(id => stats[id].batting.runs !== null).length;
const withBowl = ids.filter(id => stats[id].bowling.wickets !== null).length;
const withMatches = ids.filter(id => stats[id].matches !== null).length;
console.log(JSON.stringify({
  rows: rows.length, written: ids.length, seasons: seasonsSorted,
  withMatches, withBatting: withBat, withBowling: withBowl,
}, null, 2));
