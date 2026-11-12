# Phase 1 implementation and verification review

The owner's confirmed rule is +10 lakh for current amounts below 200, +20 from 200 through 500 inclusive, and +25 above 500. `createRoom` stamps new rooms with `tiered-v1`. Missing markers retain the persisted flat increment; neither loading nor updating settings upgrades old rooms. Opening bids remain the player base price. Shared calculation drives server acceptance, UI prices and affordability. Recovery checks the same ladder and rejects unknown rule versions/off-ladder active bids. Tests recover a 545-lakh tiered bid and a 510-lakh legacy bid without changing accepted prices.

The client computes HTTP offset from the send/receive midpoint after token retrieval. Matched ping/pong timestamps refresh it on socket open and every 30 seconds; unsolicited snapshots cannot reset it to arrival-time offset. Existing two-second HTTP polling remains. The bid control schedules its own 150 ms cutoff, latches the deadline, and rechecks time when clicked. Backward clock corrections cannot unlock that control for the same lot/deadline; a later deadline or new lot resets the guard. Server settlement/acceptance uses the true deadline, not the UI margin. Midpoint synchronization assumes approximately symmetric transit time; no precise clock-synchronization SLA is claimed.

Authenticated outsiders receive `ROOM_NOT_FOUND`, HTTP 404 and the same invitation-neutral message for missing and inaccessible rooms across reads, tickets, actions, invitation rotation and denied joins. The comparison tests omit only independently generated request IDs. Wrong/expired invitations, full/ended rooms and denied late spectators follow the same public response. Known host-blocked members retain `ROOM_BLOCKED`; existing host-only and authentication checks remain intact.

`ACCOUNT_DELETED` is terminal in both polling and ticket acquisition. Disposal stops retries and suppresses pending responses; the existing access-loss UI handler clears the room, route, room list and dialog. Core tests cover both HTTP paths with an unavailable socket. The browser regression deliberately injects that HTTP response while rejecting sockets and verifies real UI teardown and cessation of requests. It does not establish a live Clerk provider deletion.

## Results

| Check | Result |
| --- | --- |
| Initial test-first cases | 6 passed, 19 failed before implementation |
| Denied-join expansion | 25 passed, 3 failed before the additional privacy correction |
| TypeScript | Exit 0 |
| Current standalone Vite build | Exit 0; build.json/build.log |
| Full core | 164 passed, 0 failed/skipped |
| Local | 76 passed, 0 failed/skipped |
| Full browser | 32 passed, 0 failed/flaky/skipped; one run, 7.4 minutes |
| Accessibility | 34 scans, zero reported violations; incomplete/human checks remain |
| Test server cleanup | Neither 3101 nor 5273 listening after completion |

The initial broad runs exposed old expectations for the intentionally changed privacy response (5 core and 5 local failures). They are preserved in core-initial.json/local-initial.*. One initial typecheck identified nullable deadline expressions in the new test; corrected before the final checks. No failing run is substituted for the final complete reports.

The browser setup rebuilt the current production bundle with local-profile authentication and exercised real HTTP/WebSocket auction state. Both viewports passed the 300→320 UI bid and actual pong delivery. The independent final build started at 09:20:02.976 UTC, after the browser run completed at 09:19:48.966 UTC; its output did not replace files under an active test run. Logs retain dependency annotation warnings and WebSocket proxy disconnect errors during the disconnect scenarios; this is not a claim of empty logs. The browser report records zero runner errors.

`AA_EVIDENCE_DIR` routes browser reports, screenshots, axe output, server logs and local test reports into this task's directory. Earlier evidence was preserved. React review covered stable component placement, timer/listener cleanup, request identity guards, disabled-state explanations and the fresh-time click check. The 320px mobile pool screenshot was visually inspected; that and automated scans do not replace human assistive-technology testing.

## Scope limits and next work

Only the local adapter is verified. This does not establish distributed ownership, durable cloud timers, failover, production capacity, real Android/Safari behavior or live Clerk challenge/deletion/webhook delivery. Two moderate CDK/minimatch entries remain. Completed Clerk fixtures 139DCB/19B480 were not replayed or migrated. No resources, remote accounts/settings or SQL migrations were created/applied.

AWS diagnostics are separate under WP1-AWS-SETUP. The approved debug wizard identifies bare codex as the WinError 2 subprocess; all three existing MCP configs stayed unchanged. The owner will restart Codex and run `/mcp` after this commit. Current-session tool absence is not proof that the saved absolute launcher is broken. MCP guidance and STS remain unverified. Phase 2 has not started.

Evidence formatting: trailing spaces on blank lines in local-initial.tap were normalized for Git; failure messages and test results are unchanged.
