import { useMemo } from 'react';
import { money, upcomingFor, type Room } from '../../../../packages/shared/src/index';
import { PlayerIcon } from './PlayerIcon';

/** Live view of the remaining approved order; player details stay in room.players. */
export function UpcomingPlayers({ room }: { room: Room }) {
  const upcoming = useMemo(() => room.upcoming ?? upcomingFor(room), [room.upcoming, room.players, room.plan, room.planPosition]);
  const byId = useMemo(() => new Map(room.players.map(player => [player.id, player])), [room.players]);
  const groups = useMemo(() => {
    const grouped = new Map<number, { name: string; items: typeof upcoming }>();
    for (const item of upcoming) {
      const group = grouped.get(item.setIndex) ?? { name: item.setName, items: [] };
      group.items.push(item);
      grouped.set(item.setIndex, group);
    }
    return [...grouped.entries()].sort(([left], [right]) => left - right);
  }, [upcoming]);

  return <section className="upcoming-players" aria-labelledby="upcoming-title">
    <div className="panel-heading">
      <div><span className="eyebrow">APPROVED ORDER</span><h2 id="upcoming-title">Upcoming players</h2></div>
      <span className="tag">{upcoming.length} REMAINING</span>
    </div>
    <p className="muted">Every remaining player in the host-approved order, grouped by auction set. The list updates live as lots are settled.</p>
    {!upcoming.length ? <p className="empty" role="status">No players remain in the auction order.</p> :
      <div className="upcoming-groups">{groups.map(([setIndex, group]) => <section className="upcoming-set" key={setIndex + ':' + group.name}>
        <h3>{group.name}<span>{group.items.length} players</span></h3>
        <ol>{group.items.map(item => {
          const player = byId.get(item.id);
          return <li key={item.id} className={item.status === 'open' ? 'on-the-block' : undefined}>
            <span className="upcoming-position" aria-label={`Position ${item.position}`}>{item.position}</span>
            <PlayerIcon p={player ?? { id: item.id, name: 'Player', role: 'Batter' }} compact />
            <div className="upcoming-player-copy">
              <b>{player?.name ?? 'Player details unavailable'}</b>
              <small>{player ? `${player.role} · ${player.country} · ${player.overseas ? 'Overseas' : 'Indian'}` : 'Player details unavailable'}</small>
            </div>
            <span className="upcoming-price">{player ? money(player.basePrice) : '—'}</span>
            {item.status === 'open' && <span className="tag">ON THE BLOCK</span>}
          </li>;
        })}</ol>
      </section>)}</div>}
  </section>;
}
