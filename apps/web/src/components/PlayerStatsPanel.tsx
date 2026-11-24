import { statsFor, type PlayerStats } from '../../../../packages/catalog/src/player-stats';

interface StatRow {
  label: string;
  value: string;
}

const show = (value: number | null | undefined) => (value === null || value === undefined ? null : String(value));

/** Role-appropriate rows, omitting anything the dataset does not supply. */
export function statRows(playerId: string, role: string): StatRow[] {
  const stats: PlayerStats | undefined = statsFor(playerId);
  if (!stats) return [];
  const rows: StatRow[] = [];
  const add = (label: string, value: string | null) => { if (value !== null) rows.push({ label, value }); };

  const batting = role === 'Batter' || role === 'All-rounder' || role === 'Wicketkeeper';
  const bowling = role === 'Bowler' || role === 'All-rounder';

  if (batting) {
    add('Matches', show(stats.matches));
    add('Runs', show(stats.batting.runs));
    add('Average', show(stats.batting.average));
    add('SR', show(stats.batting.strikeRate));
    add('HS', stats.batting.highestScore);
    add('100s', show(stats.batting.hundreds));
    add('50s', show(stats.batting.fifties));
  }
  if (bowling) {
    if (!batting) add('Matches', show(stats.matches));
    add('Wickets', show(stats.bowling.wickets));
    add('Economy', show(stats.bowling.economy));
    add('Average', show(stats.bowling.average));
    add('SR', show(stats.bowling.strikeRate));
    add('Best', stats.bowling.best);
  }
  return rows;
}

/**
 * Compact career summary. Collapsed by default so player cards stay small;
 * expands in place to keep the existing card layout unchanged.
 */
export function PlayerStatsPanel({ playerId, role }: { playerId: string; role: string }) {
  const rows = statRows(playerId, role);
  if (!rows.length) return null;
  return (
    <details className="player-stats">
      <summary>Career stats <span className="tag">IPL</span></summary>
      <dl className="player-stats-grid">
        {rows.map(row => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="player-stats-note">Owner-supplied IPL career data · unofficial simulation</p>
    </details>
  );
}
