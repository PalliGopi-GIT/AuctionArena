# WP-G Workers runtime verification and measured load

Scope: run the existing Cloudflare Worker and room Durable Object in the local Workers runtime (`wrangler dev` / workerd), fix what the runtime exposes, remove steady-state HTTP polling now that WebSockets carry every change, measure 100, 250, 500 and 1,000 concurrent users across multiple rooms, and report PASS/FAIL. It does not deploy, create a cloud resource, activate R2, migrate production data or claim Cloudflare or production capacity.

## Environment

- `wrangler` 4.162.0 is installed only in `C:\Users\palli\AppData\Local\Temp\opencode\wrangler-runtime`, so the project dependency tree and lockfile are untouched.
- Each load level starts its own workerd process on a fresh `--persist-to` directory and its own port (8801-8804), then kills it. Levels never share persisted state.
- Local Clerk authentication uses a generated RS256 keypair. `CLERK_JWT_KEY` holds the public key and `CLERK_ISSUER=https://local.auctionarena.test`; tokens carry `azp` matching `ALLOWED_ORIGINS`. No Clerk network call and no Clerk user is created.
- The harness is `scripts/load-worker.mjs`; orchestration is `scripts/run-worker-load.ps1`; the aggregate gate is `scripts/summarize-load.mjs`.
- No private `.data` file and no fixture room is read or written.

## Workload

Each level creates `ceil(users / 20)` rooms because a room admits 20 members. For every room the harness:

- creates the room, joins 19 members with the invite token, claims eight teams and starts the auction;
- opens one hibernating WebSocket per user with a short-lived HMAC ticket;
- sends a 2-second heartbeat per client and a rate-limited `ping` (about 50 per second across all clients) that measures round-trip latency;
- runs eight sequential bid rounds per room. In each round two members bid the same amount from the same version, so exactly one must win and the other must receive `STALE_VERSION`;
- measures how long each accepted version takes to reach all 20 room sockets;
- waits for the lot timer to settle the player and records the settled state, the sold price and the delivery delay after the deadline.

Setup claims and start retry on `STALE_VERSION` after refreshing authoritative state, because a room object can be evicted and recovered while 25-50 rooms are being prepared.

## Pass criteria

A level passes only when every user connects, HTTP errors, socket errors and ping errors are zero, ping p95 is at most 1,000 ms, broadcast delivery p95 is at most 2,000 ms, no expected broadcast is missing, every room settles, and the accepted action count equals `rooms × bid rounds`. These are local measurement gates, not production SLOs.

## Results

| Users | Rooms | Connected | Connect | Ping p95 | Action p95 | Broadcast p95 | Broadcasts | Accepted | Conflicts | Settled | Errors | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 5 | 100 | 0.92 s | 18 ms | 129 ms | 128 ms | 900 / 900 | 40 / 40 | 5 | 5 / 5 | 0 | PASS |
| 250 | 13 | 250 | 5.22 s | 270 ms | 634 ms | 545 ms | 2,250 / 2,250 | 104 / 104 | 13 | 13 / 13 | 0 | PASS |
| 500 | 25 | 500 | 4.38 s | 181 ms | 771 ms | 558 ms | 4,500 / 4,500 | 200 / 200 | 25 | 25 / 25 | 0 | PASS |
| 1,000 | 50 | 1,000 | 9.48 s | 437 ms | 1,317 ms | 1,097 ms | 9,000 / 9,000 | 400 / 400 | 50 | 50 / 50 | 0 | PASS |

Action latency is reported but is not one of the stated pass criteria. Workerd used 9.7, 26.3, 29.4 and 53.1 CPU-seconds for the four levels, with peak working sets of 425, 630, 1,011 and 1,529 MB on a 12-logical-CPU, 16 GB machine. The harness event loop stayed responsive (p95 loop lag 7-10 ms), so the measured latencies are server-side, not client-harness stalls.

## Defects found and fixed

