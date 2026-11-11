# Completion and bid explanations review

The engine checks the cheapest upcoming base price across the remaining pool, not just the next lot. It uses the same minimum-squad reserve as accepted bids, excludes full/unclaimed/blocked owners, and retains disconnected owners. It leaves unsold and unauctioned statuses distinct. It finishes only between lots, preserving settlement and the existing result-display behavior.

Completion reasons are POOL_EXHAUSTED, SQUADS_FULL, NO_AFFORDABLE_PLAYERS, HOST_ENDED and HOST_CLOSED. The local Room carries an optional completion_reason, which is included in snapshots and file persistence. Results project its message without inferring an unknown historical reason for older rooms. Recovery validates new reason values and terminal-state consistency.

Shared purchase rules now supply the engine and browser with matching squad, overseas and budget/reserve restrictions. BidControl adds connection/pending/state/deadline/leading/spectator explanations and uses aria-describedby to associate the visible message with the button. Derivations stay pure; server time is an argument. React review found no new effects, asynchronous render work or component definitions nested inside renders.

The new local suite covers completion boundaries, cheaper later players, exact-price reserve boundaries, inactive/full teams, auto/manual advance, duplicate timer execution, host end with a paused accepted bid, old-file compatibility and recovery. A real intent sequence empties both purses, records completion, reopens the file and replays the final action without duplicate completion or settlement. Table-driven cases compare UI restriction codes with actual engine rejections.

Browser coverage adds a real two-context bidding sequence with six timed lots. It checks depleted-purse buttons and explanations, continued bidding for a later cheaper player, terminal reason on both clients, final balances, aggregate spend and result reopening. Existing host end/close journeys also assert their displayed reasons.

Scope is the single-process development adapter with local identities and Chromium desktop/mobile viewports. Clerk, real devices, AWS persistence/fencing/failover and capacity remain unverified. Overseas caps alone do not trigger affordability completion. Clipboard and accessibility audits are separate open work.
