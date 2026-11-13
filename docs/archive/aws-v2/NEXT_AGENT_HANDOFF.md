# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

# AuctionArena - next agent handoff

## Latest read-only MCP audit — 12 November 2026

AWS MCP connectivity is verified: 8 exposed tools, successful agent_skills documentation search, retrieval of signing-in-to-aws, and STS GetCallerIdentity. The returned ARN exactly matches the login_session saved under AuctionArena (project ID ending 2955; AccountFullAccessRole). The local profile and plan use ap-south-1 (Mumbai). The owner reports that the sign-in page assigns project "Array of Sunshine" to ap-southeast-2 (Sydney). This discrepancy is unresolved: the assigned project Region/name were not independently verified, no connected browser was available, and STS does not establish assigned Region. No AWS resources, configuration, deployment, Clerk data or migrations changed. Phase 2 has not started.

Evidence: [connected verification](docs/reports/evidence/WP1-AWS-SETUP/connected-verification.json). This audit supersedes the older connection/restart statements below and in the earlier status.json/mcp-check.json snapshots. Earlier Mumbai selection describes the plan/profile, not a verified project assignment. Phase 1 remains committed as 03b98b2; application tests and billing/credits were not rerun. No Region correction or Phase 2 work is authorized by this audit.

## Prior checkpoint record

Last updated: 2026-11-12 (local). Workspace: C:\Users\palli\OneDrive\Desktop\IPL-AUCTION.
Repository: main. Initial baseline commit: 2ce72bb. The Phase 1 checkpoint commit is titled fix: complete Phase 1 auction correctness; staged credential/exclusion checks are recorded in its evidence. Private/runtime paths remain ignored.

## Current Phase 1 result

Phase 1 rule fixes are complete for their local scope: TypeScript and production build pass; 164 core tests, 76 local tests and all 32 Chromium desktop/mobile-viewport browser cases pass with zero failures/skips/flaky cases. All 34 axe scans report zero violations; human accessibility remains unverified. The owner confirmed +10 below 200, +20 from 200 through 500 inclusive, +25 above 500 for new rooms only. Existing rooms retain flat rules and accepted prices. Evidence: WP1-RULE-FIXES/validation.json. The owner says this Codex session predates the config repair and will restart Codex after the Phase 1 commit; defer interactive /mcp verification to that fresh session. The current tool list remains empty, which does not prove the saved launcher is broken. The debug wizard failure is identified as bare codex (Windows CMD-shim subprocess resolution), exit 255; all three MCP config files stayed unchanged. Do not blindly rerun registration or edit config. No AWS resources, Clerk users/settings or SQL migrations were created or changed. Phase 2 has not started.

The older continuation bullets below are historical. PROJECT_STATUS.md and docs/plan/tasks/WP1-RULE-FIXES.md hold the current sequence/evidence. Baseline commit 2ce72bb is saved; Phase 1 is saved in the checkpoint commit titled fix: complete Phase 1 auction correctness.

## Architecture and constraints

Use AuctionArena Master Architecture.md as the source of truth. Selected AWS Region is ap-south-1; named profile AuctionArena; guidance MEDIUM. These supersede Sydney/AUCTION-FIELD. User policy: $0 out-of-pocket, $10/month staging from credits, no AWS resource deployment of any kind without explicit approval. Host verification confirms STS identity, ap-south-1 default, FREE/ACTIVE plan and 100 USD remaining credits. AWS CLI 2.40.0, uv 0.13.7 and 25 default AWS skills are installed. The Codex proxy entry/profile merge and remote skill-catalog retrieval succeeded. The absolute uvx launcher repair is saved with a private original backup; proxy arguments and unrelated configuration are preserved. The user-requested toolkit rerun exited 1 (wizard 255/WinError 2), while catalog verification passed with 122 skills. Actual MCP tools remain absent after restart approval/observed host-server recovery. Debug tracing identifies bare codex in the vendor registration subprocess; config remains unchanged. Subsequent tool/identity verification is still required. Billing/spend restrictions still need review in AWS Settings > Billing. No AWS resource was created.

The user explicitly requires approval before creating any new Clerk test accounts or changing Clerk instance settings. Approval for the new challenge fixtures is not yet granted. Preserve the completed live fixtures (139DCB and 19B480). The active request covers all five areas: account lifecycle, authentication coverage, manual accessibility, remaining CDK advisories and distributed backend; do not describe them all as complete.

The working runtime is a single-process local adapter, using .data/auctionarena.json. React/Vite sends intents to Hono; a pure TypeScript engine enforces rules; the store persists snapshots and broadcasts via WebSockets. Production/distributed reliability is not implemented or proven.