1. **Socket handshake.** The 101 response did not echo `Sec-WebSocket-Protocol: ticket.<...>`, the attachment was serialized after `acceptWebSocket`, and close detection counted sockets that were already closed. All three are fixed.
2. **Directory object on the bid hot path.** `GET /api/rooms/:code` and `/sync` awaited the global directory flush. Bids now enqueue to the durable outbox and return; only `leave`, `remove-member`, `end` and `update-settings` await the flush.
3. **Steady-state polling.** `apps/web/src/room-connection.ts` polled every 2 seconds even while the socket was open. Polling now runs only while the socket is unavailable; the socket carries every state change.
4. **Heartbeat write storm.** Every heartbeat committed a SQLite transaction, read 100 events and rewrote room state. At 250 users that was over 200 transactions per second and produced ping p95 8,049 ms, action p95 12,168 ms and 13 HTTP timeouts. Presence is now in memory; a durable commit happens only on a meaningful state change or after a gap longer than the 10-second presence timeout.
5. **Recovery marked live sockets disconnected.** A wake during load marked every member disconnected, which produced disconnect/reconnect version churn and made setup claims stale. `recoverRoomOnWake` now preserves `connected` for members whose socket survived and pauses only when the host has no surviving socket.
6. **Redundant durable work per request.** `broadcast()` and `scheduleAlarm()` each performed a full SQLite read, and every action re-armed the same alarm instant twice. The just-written room is now reused for broadcast and alarm scheduling, and an unchanged alarm instant is not written again. At 500 users this cut workerd CPU from 52.8 to 29.9 CPU-seconds and ping p95 from 1,192 to 181-297 ms.
7. **Reconnect ignored the browser coming back online.** Backoff could wait 8 seconds, and a socket that was open when the network dropped could look alive until the 10-second pong timeout. The client now listens for `online`, forces a fresh ticket and socket, resets backoff, and uses a generation counter so a late ticket response cannot install a stale socket. This fixed the two browser tests that failed after an offline/online cycle.

## Settlement integrity

After each load level the persisted room SQLite files were read directly (`check-integrity.mjs`). At 5, 13, 25 and 50 rooms respectively, every room sold exactly one player, the sale was present in the buying team's squad at the same price, event and receipt ids were unique, event versions were contiguous, team budgets were conserved, and `currentBid`/`leadingTeamId` were cleared. Zero problems were found. Rooms are `PAUSED` after the run because the harness closes every socket, which is the designed host-disconnect pause.

## Regression

- TypeScript `tsc --noEmit`: exit 0.
- Core: 19 files, 259 passed, 0 failed.
- Local: 76 passed, 0 failed, 0 skipped.
- Production build: exit 0; Vite built in 5.95 s with dependency annotation warnings only.
- Browser: 34 passed (desktop and mobile), 0 failed, 0 flaky, 7.4 minutes.
- Accessibility: 4 passed, 0 failed; axe 4.14.0 ran 16 recorded screens per viewport with 0 violations and 26 incomplete entries. The keyboard test adds one home-page audit per viewport.

The browser and accessibility suites normally write into Phase 1 evidence folders; this run used `AA_EVIDENCE_DIR` so the new results stayed under `docs/reports/evidence/WP-G-WORKERS-RUNTIME/`. Phase 1 evidence was restored to its committed content.

## Post-integration fixes

The profile update was the remaining frontend/backend integration gap. The Worker now exposes `PATCH /api/me`, validates the shared display-name rules, updates Clerk through the Backend API, fans the new name to the user's existing rooms through an internal Durable Object route, appends `profile_updated` and re-indexes the directory. The room object updates a member once and does not bump the room version when the name is unchanged. `internalHeaders` strips client-supplied `X-Auction-Operation`, so a browser cannot select the internal profile or delete operation.

Post-integration regression: TypeScript exit 0, 264 core tests (19 files), 76 local tests, production build exit 0 (Vite 17.93 s), browser 34/34 with 0 failed and 0 flaky in 10.0 minutes, accessibility 4/4. The rerun's structured result and server log are preserved as `browser-results-profile.json` and `browser-servers-profile.log`; `tested-source-profile.json` records the changed source hashes. The original `regression.json` and `tested-source.json` remain the Package G baseline.

