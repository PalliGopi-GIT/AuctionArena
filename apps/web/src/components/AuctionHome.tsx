import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Flag, Layers, Users } from 'lucide-react';
import catalog from '../../../../packages/catalog/src/data/catalog.json';
import { auctionModeDescriptions, auctionModeRules, money, type AuctionMode } from '../../../../packages/shared/src/domain';
import { PlayerIcon } from './PlayerIcon';

const featured = catalog.players[0];
const steps = [
  { Icon: Users, title: 'Gather your room', copy: 'Create a private room, choose a mode and share the invitation with your group.' },
  { Icon: Layers, title: 'Set the auction order', copy: 'Claim teams. The host previews and approves the player plan from the Overview.' },
  { Icon: Flag, title: 'Bid and build', copy: 'Follow the live set, bid on upcoming players and review your final squad.' },
];
const formats: { mode: AuctionMode; description: string }[] = [
  { mode: 'quick', description: auctionModeDescriptions.quick },
  { mode: 'standard', description: auctionModeDescriptions.standard },
  { mode: 'mega', description: auctionModeDescriptions.mega },
];

export function AuctionHome({ onCreate, onJoin, busy, planSection }: {
  onCreate: (mode?: AuctionMode) => void;
  onJoin: () => void;
  busy: boolean;
  planSection?: ReactNode;
}) {
  return <main id="main-content" className="auction-home" tabIndex={-1}>
    <section className="match-cover">
      <div className="cover-copy">
        <p className="section-label"><span className="cover-rule" /> Private cricket auctions</p>
        <h1>Build a squad.<br /><em>Own the auction.</em></h1>
        <p className="cover-intro">Bring your friends to the auction table. Claim a team, bid live on players and build your XI with a virtual purse.</p>
        <div className="cover-actions">
          <button className="button" disabled={busy} onClick={() => onCreate()}>Create an auction <ArrowUpRight size={18} /></button>
          <button className="button secondary" disabled={busy} onClick={onJoin}>Join with a code <ArrowRight size={17} /></button>
        </div>
      </div>
      <article className="catalog-cover" aria-label="Player catalog preview">
        <div className="cover-mast"><span>Player spotlight</span><span>Catalog preview</span></div>
        <div className="cover-field">
          <div className="field-markings" aria-hidden="true" />
          <PlayerIcon p={featured} eager />
          <div className="cover-caption"><span>{featured.country} · {featured.role}</span><h2>{featured.name}</h2></div>
        </div>
        <div className="cover-score"><span>Base price <strong>{money(featured.basePrice)}</strong></span><span>Auction pool <strong>{featured.marquee ? 'Marquee' : 'Main pool'}</strong></span></div>
      </article>
    </section>
    <section className="format-section" aria-labelledby="format-title">
      <h2 id="format-title">Auction formats</h2>
      <div className="format-grid">{formats.map(({ mode, description }) => {
        const rules = auctionModeRules[mode];
        return <button type="button" className="format-card" key={mode} disabled={busy} onClick={() => onCreate(mode)}>
          <span className="format-count">{rules.players}<small> players</small></span>
          <h3>{mode[0].toUpperCase() + mode.slice(1)}</h3>
          <p>{description}</p>
          <span className="format-meta">₹{rules.purse / 100} Cr purse · squad of {rules.squad}</span>
          <span className="format-action">Create this auction <ArrowUpRight size={16} /></span>
        </button>;
      })}</div>
    </section>
    <section className="home-guide" id="experience" aria-labelledby="experience-title">
      <h2 id="experience-title" tabIndex={-1}>Auction Experience</h2>
      <ol>{steps.map(({ Icon, title, copy }) =>
        <li key={title}><Icon aria-hidden="true" size={20} /><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol>
    </section>
    {planSection && <section className="home-plan" aria-label="Auction plan">{planSection}</section>}
  </main>;
}
