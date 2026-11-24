import { useMemo } from 'react';
import { ArrowUpRight, Copy, Trophy } from 'lucide-react';
import { money, type Room } from '../../../../packages/shared/src/domain';
import { deriveAuctionResults, playerRoles } from '../../../../packages/results/src/index';
import { PlayerIcon } from './PlayerIcon';
import '../results.css';

interface AuctionResultsProps {
  room: Room;
  onSquads: () => void;
  onHistory: () => void;
  onCreate: () => void;
  onCopyLink: () => void;
}

export function AuctionResults({ room, onSquads, onHistory, onCreate, onCopyLink }: AuctionResultsProps) {
  const result = useMemo(() => deriveAuctionResults(room), [room]);
  const closedBeforeStart = room.status === 'CLOSED';

  return <section className="auction-results" aria-labelledby="results-title">
    <div className="results-hero">
      <div className="results-hero-copy">
        <span className="eyebrow"><Trophy size={16} aria-hidden="true" /> THE FINAL TEAM SHEET</span>
        <h2 id="results-title">{closedBeforeStart ? 'A night for another time.' : <>The bidding ends.<br /><em>The rivalry lives on.</em></>}</h2>
        <p className="results-completion" role="note" aria-label="Auction end reason">{result.completionMessage}</p>
        <p>{closedBeforeStart ? 'The host closed this room before the first player. Gather your friends for a fresh auction whenever you’re ready.' : 'Every signing, every purse, every squad. Here’s how your auction night finished.'}</p>
        <div className="results-actions">
          <button type="button" className="button" onClick={onCreate}>Create another auction <ArrowUpRight size={18} aria-hidden="true" /></button>
          <button type="button" className="button secondary" onClick={onCopyLink}><Copy size={16} aria-hidden="true" /> Copy results link</button>
        </div>
        <p className="results-privacy">Private results. Only existing room members with access can open this link.</p>
      </div>
      <section className="results-receipt" aria-label="Auction totals">
        <span className="results-receipt-title">AUCTION NIGHT / {room.code}</span>
        <span className="results-total-label">TOTAL VIRTUAL SPEND</span>
        <strong className="results-total">{money(result.totalSpent)}</strong>
        <dl className="results-totals">
          <div><dt>Players signed</dt><dd>{result.sold.length}</dd></div>
          <div><dt>Went unsold</dt><dd>{result.unsold.length}</dd></div>
          <div><dt>Not auctioned</dt><dd>{result.unauctioned.length}</dd></div>
          <div><dt>Teams managed</dt><dd>{result.participatingTeams} / {room.teams.length}</dd></div>
        </dl>
        <span className="results-receipt-foot">VIRTUAL MONEY. LASTING BRAGGING RIGHTS.</span>
      </section>
    </div>

    {!closedBeforeStart && <div className="results-highlights">
      <article className="panel results-highlight">
        <span className="eyebrow">{result.highestSales.length > 1 ? 'JOINT HIGHEST SIGNINGS' : 'HIGHEST SIGNING'}</span>
        <h3>{result.highestSales.length ? result.highestSales.map(player => player.name).join(' · ') : 'No players were signed.'}</h3>
        {result.highestSales.length > 0 && <><strong>{money(result.highestPrice)}{result.highestSales.length > 1 ? ' each' : ''}</strong><p>{result.highestSales.map(player => `${player.name} → ${room.teams.find(team => team.id === player.soldTo)?.name ?? 'Team unavailable'}`).join(' · ')}</p></>}
      </article>
      <article className="panel results-highlight">
        <span className="eyebrow">{result.highestSpendingTeams.length > 1 ? 'JOINT HIGHEST SPEND' : 'HIGHEST SPEND'}</span>
        <h3>{result.highestSpendingTeams.length ? result.highestSpendingTeams.map(team => team.team.name).join(' · ') : 'Every purse stayed intact.'}</h3>
        {result.highestSpendingTeams.length > 0 && <><strong>{money(result.highestSpend)}{result.highestSpendingTeams.length > 1 ? ' each' : ''}</strong><p>Confirmed purchases only. Spending is not a squad ranking.</p></>}
      </article>
    </div>}

    <div className="results-section-heading">
      <div><span className="eyebrow">THE SQUADS YOU BUILT</span><h3>One room. Different game plans.</h3></div>
      <button type="button" className="text-button" onClick={onSquads}>Open squads <ArrowUpRight size={16} aria-hidden="true" /></button>
    </div>
    <div className="results-team-grid">
      {result.teams.map(summary => <article className="panel results-team" key={summary.team.id}>
        <div className="results-team-heading">
          <span className="results-team-mark" style={{ color: summary.team.color, borderColor: summary.team.color }} aria-hidden="true">{summary.team.name.split(' ').map(word => word[0]).join('')}</span>
          <div><h4>{summary.team.name}</h4><p>{summary.ownerName}</p></div>
          <span className="tag">{summary.lineup.length} PLAYERS</span>
        </div>
        <dl className="results-team-budgets">
          <div><dt>Started with</dt><dd>{money(summary.startingBudget)}</dd></div>
          <div><dt>Spent</dt><dd>{money(summary.spent)}</dd></div>
          <div><dt>Remaining</dt><dd>{money(summary.remainingBudget)}</dd></div>
        </dl>
        {!summary.budgetReconciles && <p className="results-rule-note">Budget totals do not reconcile. Reconnect to verify the latest confirmed result.</p>}
        <ul className="results-role-counts" aria-label={`${summary.team.name} player roles`}>
          {playerRoles.map(role => <li key={role}><span>{role}</span><b>{summary.roles[role]}</b></li>)}
        </ul>
        <p className="results-composition">{summary.localCount} local · {summary.overseasCount} overseas · {summary.remainingSlots} squad slots left</p>
        <p className="results-nationalities">{summary.nationalities.length ? summary.nationalities.map(item => `${item.country} ${item.count}`).join(' · ') : 'No nationalities represented yet.'}</p>
        {summary.missingPlayerDetails > 0 && <p className="results-rule-note">Details unavailable for {summary.missingPlayerDetails} purchased player(s); role and nationality counts exclude them.</p>}
        {summary.team.ownerId ? <p className={summary.minimumMissing ? 'results-rule-note' : 'results-rule-met'}>{summary.minimumMissing ? `Minimum squad not met: ${summary.minimumMissing} more player${summary.minimumMissing === 1 ? '' : 's'} required.` : 'Minimum squad requirement met.'}</p> : <p className="results-composition">No manager claimed this team.</p>}
        <details className="results-lineup">
          <summary>View signings <span aria-hidden="true">+</span></summary>
          {summary.lineup.length ? <ul>{summary.lineup.map(purchase => <li key={purchase.playerId}><div className="player-with-art">{purchase.player&&<PlayerIcon p={purchase.player} compact/>}<div><b>{purchase.player?.name ?? 'Player details unavailable'}</b><small>{purchase.player ? `${purchase.player.role} · ${purchase.player.country}` : purchase.playerId}</small></div></div><strong>{money(purchase.price)}</strong></li>)}</ul> : <p>No players purchased.</p>}
        </details>
      </article>)}
    </div>

    <div className="results-pool-grid">
      <details className="panel results-pool">
        <summary><span>Sold players <b>{result.sold.length}</b></span><span aria-hidden="true">+</span></summary>
        {result.sold.length ? <ul>{result.sold.map(player => <li key={player.id}>
          <div className="player-with-art"><PlayerIcon p={player} compact/><span>{player.name}<small>{room.teams.find(team => team.id === player.soldTo)?.name ?? 'Team unavailable'}</small></span></div>
          <span>{money(player.soldPrice!)}</span>
        </li>)}</ul> : <p>No players were sold in this auction.</p>}
      </details>
      <details className="panel results-pool">
        <summary><span>Unsold players <b>{result.unsold.length}</b></span><span aria-hidden="true">+</span></summary>
        <p>These players reached the end of bidding without an accepted bid.</p>
        {result.unsold.length ? <ul>{result.unsold.map(player => <li key={player.id}><div className="player-with-art"><PlayerIcon p={player} compact/><span>{player.name}<small>{player.role} · {player.country}</small></span></div><span>Base {money(player.basePrice)}</span></li>)}</ul> : <p>No unsold players in this auction.</p>}
      </details>
      <details className="panel results-pool">
        <summary><span>Not auctioned <b>{result.unauctioned.length}</b></span><span aria-hidden="true">+</span></summary>
        <p>These players did not receive a final auction result before the room ended.</p>
        {result.unauctioned.length ? <ul>{result.unauctioned.map(player => <li key={player.id}><div className="player-with-art"><PlayerIcon p={player} compact/><span>{player.name}<small>{player.role} · {player.country}</small></span></div><span>Base {money(player.basePrice)}</span></li>)}</ul> : <p>Every player received a final result.</p>}
      </details>
    </div>
    <div className="results-closing"><p>{room.players.some(player => !player.isSample) ? 'Catalog players · All budgets are virtual.' : 'Fictional players and sample statistics · All budgets are virtual.'}<br />Squad breakdowns describe this auction; they do not predict match results.</p><button type="button" className="button secondary" onClick={onHistory}>Review auction history <ArrowUpRight size={16} aria-hidden="true" /></button></div>
  </section>;
}