## Current verification

| Check | Result |
| --- | --- |
| TypeScript + Vite build | Passed; Vite runner loader needed in this restricted environment |
| npm.cmd run test:local | 76 passed, 0 failed |
| Core Vitest 5.1.0, runner config loader | 164 passed, 0 failed/skipped; includes 28 rule-fix, 20 ownership-model, 18 account and 14 Windows bootstrap tests |
| Additional preview diagnostics | 6 real-HTTP tests passed; automatic startup/config/cleanup cycle passed |
| Prior auction browser baseline | 20 passed, 0 failed/flaky: ten scenarios on desktop/mobile viewports; evidence WP1-ROOM-RESILIENCE |
| Latest full browser run | 32 passed, 0 failed/flaky/skipped in one run (7.4 minutes); WP1-RULE-FIXES |
| Auth-change browser regression | 4 selected desktop/mobile lifecycle/management checks passed |
| Clerk development setup | AuctionArena (formerly Wrapper) linked; host doctor passed |
| Basic real Clerk path | Persisted room 0B9CEC: Clerk host, Chennai claimed and ready, no local sessions |
| Live Clerk browser smoke test | Passed on host: real ticket sign-in/API identity/create/claim/reload/sign-out; room 139DCB |
| Two-user Clerk browser flow | Passed on host, room 19B480: switching, invites/access, bidding, WebSocket sale, completed results/reload and sign-out |
| Account-switch/reload browser regression | 6 passed: desktop/mobile lifecycle, local identity switch and signed-out full reload |
| Participant profile projection | Complete: typecheck, 70 core, 76 local, six browser regressions and six host live checks passed; saved names and auction state reconciled |
| Room sharing/resilience | Complete: clipboard success/fallback, room-only result links, focus/identity safety, actual host expiry/resume and allowed/denied late spectators |
| Accessibility automation | 34 axe scans including profile dialogs, zero reported violations; keyboard/reflow pass; manual incomplete checks remain |
| Account lifecycle | Implemented and locally verified; live deletion/reverification/webhook delivery pending |
| Clerk challenge readiness | Host inventory: password/email-code/Google enabled, multi-session disabled; isolated no-fixture preflight passed; actual challenges pending approval |
| AWS bootstrap / current MCP check | Absolute uvx launcher runs and is saved; verified backup, args/unrelated entries preserved; requested wizard 255/WinError 2, catalog 122 passed; zero current AWS tools; fresh Codex restart is deferred by the owner until after this commit |
| Ownership coordination core | 20 model cases pass; provider-independent module/testkit, not wired to the application; independent review and real adapters/drills pending |
| Dependency audit | Fresh host report: 0 critical, 0 high, 2 moderate entries open (CDK/bundled minimatch); five baseline entries resolved |
| Human screen-reader / OS zoom / real devices / Safari | Not exercised; automated accessibility results are recorded above |
| Cloud deployment / distributed runtime / capacity | Not implemented or tested |

The contention test correctly uses new LocalRoomStore(null, () => 100000) with a 60 s timeout. Host heartbeat expiry previously caused assertions to fail during slow runs. Dedicated heartbeat tests remain.

## Changes in this continuation

- Phase 0 (latest user-directed checkpoint): saved the absolute installed uvx command and requested project env after a verified private backup. The inherited PATH failure was ENOENT; the older EPERM restriction is obsolete. Future bootstrap resolves installed executables, preserves unrelated config/args, refuses conflicting env and guards concurrent edits. No global PATH change or restart. The exact requested Toolkit/VerifyToolkit command returned overall exit 1, vendor wizard exit 255 with [WinError 2] The system cannot find the file specified; independent catalog retrieval passed with 122 skills. Existing Codex and unrelated entries in both other detected agent configs are preserved. The later approved debug run identifies bare codex, recorded in WP1-AWS-SETUP/reconnect-diagnosis.md.
- Phase 0 verification: 14 focused bootstrap cases and all 136 core tests pass with zero failures/skips; TypeScript and both PowerShell source syntax checks pass. Pre-implementation helper run was 11 pass/3 fail; final run is clean. Frontend build/local/browser/Clerk suites were not rerun. Evidence: WP1-AWS-MCP-REPAIR. Git initialized on main with a staged credential/exclusion check before the baseline commit. PROJECT_STATUS.md records the phase sequence and approval gates. Phase 1 has not begun.