## Staging configuration finding

`wrangler deploy --dry-run --env staging` first resolved only `ASSETS` and warned that `durable_objects` was not present on `env.staging`. Wrangler does not inherit `durable_objects` or `vars` into named environments, but `migrations` are inherited. `env.staging` now declares `ROOM` and `DIRECTORY` explicitly and uses the top-level `v1`/`v2` migrations; a second dry-run resolves `ROOM`, `DIRECTORY` and `ASSETS`, with no R2 binding. `scripts/staging-preflight.mjs` is a read-only gate for the Worker name, bindings, migrations, missing/placeholder values and secret patterns in `dist`. The full audit, expected costs, permissions and approval request are in [STAGING-DEPLOYMENT-PLAN.md](../../reports/STAGING-DEPLOYMENT-PLAN.md).

Staging was subsequently deployed on 15 November 2026: version `cc191a81-279a-4d85-bf4e-28145a002d16` at 100% on https://auctionarena-staging.palligopi1924.workers.dev with 8 bindings, both SQLite namespaces and no extra resource. Production `auctionarena` does not exist. Verification covered health/config, CORS, 401s, the served bundle, room create/refresh/reconnect and a two-user live bid; two client defects (room listings without `members` crashing the room list, and a socket URL missing `?room=`) were found and fixed. See [the staging record](../../reports/evidence/STAGING-DEPLOYMENT/README.md).


## Correctness checks in workerd

The lifecycle script (`verify.mjs` in the temporary runtime directory) drives the real Worker: create, join, claim, start, simultaneous bids, duplicate idempotent retry, conflicting-content `ID_REUSED`, sold and unsold settlement, auto-advance, host disconnect pause, reconnect/resume, end idempotency and preserved sale. Persistence across a full wrangler/workerd restart was confirmed for a completed room: status `COMPLETED`, the sold player's price and team, unsold players and history all survived. The re-run against the final code sold a player for 110 to team `t2`, ended at version 19, and after a full stop and restart still reported `COMPLETED`, the same sale and 24 history events; recovery appended four `disconnected` and one `connected` presence events (version 24) without changing the result.

## Evidence

[docs/reports/evidence/WP-G-WORKERS-RUNTIME](../../reports/evidence/WP-G-WORKERS-RUNTIME/README.md) contains the four load files, the aggregate summary, settlement integrity per level, lifecycle and restart output, the regression summary, the browser and accessibility logs and the SHA-256 hashes of the tested source files.

## Limits

- This is the local workerd runtime, not Cloudflare. It runs on one machine with local SQLite, one colo and no real network latency, so the numbers describe this machine and workload only.
- Actual hibernation eviction is not directly observable in `wrangler dev`. An idle socket answered a ping after 35 seconds and its attachment survived, and the recovery path is unit-tested, but a real eviction/wake cycle is not proven.
- Real Clerk latency, Cloudflare placement, multi-colo routing and production alarm scheduling remain unverified. Durable Object migration application is now confirmed on staging, but real hibernation eviction/wake and alarm delivery under Cloudflare scheduling are not.
- `wrangler dev` logs `NOSENTRY SQLite alarm overdue` and `NOSENTRY SQLite alarm handler canceled with requestScheduledAlarm`; alarms still execute, but these are local-runtime warnings.
- The 20-member room cap makes 1,000 users 50 rooms. The workload is eight bid rounds per room, not sustained bidding for a full auction.

## Next gate

Deployment and cloud verification are not authorized. The staging configuration audit and approval request are in [STAGING-DEPLOYMENT-PLAN.md](../../reports/STAGING-DEPLOYMENT-PLAN.md). The next step is the owner's explicit approval, the exact staging origin, a plan choice, Clerk issuer/JWT key through a secure channel, and Cloudflare authentication or a scoped token.
