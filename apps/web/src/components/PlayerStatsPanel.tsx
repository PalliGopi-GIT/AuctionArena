import { statsFor, type PlayerStats } from '../../../../packages/catalog/src/player-stats';

interface StatRow {
  label: string;
  value: string;
}

const show = (value: number | null | undefined) => (value === null || value === undefined ? null : String(value));

/**
 * Role-appropriate rows, omitting anything the dataset does not supply.
 *
 * The owner-supplied dataset has no fielding or wicketkeeping columns, so
 * catches and stumpings are simply absent here rather than invented.
 */
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
    add('Batting avg', show(stats.batting.average));
    add('Strike rate', show(stats.batting.strikeRate));
    add('Highest score', stats.batting.highestScore);
    add('Centuries', show(stats.batting.hundreds));
    add('Half-centuries', show(stats.batting.fifties));
  }
  if (bowling) {
    // A bowler already shares `matches` with the team; show it once.
    if (!batting) add('Matches', show(stats.matches));
    add('Wickets', show(stats.bowling.wickets));
    add('Economy', show(stats.bowling.economy));
    add('Bowling avg', show(stats.bowling.average));
    add('Bowling SR', show(stats.bowling.strikeRate));
    add('Best bowling', stats.bowling.best);
  }
  return rows;
}

/**
 * Career summary for one player.
 *
 * `live` is the always-visible grid beside the photograph in the current lot, so
 * bidding needs no extra interaction. `compact` stays collapsed inside the dense
 * player grid to keep those tiles small. Keyed on the player ID by the caller, so
 * it re-renders whenever the current lot changes.
 */
export function PlayerStatsPanel({ playerId, role, variant = 'compact', caption }: {
  playerId: string;
  role: string;
  variant?: 'live' | 'compact';
  caption?: string;
}) {
  const rows = statRows(playerId, role);
  if (!rows.length) return null;
  const grid = (
    <dl className="player-stats-grid">
      {rows.map(row => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );

  if (variant === 'live') {
    return (
      <div className="player-stats player-stats--live" aria-live="polite" aria-label={`${caption ?? 'Player'} IPL career statistics`}>
        <div className="player-stats-heading">
          <span>IPL career stats</span>
          <span className="tag">{role}</span>
        </div>
        {grid}
        <p className="player-stats-note">Owner-supplied IPL career data · unofficial simulation</p>
      </div>
    );
  }

  return (
    <details className="player-stats">
      <summary>Career stats <span className="tag">IPL</span></summary>
      {grid}
    </details>
  );
}