- Added WP1-OWNERSHIP-CORE: provider-independent RoomOwnership with atomic lease/fenced-write ports, unique acquisition tokens, epoch compare/increment, post-claim lease confirmation, monotonic request-start TTL bounds, synchronous demotion, serialized captured proposals and no blind retry after uncertain writes. Test-only simulators cover contention, expiry, delayed I/O, key loss/split ownership, fencing, version conflict and release races. A real-engine bid/sale case preserves an accepted bid's absolute deadline and settles once after simulated handover. This module has no application imports/wiring, real datastore adapters, recovery validation, renewal scheduler, idempotency implementation or cloud drill. Independent review is pending; do not call the distributed runtime complete.
- Latest verification: TypeScript and production build, 130 core and 76 local tests pass with zero failures/skips. Evidence: docs/reports/evidence/WP1-OWNERSHIP-CORE/validation.json and raw logs/core-results.json. Browser/Clerk checks were not rerun; prior 28-case/34-scan evidence remains historical. No auction/HTTP/UI behavior changed.
- Historical restricted-session MCP check (superseded by the Phase 0 repair above): no AWS tools were exposed and launcher execution was then denied. No MCP transport/search/skill/identity was verified. Recorded WP1-AWS-SETUP/mcp-check.json. Did not repeat setup/login/import or change global configuration. Corrected stale Sydney/profile/setup instructions in infra/README.md.
- Attempted the isolated CDK bundle probe. Installation failed before resolution/glob/audit checks; diagnostic retries, including a workspace-local npm cache, return npm EACCES. Added bounded fetches, redacted exit/error diagnostics and before/after root dependency hashes. Latest report and two archived attempts are under WP1-CDK-BUNDLE-FIX; root package/lock hashes match. Both moderate advisories remain open. No further sandbox retry is useful without an external change.

- Implemented WP1-ACCOUNT-LIFECYCLE in the local adapter: normalized unique application names, profile dialog, verified-subject/expected-subject mutation guards, signed Clerk webhooks with provider ordering, five-minute signed first-factor reverification, durable deletion jobs/retry and immediate session/ticket/socket denial. Cleanup anonymizes shared results/history while preserving accepted prices, squads and budgets; sole-member rooms are removed. Actor IDs support departed/renamed-user cleanup. Provider deletion of an active host ends through the engine and settles a leader once. This is not the distributed account store/worker.
- Verified TypeScript/build, 110 core, 76 local, one clean 28-case browser run and 34 zero-violation axe scans. A bootstrap subprocess exceeded its former 10-second startup deadline under load; the child deadline is now 30 seconds, with explicit second-call status assertions. The failed attempt is retained separately; the final complete run passed. Owned local/E2E/challenge ports are stopped.
- Read host Clerk readiness.json (122 safe flags). Prepared an opt-in password/email-code/name/deletion harness using its own bundle/database, API 3401/web 5573, at most two purpose-tagged users and one room. Syntax/plan and isolated preflight passed without creating users/rooms. No new Clerk account/settings mutation is authorized yet. MFA availability needs a precise read-only check; Google, direct switching, human Android and webhook delivery remain unverified.
- Prepared the isolated CDK/minimatch probe (subsequently attempted and blocked by npm EACCES as recorded above). Prepared the Windows/Android manual accessibility checklist; no human results or Safari pass exists.
- Finished AWS host bootstrap through several Windows issues: wizard WinError 2 after skill/Claude setup; imported only its reviewed generated proxy entry; corrected Windows PowerShell File.Replace backup handling; fixed charmap output using process-local AWS_CLI_OUTPUT_ENCODING=UTF-8. Host setup:aws:check now retrieves the remote catalog successfully. The profile is AuctionArena/Mumbai. Current agent tools still lack AWS search/retrieve; reconnect before service-specific implementation. No login repeat, reinstall, import repeat or deployment is needed.

- Completed WP1-DEPENDENCY-HARDENING's upgrade/verification scope with two explicitly open moderate advisories. Installed Zod 4.6.7, Vitest/Mocker 5.1.0 and @hono/node-server 2.1.3; Vite remains 6.4.6 with that minimum now in the manifest, and Node >=22.15 is declared. Tinypool is removed; Clerk Backend 3.27.0 and React 6.18.6 are unchanged. Adapted the Zod pipe input type while preserving complete update-settings validation. Oversized requests now return explicit JSON PAYLOAD_TOO_LARGE/413 rather than becoming generic 500 errors.
- Added six schema/real-HTTP compatibility tests for defaults, false/zero/trim behavior, strict payloads, refinements, complete updates, safe bids, auth/CORS, unchanged state on rejection and fixed-length/streamed body limits. TypeScript, production build, 84 core, 76 local and all 24 browser cases pass. Both 16-state axe matrices still report zero violations; incomplete/human checks remain. Confirmed both owned test ports stopped. No live Clerk fixture was replayed or AWS service operation performed.
- Fresh host npm audit reduced seven affected entries to two moderate entries: aws-cdk-lib 2.276.0 and its bundled minimatch 10.2.6. The latest published CDK release still bundles the affected version. No force override, downgrade or suppression was applied. This is an open development-tooling chain, not a clean audit or production-security pass. Exact versions, lockfile changes/hash, fresh sanitized audit, complete 24-case browser result and validation are under WP1-DEPENDENCY-HARDENING. This clean browser run supersedes the earlier composed accessibility accounting below; the historical raw failures are preserved.

