# WP-G Workers runtime verification evidence

This is new evidence for the uncommitted working tree based on commit `53967a2`, collected on 14 November 2026 local time. Earlier evidence is unchanged. [load-summary.json](load-summary.json) is the aggregate load gate; the four `load-*.json` files are the raw per-level measurements. [regression.json](regression.json) records the static, unit, browser, accessibility, settlement-integrity and lifecycle results. [tested-source.json](tested-source.json) records SHA-256 hashes of the Package G source and harness files. No commit or deployment was made.

The runtime was local `wrangler dev` (workerd), installed only in `C:\Users\palli\AppData\Local\Temp\opencode\wrangler-runtime`. Each load level used its own fresh `--persist-to` state and its own port. Authentication used a generated RS256 keypair with `CLERK_JWT_KEY`, a local issuer and `azp` matching `ALLOWED_ORIGINS`; no Clerk network call and no Clerk user was created. No private `.data` file and no fixture room was read or written.

## Load

| Users | Rooms | Ping p95 | Action p95 | Broadcast p95 | Broadcasts | Accepted | Conflicts | Settled | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 5 | 18 ms | 129 ms | 128 ms | 900 / 900 | 40 / 40 | 5 | 5 / 5 | PASS |
| 250 | 13 | 270 ms | 634 ms | 545 ms | 2,250 / 2,250 | 104 / 104 | 13 | 13 / 13 | PASS |
| 500 | 25 | 181 ms | 771 ms | 558 ms | 4,500 / 4,500 | 200 / 200 | 25 | 25 / 25 | PASS |
| 1,000 | 50 | 437 ms | 1,317 ms | 1,097 ms | 9,000 / 9,000 | 400 / 400 | 50 | 50 / 50 | PASS |

HTTP, socket and ping errors were zero at every level, no expected broadcast was missing, and every room settled. Action latency is reported but is not one of the stated pass criteria.

## Settlement integrity

`integrity-100.json` through `integrity-1000.json` were produced by reading the persisted room SQLite files after each load run. Every room count matched, every room sold exactly one player, the sale appeared in the buying team's squad at the same price, event and receipt ids were unique, event versions were contiguous, team budgets were conserved, and `currentBid`/`leadingTeamId` were cleared after settlement. All four levels report zero problems. Rooms end in `PAUSED` because the harness closes every socket after settlement; that is the designed host-disconnect pause, not a settlement failure.

## Lifecycle and restart

[lifecycle.json](lifecycle.json) records a real Worker run that created and joined a room, claimed teams, started the auction, accepted a bid, replayed a duplicate idempotently, rejected conflicting content with `ID_REUSED`, resolved simultaneous bids, rejected a stale version, sold one lot, advanced automatically, let a lot go unsold, paused on host disconnect, resumed after host reconnect, ended the auction, retried `end` idempotently, and preserved the sale. [lifecycle-verify.txt](lifecycle-verify.txt) is the raw output. The Worker was then fully stopped and restarted against the same persisted state; [lifecycle-restart.txt](lifecycle-restart.txt) shows `COMPLETED`, the sold price and team, 24 retained history events and four members. The restart added four `disconnected` events and one `connected` event; the auction result was unchanged.

## Regression

- TypeScript `tsc --noEmit`: exit 0.
- Core: 19 files, 259 passed, 0 failed.
- Local: 76 passed, 0 failed, 0 skipped.
- Production build: exit 0, Vite built in 5.95 s, dependency annotation warnings only.
- Browser: 34 passed (desktop and mobile), 0 failed, 0 flaky, 7.4 minutes. [browser-e2e.txt](browser-e2e.txt) is the list output and [browser-results.json](browser-results.json) the structured report.
- Accessibility: 4 passed, 0 failed, 1.1 minutes. Axe 4.14.0 ran 16 recorded screens per viewport (32 scans) with 0 violations and 26 incomplete entries; the keyboard test adds one home-page audit per viewport. Per-scan details are in [a11y/desktop-axe.json](a11y/desktop-axe.json) and [a11y/mobile-axe.json](a11y/mobile-axe.json).

The browser and accessibility suites write into their evidence directory, so this run used `AA_EVIDENCE_DIR` pointing at this folder. Phase 1 evidence under `WP1-E2E` and `WP1-ACCESSIBILITY` was restored to its committed content and is not part of this evidence.

## Post-integration regression

After Package G, the Worker gained `PATCH /api/me`: it validates the shared display-name rules, updates Clerk, fans the new name to existing rooms through an internal Durable Object route, appends `profile_updated` and re-indexes the directory. `internalHeaders` also strips client-supplied `X-Auction-Operation`. The room object updates a member once and does not bump the room version for an unchanged name.

The post-integration run recorded typecheck exit 0, 264 core tests (19 files), 76 local tests, production build exit 0 (Vite 17.93 s), browser 34/34 with 0 failed and 0 flaky in 10.0 minutes, and accessibility 4/4. [browser-results-profile.json](browser-results-profile.json) and [browser-servers-profile.log](browser-servers-profile.log) are the structured result and server log from that run. [regression-profile.txt](regression-profile.txt), [local-profile.txt](local-profile.txt) and [build-profile.txt](build-profile.txt) are the raw command output. [tested-source-profile.json](tested-source-profile.json) records the changed source hashes; the original [tested-source.json](tested-source.json) remains the Package G baseline. The Phase 1 evidence directory was restored from HEAD after the rerun. After that run, only `wrangler.jsonc` (staging environment comment) and `scripts/staging-preflight.mjs` (migration-inheritance check) changed; the application, test and harness hashes are unchanged, so the recorded runtime results still correspond to the tested application code.

## Staging dry-run

`wrangler deploy --dry-run --env staging` first resolved only `ASSETS` and warned that `durable_objects` was absent from `env.staging`. Wrangler does not inherit `durable_objects` or `vars` into named environments, but `migrations` are inherited. `env.staging` now declares `ROOM` and `DIRECTORY` explicitly and uses the top-level `v1`/`v2` migrations; the second dry-run resolves `ROOM`, `DIRECTORY` and `ASSETS` with no R2 binding. [staging-dry-run.txt](staging-dry-run.txt) and [staging-preflight.txt](staging-preflight.txt) were refreshed on 15 November 2026 after the migration-inheritance correction; the config-only preflight passed all 13 checks, while the full preflight failed only on the five absent staging values. The configuration audit and approval request are in [STAGING-DEPLOYMENT-PLAN.md](../../STAGING-DEPLOYMENT-PLAN.md). No deployment or account change was made.

## Limits

- Local workerd on one machine, one colo, local SQLite and localhost latency; this is not a Cloudflare capacity result or a production SLO.
- Real hibernation eviction is not directly observable in `wrangler dev`. Idle-socket wake and attachment survival were checked, and recovery is unit-tested, but a real eviction/wake cycle is unproven.
- `wrangler dev` logs `NOSENTRY SQLite alarm overdue` and `NOSENTRY SQLite alarm handler canceled with requestScheduledAlarm`; alarms still execute, but these are local-runtime warnings.
- Real Clerk latency, token rotation and webhook delivery, Cloudflare placement, multi-colo routing, Durable Object migrations and production alarm scheduling remain unverified.
- The 20-member room cap makes 1,000 users 50 rooms, and the workload is eight bid rounds per room rather than a full auction.
