import {
  auctionModeDescriptions, auctionModeLabels, auctionModeRules, auctionModes,
  modeNationalityLabel, settingsForMode, type AuctionMode, type Settings,
} from '../../../../packages/shared/src/index';

/** New rooms always start from a mode preset; legacy rooms keep their saved rules. */
export function CreateAuctionFields({ settings, setSettings }: {
  settings: Settings; setSettings: (settings: Settings) => void;
}) {
  const mode = settings.mode ?? 'standard';
  const rules = auctionModeRules[mode];
  function chooseMode(next: AuctionMode) {
    setSettings(settingsForMode(next, {
      name: settings.name,
      teamCount: Math.min(10, Math.max(2, settings.teamCount)),
      lateExtension: settings.lateExtension,
      autoAdvance: settings.autoAdvance,
      spectators: settings.spectators,
      resultSeconds: settings.resultSeconds,
    }));
  }
  return <>
    <label>Room name<input autoFocus required minLength={3} maxLength={60} value={settings.name}
      onChange={event => setSettings({ ...settings, name: event.target.value })}/></label>
    <fieldset className="mode-picker">
      <legend>Auction mode</legend>
      <div className="mode-options" role="group" aria-label="Auction mode">
        {auctionModes.map(option => {
          const optionRules = auctionModeRules[option];
          return <button key={option} type="button" className={'mode-option' + (mode === option ? ' selected' : '')}
            aria-pressed={mode === option} onClick={() => chooseMode(option)}>
            <b>{auctionModeLabels[option]}</b>
            <span>{optionRules.players} players</span>
            <small>{auctionModeDescriptions[option]}</small>
          </button>;
        })}
      </div>
    </fieldset>
    <label>Number of teams<input type="number" min={2} max={10} required value={settings.teamCount}
      onChange={event => setSettings({ ...settings, teamCount: Number(event.target.value) })}/></label>
    <section className="mode-rules" aria-live="polite" aria-labelledby="mode-rules-title">
      <h3 id="mode-rules-title">{auctionModeLabels[mode]} rules</h3>
      <div>
        <p><span>Player pool</span><b>{rules.players} players</b></p>
        <p><span>Starting purse</span><b>₹{rules.purse / 100} Cr</b></p>
        <p><span>Squad size</span><b>Exactly {rules.squad}</b></p>
        <p><span>Nationality</span><b>{modeNationalityLabel(mode)}</b></p>
        <p><span>Bid timer</span><b>{rules.timerSeconds} seconds</b></p>
      </div>
    </section>
    <fieldset className="settings-group">
      <legend>Room options</legend>
      {([
        ['lateExtension', 'Extend timer after a late bid'],
        ['autoAdvance', 'Automatically open the next player'],
        ['spectators', 'Allow invited spectators after start'],
      ] as const).map(([key, label]) => <label key={key} className="checkbox"><input type="checkbox"
        checked={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.checked })}/>{label}</label>)}
    </fieldset>
    <p className="fine-print">The mode fixes the purse, squad size, nationality rules, player pool and timer. The room code and invitation are created with the room.</p>
  </>;
}