- Completed WP1-ACCESSIBILITY's implementation/automated-audit scope. Added skip/main focus, mobile primary navigation, pressed room-section state, inert app-modal background, authored 44px controls/checkbox labels, safe long-name/narrow-form wrapping, corrected heading/result semantics and homepage contrast. Natural logo names match visible words. Disabled mobile bid controls no longer overlay the timer; enabled controls remain sticky.
- Added a per-component auction announcement scheduler and React live regions. Polite shared state coalesces at 1000ms; critical messages are spaced at least 2000ms even across brief dialog exits. Countdown speech only occurs at thresholds. Stale warnings clear and private queued speech cancels on exit. Eight deterministic tests and all 78 core tests pass. No new API subscriptions/calls or auction mutations.
- The user installed @axe-core/playwright 4.14.0 from the host. Sixteen states per viewport now have zero reported axe violations with no excluded rules; incomplete contrast/obscuration checks remain in the reports. Keyboard tests cover skip visibility, natural brand names, inert background, targets, 320px long-name reflow, filtering and speech clearing. Human screen-reader/zoom, real devices/Safari and Clerk challenge UI remain unverified.
- At the accessibility stage, browser evidence was composed: the full run passed all 20 auction flows and 2 scan cases; 2 new keyboard assertions expected AuctionArena instead of Chrome's valid Auction Arena. The corrected keyboard rerun passed both viewports. Its validation.json records raw 22/2 and corrected 2/0; do not relabel that historical raw report as a clean run. The newer dependency verification above has a separate clean 24/0 report.
- The baseline host audit at that stage reported seven affected package entries: critical Vitest/Tinypool, high Zod and moderate adapter/transitive tooling chains. Its report remains in WP1-ACCESSIBILITY/dependency-audit.json. The dependency upgrade and fresh audit are now recorded above; the baseline is not the current count. Agent npm restrictions required host installation/audit; no private keys were shared.

- Completed WP1-ROOM-RESILIENCE. Copy denial now provides a labelled, selectable invitation/results link dialog with keyboard wrap, Escape and opener restoration. The results button copies a room-only member-access URL without invitation credentials. Pending copy callbacks verify current identity/room membership before displaying private data; identity/access loss clears the dialog. Create input/review focus now follows modal content without losing the original opener.
- Added five new browser scenarios, each on desktop/mobile: actual Clipboard API sharing/results reopening, denied and delayed clipboard completion, real-clock host expiry with a bid held past its original deadline then explicit resume/single settlement, and enabled/disabled late spectator policy. Direct spectator claim/bid probes assert ALREADY_STARTED/NO_TEAM, and real spectator WebSocket COMPLETED delivery/reload is verified. No engine/API changes were necessary. Ten targeted cases and the full 20-case suite passed; TypeScript and all 70 core tests passed. Reviewed six screenshots and verified owned test-server shutdown. Evidence is under WP1-ROOM-RESILIENCE; no live Clerk fixtures were replayed or AWS resources touched.

- Implemented lazy Clerk profile-name projection in apps/api/src/clerk-profiles.ts and clerk-profile-name.ts. After real token verification, backend reads the User for that subject, derives bounded first/last name or username, and persists only name/fetch time. Five-minute refresh, coalescing, 1.5-second wait and 30-second failure backoff prevent repeated slow lookups. Existing names survive outages. Actions/tickets/socket delivery never fetch profiles. Local-profile sign-in stays independent.
- LocalRoomStore now accepts an optional profiles map and projects successful name changes into existing members/results. It commits before versioned profile_updated delivery, preserving ownership, budgets, purchases, squad/deadline/status and historic events. Old databases load without migration; invalid profile records fail recovery. Seven new scenarios cover real token boundaries, provider/cache failure modes, ownership, completed sale/socket delivery and restart.
- Completed the host test:clerk:profiles check with six recorded passes in room 19B480. Both API and results/WebSocket views show AuctionArena Test host / AuctionArena Test guest; reload, both sign-outs and 401 denial passed without runtime errors. Reviewed both screenshots and independently reconciled the persisted projection/member names against unchanged ownership, completed state, purchase, budgets and squads (projected-room.json). No new identities/rooms or auction intents; the runner closed its own preview. Prior live passes are preserved.
- Added plan-only/preflight-only modes to the profile helper. The new Node launcher initially exposed strip-only syntax through an API import; a separate pure name formatter fixed that import boundary. Plan/preflight startup/build/config/cleanup and TypeScript pass. Do not rerun passing host helpers without a new reason.

