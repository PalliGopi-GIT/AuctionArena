import type { AuctionMode } from '../../../../packages/shared/src/domain';
import { PlayerIcon } from './PlayerIcon';

export interface PlanPreviewPlayer {
  id: string;
  name: string;
  role: string;
  tier: string;
  image?: string | null;
  imageStatus?: string;
}

export interface PlanPreviewSet {
  name: string;
  count: number;
  players: PlanPreviewPlayer[];
}

export interface PlanPreviewView {
  ok: boolean;
  mode: AuctionMode;
  planVersion: number;
  catalogVersion: string;
  approved: boolean;
  blockedReason?: string;
  adjustments: { code: string; message: string }[];
  counts: {
    total: number;
    byTier: Record<string, number>;
    byRole: Record<string, number>;
    overseas: number;
    domestic: number;
    marquee: number;
  };
  sets: PlanPreviewSet[];
  poolIds: string[];
}

const modeOptions: { mode: AuctionMode; label: string; size: number }[] = [
  { mode: 'quick', label: 'Quick', size: 80 },
  { mode: 'standard', label: 'Standard', size: 120 },
  { mode: 'mega', label: 'Mega', size: 250 },
];

const tierOrder = ['A', 'B', 'C', 'D', 'E'];
const roleOrder = ['Wicketkeeper', 'Batter', 'All-rounder', 'Bowler'];

export function AuctionPlanPanel({
  plan, mode, loading, disabled, modeLocked = false, onSelect, onRegenerate, onApprove,
}: {
  plan: PlanPreviewView | null;
  mode: AuctionMode;
  loading: boolean;
  disabled: boolean;
  modeLocked?: boolean;
  onSelect: (mode: AuctionMode) => void;
  onRegenerate: () => void;
  onApprove: () => void;
}) {
  const canApprove = !!plan?.ok && !plan.approved && !loading && !disabled;
  return <section className="panel plan-panel" aria-labelledby="plan-heading">
    <div className="panel-heading">
      <div><span className="eyebrow">HOST ONLY</span><h2 id="plan-heading">Auction plan</h2></div>
      <span className="tag">{plan?.approved ? 'APPROVED' : plan?.ok ? 'PREVIEW' : 'DRAFT'}</span>
    </div>
    <p className="muted">The server generates the seed and stores the order. During bidding, everyone sees only the remaining upcoming players, grouped by auction set.</p>
    {modeLocked ? <p className="plan-mode-fixed">Mode fixed at creation: <b>{modeOptions.find(option => option.mode === mode)?.label ?? mode}</b> · {modeOptions.find(option => option.mode === mode)?.size ?? plan?.counts.total ?? 0} players</p> :
      <div className="plan-modes" role="group" aria-label="Auction pool size">
        {modeOptions.map(option => <button
          key={option.mode}
          type="button"
          className={'plan-mode' + (mode === option.mode ? ' selected' : '')}
          aria-pressed={mode === option.mode}
          disabled={loading || disabled || !!plan?.approved}
          onClick={() => onSelect(option.mode)}
        >
          <b>{option.label}</b>
          <span>{option.size} players</span>
        </button>)}
      </div>}
    {loading && <p className="plan-loading" role="status">Generating the seeded preview…</p>}
    {!loading && plan && !plan.ok && <p className="form-error" role="alert">{plan.blockedReason ?? 'This pool cannot be planned with the current rules.'}</p>}
    {plan?.ok && <>
      <div className="plan-counts">
        <span><b>{plan.counts.total}</b>Players</span>
        <span><b>{plan.counts.marquee}</b>Marquee</span>
        <span><b>{plan.counts.overseas}</b>Overseas</span>
        <span><b>{plan.counts.domestic}</b>Domestic</span>
        <span><b>{plan.sets.length}</b>Sets</span>
      </div>
      <div className="plan-breakdown">
        <div><span className="label">BY TIER</span><p>{tierOrder.map(tier => <span key={tier}><b>{tier}</b> {plan.counts.byTier[tier] ?? 0}</span>)}</p></div>
        <div><span className="label">BY ROLE</span><p>{roleOrder.map(role => <span key={role}><b>{role}</b> {plan.counts.byRole[role] ?? 0}</span>)}</p></div>
      </div>
      {plan.adjustments.length > 0 && <ul className="plan-adjustments">{plan.adjustments.map(adjustment => <li key={adjustment.code + adjustment.message}>{adjustment.message}</li>)}</ul>}
      <div className="plan-actions">
        <button type="button" className="button secondary" disabled={loading || disabled || plan.approved} onClick={onRegenerate}>Regenerate</button>
        <button type="button" className="button" disabled={!canApprove} onClick={onApprove}>Approve &amp; start auction</button>
      </div>
      <p className="fine-print">Approving locks this order for the room. It survives refresh, reconnect and restart. The order is stored as player IDs only.</p>
      <details className="plan-sets">
        <summary>Review all {plan.sets.length} sets</summary>
        <div className="plan-set-grid">{plan.sets.map((set, index) => <article className="plan-set" key={set.name + index}>
          <h3>{set.name}<span>{set.count}</span></h3>
          <ol>{set.players.map(player => <li key={player.id}>
            <span className="player-with-art"><PlayerIcon p={player} compact/>{player.name}</span><small>{player.role} · {player.tier}</small>
          </li>)}</ol>
        </article>)}</div>
      </details>
    </>}
  </section>;
}
