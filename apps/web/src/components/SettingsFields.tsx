import { auctionModeLabels, auctionModeRules, modeNationalityLabel, type Settings } from '../../../../packages/shared/src/index';

const legacyGroups = [
  { title: 'Teams and budgets', fields: [
    ['budget','Budget (lakhs)',200,20000], ['minSquad','Minimum squad',1,11],
    ['maxSquad','Maximum squad',2,12], ['maxOverseas','Overseas limit',0,12],
  ] },
  { title: 'Auction timing', fields: [
    ['timerSeconds','Bid timer (seconds)',10,120], ['resultSeconds','Result display (seconds)',2,20],
  ] },
] as const;

export function SettingsFields({ settings, setSettings, legacy = false }: {
  settings: Settings; setSettings: (settings: Settings) => void; legacy?: boolean;
}) {
  const modeRules = settings.mode ? auctionModeRules[settings.mode] : null;
  return <>
    <label>Room name<input autoFocus required minLength={3} maxLength={60} value={settings.name}
      onChange={e => setSettings({ ...settings, name: e.target.value })}/></label>
    {modeRules ? <section className="mode-rules" aria-label="Fixed auction rules">
      <h3>{auctionModeLabels[settings.mode!]} mode</h3>
      <div>
        <p><span>Player pool</span><b>{modeRules.players} players</b></p>
        <p><span>Starting purse</span><b>₹{modeRules.purse / 100} Cr</b></p>
        <p><span>Squad size</span><b>Exactly {modeRules.squad}</b></p>
        <p><span>Nationality</span><b>{modeNationalityLabel(settings.mode!)}</b></p>
        <p><span>Bid timer</span><b>{modeRules.timerSeconds} seconds</b></p>
      </div>
      <p className="fine-print">The auction mode is fixed at creation. Only the room name, team count and lobby options can change.</p>
    </section> : legacyGroups.map(group => <fieldset key={group.title} className="settings-group">
      <legend>{group.title}</legend>
      <div className="form-grid">{group.fields.map(([key, label, min, max]) =>
        <label key={key}>{label}<input type="number" min={min} max={max} required value={settings[key]}
          onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })}/></label>)}</div>
    </fieldset>)}
    <label>Number of teams<input type="number" min={2} max={10} required value={settings.teamCount}
      onChange={e => setSettings({ ...settings, teamCount: Number(e.target.value) })}/></label>
    {legacy ? <label>Bid step (lakhs)<input type="number" min={5} max={100} required value={settings.bidIncrement}
      onChange={e => setSettings({ ...settings, bidIncrement: Number(e.target.value) })}/></label> :
      <p className="fine-print">Bids rise by 10 lakh below 200, by 20 lakh from 200 through 500, and by 25 lakh above 500.</p>}
    {([
      ['lateExtension','Extend timer after a late bid'],
      ['autoAdvance','Automatically open the next player'],
      ['spectators','Allow invited spectators after start'],
    ] as const).map(([key,label]) => <label key={key} className="checkbox"><input type="checkbox"
      checked={settings[key]} onChange={e => setSettings({ ...settings, [key]: e.target.checked })}/>{label}</label>)}
  </>;
}