- Completed WP1-CLERK-TWO-USER on the host with room 19B480. The corrected retry reused both synthetic identities and the original room; no extra users/rooms were created. All access/invite, account-switch, claim/ready/start/bid, real WebSocket RESULT, results/reload and sign-out checks passed without runtime errors. Reviewed both screenshots and reconciled the persisted COMPLETED/HOST_ENDED room: Chennai bought p1 for 100 lakhs, remaining budget 1900; Mumbai remains 2000. The preview was closed by the runner. Do not rerun the completed fixture.
- Added identity isolation/reload cleanup, safe diagnostics and guarded reuse after the first host failure during account switching. The failed report remains archived. TypeScript now covers scripts; all 63 core tests, six selected desktop/mobile browser cases and a fresh automatic Clerk-only preview startup/config/cleanup check passed.

- Confirmed the host live smoke test passed with room 139DCB. Result.json records seven checks: preview/instance, AuctionArena heading, real active Clerk session and pending-create continuation, exact API identity, UI create/claim/reload, and sign-out with unauthenticated private access returning 401. Reviewed both screenshots and independently verified the persisted Mumbai claim with a Clerk host and no local-profile sessions. WP1-CLERK-READINESS is complete for this scope; password/OTP/OAuth/MFA and live mobile coverage remain.
- Fixed the live runner's generic preflight failure: the preview was stopped (ECONNREFUSED on :5373/:3201). The runner now probes exact Clerk-only configuration, automatically starts the preview when stopped, reports precise safe error codes, and closes only its own server. Six real-HTTP regression cases and an actual automatic startup/config/cleanup cycle passed; TypeScript passed. --preflight-only creates no remote users/rooms and writes preflight-result.json separately.
- User renamed the existing Clerk application Wrapper to AuctionArena (same app/instance IDs). Added typed AuctionArena localization in apps/web/src/auth-branding.ts and wired it to ClerkProvider. Typecheck/build passed and served bundle contains the new copy.
- Verified persisted Clerk-backed room 0B9CEC: WAITING, one member, Chennai claimed and ready, zero local-profile sessions. Do not claim the agent created it or completed live browser automation.
- Added scripts/test-clerk-live.mjs and npm.cmd run test:clerk:live. Defaults to plan-only. Explicit --create-test-user opts into one synthetic development user and a real-ticket sign-in/browser create/claim/reload/sign-out test; evidence is redacted. The user executed it successfully from the host. It retained its synthetic user/room and shut down the preview it owned. No rerun is needed unless code changes justify it.
- Added scripts/dev-clerk.mjs, clerk-config.ts and clerk-api.mjs. The host launcher privately loads development keys, disables local identities, derives issuer/origins, refuses occupied ports and uses a separate database and .data/clerk-preview/ bundle. Added dev:clerk and test:auth commands.
- scripts/dev.mjs now explicitly clears Clerk keys in local-profile child processes so .env.local does not select Clerk for the local-profile UI.
- Added apps/api/src/clerk-auth.ts for real SDK signature/lifetime/origin/issuer checks plus active session identity validation; added 17 tests/core/auth.test.ts cases with ephemeral signing keys. Optional CLERK_JWT_KEY and CLERK_ISSUER are wired into the API. Installed SDK versions were preserved.
- The user selected and linked Wrapper (app_3LlP2OcDruOfpacg7AYHbOGU7jj), dev instance ins_3LlP2P5dv6hhyDKp3h6huKBFkFd, and pulled development keys privately. Do not rerun init or replace the app. No secrets were printed or copied into reports.
- Actual-key preview built and served on :3201/:5373. Health/config succeeded and unauthenticated me returned 401. Agent outbound Clerk signing-key retrieval failed EACCES, so live verification ran on the host and subsequently passed.
- Implemented architecture section 5.10 affordability completion using the cheapest upcoming player and the shared minimum-squad reserve. Checks run at the existing next-lot boundary. Full/unclaimed/blocked owners are excluded; disconnected owners still count.
- Added optional Room.completion_reason, validated during recovery and projected into result messages. Values: POOL_EXHAUSTED, SQUADS_FULL, NO_AFFORDABLE_PLAYERS, HOST_ENDED, HOST_CLOSED. Older files remain readable without guessing their reason.
- Added shared bid-rules.ts and BidControl.tsx: visible accessible reasons for disabled bids, matching the server's purchase constraints. Added 22 completion/eligibility/persistence tests in tests/local/completion.test.mjs and included them in test:local.
- Expanded browser coverage with real purse-depletion bidding and reason assertions, including host end/close reasons. Evidence and review: docs/reports/evidence/WP1-AUCTION-COMPLETION/.
- Added playwright.config.ts, tests/e2e/auction.spec.ts and tests/e2e/setup.ts.
- Added scripts/e2e-api.mjs and scripts/e2e-web.mjs: production bundle, separate ports, unique temporary DB, IPC shutdown and cleanup. Tests never open the developer DB or reuse existing servers.
- Added npm.cmd run test:e2e; ignored test-results/ failure artifacts.
- vite.config.ts now accepts API_PORT for its HTTP/WebSocket proxy, retaining 3001 as default.
- apps/web/src/main.tsx now preserves API error codes and consumes connectRoom.accessLost. Removed members leave the stale room view and see an error. Browser tests assert this and preserved results.
- Regenerated local-suite evidence; added WP1-E2E evidence and task record; updated BUILD-STATUS.md and README.md.

Prior work wired RoomMembers and AuctionResults, host rule editing, invite renewal, removal/block, leave and close/end dialogs into the UI. The earlier manual flow is recorded under WP1-ROOM-COMPLETION/browser-flow.md.

## Automated browser coverage

Two isolated browser contexts sign in locally, create/review a fresh room, claim different teams, join by invite, mark ready, start, pause/resume, bid, refresh, wait for settlement, go offline/reconnect, remove/block, end and reopen results. Read-only HTTP assertions verify the guest's 403 ROOM_BLOCKED, preserved sale, INR 19.00 Cr remaining purse and squad. The removed browser must return home with an error.

A second scenario rotates an invitation, rejects its old token, joins with the current token, leaves/releases the team, and closes before start. Both scenarios run on desktop Chromium and a 390x844 mobile viewport. Runtime page errors fail the lifecycle test; results-page horizontal overflow is checked; screenshots are retained. This is not real-device or Safari evidence.

A third scenario uses real competing browser bids and six timed lots to exhaust both purses. It checks disabled-bid explanations, allows a cheaper later player despite an unaffordable current lot, completes with NO_AFFORDABLE_PLAYERS, preserves spend/squads and reloads the displayed reason. It also runs on both viewports; screenshots end in -affordability.png.

The current suite has fourteen scenarios per viewport (28 total): ten auction scenarios, two accessibility scan/keyboard cases and two account cases. Account cases verify name rules/collisions, deletion with shared-record preservation and stale profile responses after sign-out. Existing identity, clipboard, host-expiry and spectator scenarios remain covered. Focus is checked on create/review and dialogs. Latest full evidence is WP1-ACCOUNT-LIFECYCLE/browser-results.json: 28 passed in one run, plus 34 zero-violation axe scans. Earlier reports remain historical evidence. Full accessibility, real-device and Safari claims remain unestablished.

## Commands

~~~powershell
npm.cmd run dev:local
npm.cmd run test:local
npx.cmd tsc --noEmit
npx.cmd vite build --configLoader runner
npx.cmd vitest run tests/core --configLoader runner --reporter=verbose
npm.cmd run test:e2e
npm.cmd run test:a11y
npm.cmd run dev:clerk
npm.cmd run test:auth
npm.cmd run test:clerk:challenges
npm.cmd run test:clerk:challenges -- --preflight-only
npm.cmd run setup:aws:check
~~~

The first challenge command is plan-only. Do not add --create-test-users without explicit approval. The setup check needs the host network; it already passed and should not be repeated without a reason. test:cdk:bundle is plan-only unless --install-probe is supplied; sandbox installs failed with EACCES, and a successful host download/resolution probe remains pending. Do not repeat the blocked sandbox path.

Node 22.15+ and installed Chrome are required for this harness. Chrome is present on this machine. Standard Vite config bundling encountered an esbuild ancestor-directory access denial in the sandbox; runner loading passed. E2E uses runner loading automatically. Avoid overwriting evidence with failed exploratory commands.

Development uses API :3001 / frontend :5173. E2E owns :3101 / :5273 and temporary data, shutting down both children at completion. The earlier development room 375DF8 is not a test fixture; this continuation did not open or modify its database.

Live Clerk verification uses API :3201 and frontend :5373. The host helper starts them automatically if needed and shuts down only its own preview. The agent shell cannot fetch the Clerk CLI or remote JWKS; no connected computer/browser control surfaces are available. Real sign-in evidence is the successful host-run result, not the ephemeral-key tests. Profile names now resolve through the Backend SDK and a local persistent projection; known names survive outages. Signed claims or Auction fan remain the first-use fallback if profile data is unavailable. The real profile-name check passed on the host with the existing synthetic users/room.

Three machine-generated live reports now pass: WP1-CLERK-LIVE for room 139DCB, WP1-CLERK-TWO-USER for room 19B480, and WP1-CLERK-PROFILES using the completed 19B480 fixture. The profile check only projected/read names and submitted no auction actions. Do not repeat setup, ask for keys, request manual room creation or rerun passing helpers without a new reason. The completed auction is intentionally not resumable. The test preview was closed; npm.cmd run dev:clerk can start an interactive preview when needed.

## Next work

0. Phase 0 is reported. Restart approval received; zero tools remain exposed after observed host-server recovery. Approved debug wizard exit 255 is caused by bare codex subprocess resolution, not missing uvx in the prepared child PATH. Existing config stayed unchanged. Await host connection visibility; do not blindly rerun registration, login/install/import or overwrite config. Actual MCP search/skill/STS remains required before service work.
1. Phase 1 is complete for its recorded local scope. TypeScript/build/core164/local76/browser32/axe34 pass. Report and commit this checkpoint. The owner will restart Codex and run /mcp in a fresh session. Phase 2 is next, not started.
2. Phase 2: batch heartbeat persistence, bound history/receipts and snapshot/message sizes, replay retained events and paginate history; add large-history tests.
3. Phase 3 after actual MCP guidance/identity: produce a costed design for $10/month staging/$0 out of pocket; wait for architecture/budget approval before selecting cheaper services. Implement real adapters/recovery/renewals/timers/idempotency/archive/routing, independent ownership review and real failure drills. Complete cloud account/migration/export design; no resource or migration execution is approved by the Phase 0 task.
4. Phase 4: concrete Clerk challenge plan needs approval before users/settings; authorized host CDK probe; guided Windows/Android accessibility. Preserve completed fixtures.
5. Phase 5: CI/boundaries/coverage/dependency resolution, frontend decomposition and operations. Present deployment costs/spending controls and await explicit approval.
6. Phase 6: remaining PWA/content/sound/bots/chat/quick/watchlist/discovery/leaderboard/transfer/moderation features. One phase at a time and exact reports after each.

## Evidence and implementation map

- PROJECT_STATUS.md and docs/plan/tasks/WP1-AWS-MCP-REPAIR.md: current Phase 0 checkpoint/sequence. docs/reports/evidence/WP1-AWS-MCP-REPAIR/: repair/toolkit/config-preservation, 136 core/14 helper evidence and staged secret check. Current WP1-AWS-SETUP status/mcp-check supersede archived before-phase0 records.

- docs/plan/tasks/WP1-OWNERSHIP-CORE.md and docs/reports/evidence/WP1-OWNERSHIP-CORE/: latest 130-core/76-local/typecheck/build evidence and explicit review/wiring limits. apps/realtime/src/ownership.ts, packages/testkit/src/ownership-simulator.ts and tests/core/ownership.test.ts are the new source/test paths. No production code imports testkit or this coordinator yet.
- docs/reports/BUILD-STATUS.md: current bounded verification report.
- docs/plan/tasks/WP1-ACCOUNT-LIFECYCLE.md and docs/reports/evidence/WP1-ACCOUNT-LIFECYCLE/: current 110-core/76-local/28-browser/34-axe validation, raw logs, profile screenshots and review. Changes: shared profile-rules/domain events, engine actor IDs, realtime profile/deletion jobs, API accounts/auth/webhook/socket/worker, AccountSettings.tsx and identity-safe main.tsx requests. tests/core/accounts.test.ts and tests/e2e/accounts.spec.ts cover it.
- docs/plan/tasks/WP1-AUTH-COVERAGE.md and WP1-AUTH-COVERAGE/readiness.json / challenge-preflight.json: safe host inventory and isolated preflight, no actual challenge pass yet. scripts/clerk-auth-readiness.mjs and test-clerk-challenges.mjs are the harnesses.
- docs/plan/tasks/WP1-MANUAL-ACCESSIBILITY.md and docs/MANUAL-ACCESSIBILITY.md: human Windows/Android checklist; no claimed results.
- docs/plan/tasks/WP1-CDK-BUNDLE-FIX.md and scripts/test-cdk-bundle.mjs: isolated unresolved-dependency probe; installation blocked by EACCES, root hashes unchanged. probe.json and preserved attempts record safe diagnostics.
- docs/plan/tasks/WP1-DISTRIBUTED-RUNTIME.md, docs/AWS-TOOLKIT-SETUP.md, scripts/setup-aws.ps1 / aws-mcp-profile.ps1, tests/core/aws-setup-profile.test.ts and WP1-AWS-SETUP/status.json: bootstrap only, host facts and current MCP reconnect requirement. .data/aws-setup/ holds redacted identity/plan evidence and the retrieved skill catalog. No credentials or global config content belongs in evidence.
- docs/plan/tasks/WP1-ACCESSIBILITY.md and docs/reports/evidence/WP1-ACCESSIBILITY/: baseline/final axe reports, composed 24-case validation, corrected keyboard report, 78-test core log, build log, screenshots and explicit manual-review limits. Changes: accessibility.css, auction-announcements.ts, components/AuctionAnnouncements.tsx, main.tsx, BidControl.tsx and AuctionResults.tsx; tests/core/auction-announcements.test.ts, tests/e2e/accessibility.spec.ts and shared helpers.ts. package/lock add axe as a dev dependency; test:a11y runs the focused suite.
- docs/plan/tasks/WP1-DEPENDENCY-HARDENING.md: completed upgrade/verification scope with two moderate entries still open. Evidence in docs/reports/evidence/WP1-DEPENDENCY-HARDENING/: validation.json, fresh dependency-audit.json, before/after versions and lockfile-changes.json, dependency-tree-status.json, core/local logs, one clean browser-results.json, build log, final axe matrices and screenshots. Changes: package.json/package-lock.json, packages/shared/src/index.ts, apps/api/src/app.ts and tests/core/dependency-contracts.test.ts. The fresh raw audit is .data/npm-audit-after.json; the older .data/npm-audit.json is baseline only.
- docs/plan/tasks/WP1-ROOM-RESILIENCE.md and docs/reports/evidence/WP1-ROOM-RESILIENCE/: completed sharing/focus fixes, 20-case full browser report, ten targeted cases, current core/build logs, aggregate validation and reviewed screenshots. Changes are in apps/web/src/main.tsx and tests/e2e/auction.spec.ts. Engine/API and live Clerk fixtures are unchanged.
- docs/plan/tasks/WP1-CLERK-PROFILES.md and docs/reports/evidence/WP1-CLERK-PROFILES/: completed name projection, six-check live pass, host/guest screenshots, projected-room.json reconciliation and local core/browser/preflight evidence. apps/api/src/clerk-profiles.ts / clerk-profile-name.ts, store profile/projectProfile methods, tests/core/clerk-profiles.test.ts, scripts/clerk-profile-flow.ts and test:clerk:profiles are the implementation map.
- docs/plan/tasks/WP1-CLERK-TWO-USER.md and docs/reports/evidence/WP1-CLERK-TWO-USER/: completed task, passing result.json, both results screenshots, independent completed-room.json, archived failed attempt and local regression logs. scripts/clerk-two-user-flow.ts drives the live flow; clerk-two-user-fixture.ts protects reuse. apps/web/src/identity-session.ts owns identity isolation/cache cleanup.
- docs/CLERK-DEVELOPMENT.md: host setup, launcher and live verification.
- docs/plan/tasks/WP1-CLERK-READINESS.md: completed development readiness task. docs/reports/evidence/WP1-CLERK-LIVE/result.json, sign-in.png, test-room.png and automated-room.json: current live pass and bounded database inspection. Earlier cryptographic/regression evidence remains under WP1-CLERK-READINESS/.
- docs/plan/tasks/WP1-AUCTION-COMPLETION.md: completion and disabled-bid implementation contract.
- docs/reports/evidence/WP1-AUCTION-COMPLETION/: current core/local test logs and review.
- docs/reports/evidence/WP1-E2E/results.json: generated counts, timings and errors.
- docs/reports/evidence/WP1-E2E/servers.log: API startup and production build output.
- docs/reports/evidence/WP1-E2E/desktop-results.png and mobile-results.png: rendered results.
- docs/reports/evidence/WP1-E2E/review.md: review, coverage and limits.
- docs/reports/evidence/WP1-ROOM-COMPLETION/: local suite and earlier manual/core evidence.
- docs/plan/tasks/WP1-E2E.md: completed task record.
- apps/web/src/main.tsx; components/RoomMembers.tsx; components/AuctionResults.tsx: UI.
- apps/web/src/room-connection.ts: versioned subscription, polling/reconnect/access loss.
- apps/api/src/{app,index,room-socket}.ts: routes, local server, authorized socket delivery.
- apps/realtime/src/store.ts; packages/engine/src/index.ts: local persistence and auction rules.
- packages/shared/src/; packages/results/src/: contracts, sample players and result derivation.
- infra/ and db/migrations/: undeployed foundation and unexecuted migration.
