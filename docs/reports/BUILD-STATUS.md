# AuctionArena verification status

The strict performance investigation verified 100 rooms on one local runtime and 200 rooms on two independent runtimes, each with ten connected users. The 300-room attempt stopped at the 1,536 MiB free-memory guard before its auction window. The SQLite transaction change passed TypeScript, 112 relevant core cases, 78 local cases, three acceptance-verdict cases and two desktop/mobile sale and reconnect cases. The core fixtures ran all Quick 80, Standard 120 and Mega 250 initial lots and their recall rounds. [Strict local measurements and limits](500-ROOM-LOCAL-PERFORMANCE.md)

The local auction experience report records the latest catalog image, recall and final results verification. The WP-H and load sections below record their original checkpoints. [Local auction experience and verification](AUCTION-EXPERIENCE.md)

Current checkpoint, 21 November 2026: B-G, WP-H and the desktop/mobile UI/UX redesign are implemented in the working tree above `53967a2`; the latest local workerd load closeout and the redesign verification are recorded below. Earlier sections retain their package-time results and limitations. Local Workers runtime coverage in G and the latest load runs supersedes the earlier offline-tool limitation. Staging exists according to saved evidence; production is undeployed and unauthorized. This recovery audited saved evidence and changed documentation only; it did not rerun application checks or load tests.

Phase 2 local hardening passed on 13 November 2026 against the uncommitted working tree based on 9040a38. Evidence: [validation](evidence/WP2-LOCAL-BOUNDS/validation.json), [tested source hashes](evidence/WP2-LOCAL-BOUNDS/tested-source.json), and [scope/limits](../plan/tasks/WP2-LOCAL-BOUNDS.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS; dependency annotation warnings only |
| Core | 174 passed, 0 failed, 0 skipped |
| Local | 76 passed, 0 failed, 0 skipped |
| Chromium desktop/mobile viewport browser suite | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Separate accessibility suite | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | Full browser run: 34 scans, 0 violations; separate accessibility run: 32 scans, 0 violations |

The full browser run has 28 incomplete rule entries and the separate accessibility run has 26; they need human assessment and are not violations or a conformance claim. Testing used an isolated copy with temporary development identities/data and no private environment file. All 12 changed application/test source files matched that copy by SHA-256. Existing fixture and evidence folders were preserved. No deployment, provider setting, new Clerk account or cloud resource was created. Phase 2 was subsequently saved in `53967a2`; later work includes uncommitted changes.

Package B storage ports passed on 13 November 2026 against the uncommitted working tree based on 53967a2. Evidence: [validation](evidence/WP-B-STORAGE-PORTS/validation.json), [tested source hashes](evidence/WP-B-STORAGE-PORTS/tested-source.json), and [scope/limits](../plan/tasks/WP-B-STORAGE-PORTS.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Core | 199 passed, 0 failed, 0 skipped (36 suites) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser suite | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Separate accessibility suite | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | Browser: 34 scans, 0 violations; accessibility: 32 scans, 0 violations |

The 25-test storage file proves rollback, idempotent retry, receipt eviction, version/identity guards, wake recovery and SQLite/file-store parity. It does not prove Cloudflare `transactionSync`, alarm retry, hibernation, cross-room queries or capacity. `wrangler` and Miniflare were unavailable offline.

Package C Worker entry passed on 13 November 2026 against the same uncommitted working tree. Evidence: [validation](evidence/WP-C-WORKERS-ENTRY/validation.json), [tested source hashes](evidence/WP-C-WORKERS-ENTRY/tested-source.json), and [scope/limits](../plan/tasks/WP-C-WORKERS-ENTRY.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Core | 214 passed, 0 failed, 0 skipped (38 suites) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser regression | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Accessibility regression | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | Browser: 34 scans, 0 violations; accessibility: 32 scans, 0 violations |

The 15 Worker-entry tests cover Clerk-shaped JWT verification with an ephemeral key, Hono routing, private-room equivalence, deterministic `idFromName` forwarding, header stripping, creation retry, HMAC socket tickets, CORS, body limits and per-isolate rate limiting. They run in-process, not in the Workers runtime. Browser and accessibility runs exercise the unchanged local Node runtime, not the Worker.

`wrangler` and Miniflare were unavailable offline, so binding, bundling, WebSocket upgrade and Durable Object behavior remain unverified. The Worker entry, structural bindings and socket ticket flow are implemented under `apps/api/src/worker/`; the room object, hibernation and alarms are implemented and locally tested with a fake object state in Package D, but actual Workers execution remains unverified.

Package D room Durable Object passed on 13 November 2026 against the same uncommitted working tree. Evidence: [validation](evidence/WP-D-ROOM-DURABLE-OBJECT/validation.json), [tested source hashes](evidence/WP-D-ROOM-DURABLE-OBJECT/tested-source.json), and [scope/limits](../plan/tasks/WP-D-ROOM-DURABLE-OBJECT.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Core | 230 passed, 0 failed, 0 skipped (40 suites) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser regression | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Accessibility regression | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | Browser: 34 scans, 0 violations; accessibility: 32 scans, 0 violations |

The 16 room-object tests cover one room per object, SQLite-backed transactional settlement, action and alarm idempotency across a new object instance, host-absence pause/resume, wake recovery, hibernating socket acceptance/broadcast/disconnect, invite hashing, private errors and history/replay bounds. They use `node:sqlite`, fake alarms and socket doubles, not the Workers runtime. `wrangler` and Miniflare were unavailable offline, so the actual binding, hibernation, alarm delivery and 101 upgrade remain unverified. Cross-room work was Package E (now complete) and measured load was Package F (now complete).

Package E cross-room directory passed on 13 November 2026 against the same uncommitted working tree. Evidence: [validation](evidence/WP-E-CROSS-ROOM-DIRECTORY/validation.json), [tested source hashes](evidence/WP-E-CROSS-ROOM-DIRECTORY/tested-source.json), and [scope/limits](../plan/tasks/WP-E-CROSS-ROOM-DIRECTORY.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Core | 259 passed, 0 failed, 0 skipped (19 test files) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser regression | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Accessibility regression | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | Browser: 34 scans, 0 violations; accessibility: 32 scans, 0 violations |

The 29 new cross-room tests cover a global SQLite directory projection, version-guarded and idempotent room upserts, blocked-member exclusion, immutable privacy-minimised archives, caller-only export, immediate and idempotent account deletion, resistance to delayed snapshots, deletion discovery through former participants, sole-member room removal, the directory object's internal routes, the room outbox's coalescing/retry/permanent-error behavior, user anonymization and Worker `/api/me` plus deletion preconditions and failure recovery. They use in-process fakes and `node:sqlite`, not the Workers runtime. The directory is a single eventually consistent object; outbox delivery, global throughput and the `ROOM`/`DIRECTORY` bindings remain unverified in the Workers runtime.

Package F measured local load was collected on 14 November 2026 in an isolated copy. Evidence: [validation](evidence/WP-F-MEASURED-LOAD/validation.json), [summary](evidence/WP-F-MEASURED-LOAD/summary.json), [tested source hashes](evidence/WP-F-MEASURED-LOAD/tested-source.json), and [scope/limits](../plan/tasks/WP-F-MEASURED-LOAD.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Core | 259 passed, 0 failed, 0 skipped (19 test files) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser regression | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Accessibility regression | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | Browser: 34 scans, 0 violations; accessibility: 32 scans, 0 violations |
| Load, 100 users / 5 rooms | PASS: 100 connected, 0 errors, ping p95 8.31 ms, poll p95 24.30 ms, 5/5 broadcasts, delivery p95 131.25 ms |
| Load, 500 users / 25 rooms | FAIL: 500 connected, 1,093 errors, ping p95 9,576.39 ms, poll p95 18,004.65 ms, 7/25 broadcasts, delivery p95 9,347.08 ms |
| Load, 1,000 users / 50 rooms | FAIL: 1,000 connected, 2,917 errors, ping p95 14,780.25 ms, poll p95 8,975.05 ms, 0/50 broadcasts |
| 500-user ping-only diagnostic | FAIL: ping p95 14,168.41 ms, 155 ping errors, 25/25 broadcasts but delivery p95 25,992.31 ms |

The 100-user level passed the local criteria; 500 and 1,000 failed. A 500-user probe with a 60-second poll interval still failed, so the limit is not only the 2-second poll rate. The intended 10-second window stretched to 40.1 s at 500 and 32.2 s at 1,000, itself a symptom of contention. The load harness runs the single-process local Node runtime with file-backed JSON state on the same machine as its clients; it does not exercise Workers, Durable Objects, SQLite-backed object storage, hibernation, alarms or Cloudflare placement. The 100-user pass is not a capacity guarantee, and no 500-user or 1,000-user capacity and no Cloudflare capacity is claimed. The browser and accessibility runs exercise the unchanged local Node runtime. All six Package F source/test hashes matched the repository working tree.

Package G Workers runtime verification and measured load passed on 14 November 2026 against the same uncommitted working tree. Evidence: [load summary](evidence/WP-G-WORKERS-RUNTIME/load-summary.json), [regression summary](evidence/WP-G-WORKERS-RUNTIME/regression.json), [lifecycle](evidence/WP-G-WORKERS-RUNTIME/lifecycle.json), [tested source hashes](evidence/WP-G-WORKERS-RUNTIME/tested-source.json), and [scope/limits](../plan/tasks/WP-G-WORKERS-RUNTIME.md).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS; Vite 5.95 s, dependency annotation warnings only |
| Core | 259 passed, 0 failed, 0 skipped (19 test files) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser regression | 34 passed, 0 failed, 0 skipped, 0 flaky |
| Accessibility regression | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | 32 recorded scans, 0 violations, 26 incomplete; keyboard test adds 2 home audits |
| Load, 100 users / 5 rooms | PASS: 0 errors, ping p95 18 ms, broadcast p95 128 ms, 900/900 deliveries, 40/40 actions, 5/5 settled |
| Load, 250 users / 13 rooms | PASS: 0 errors, ping p95 270 ms, broadcast p95 545 ms, 2,250/2,250 deliveries, 104/104 actions, 13/13 settled |
| Load, 500 users / 25 rooms | PASS: 0 errors, ping p95 181 ms, broadcast p95 558 ms, 4,500/4,500 deliveries, 200/200 actions, 25/25 settled |
| Load, 1,000 users / 50 rooms | PASS: 0 errors, ping p95 437 ms, broadcast p95 1,097 ms, 9,000/9,000 deliveries, 400/400 actions, 50/50 settled |
| Settlement integrity | PASS at all four levels: one sale per room, unique ids, contiguous versions, conserved budgets |
| Lifecycle in workerd | PASS: simultaneous bids, idempotent retry, `ID_REUSED`, sold/unsold, host pause/resume, end idempotency |
| Restart persistence | PASS: completed room retained status, sale price/team and 24 history events after a full worker restart |

This is the real Worker and room Durable Object running in local `wrangler dev` / workerd with SQLite-backed state, hibernating WebSockets and alarms, not the local Node runtime. It fixed the socket handshake, removed the directory object from bid hot paths, removed steady-state polling, replaced per-heartbeat durable writes with in-memory presence, preserved live sockets during recovery, reused transaction state for broadcast/alarm scheduling, and forced a fresh socket when the browser comes back online. Workerd used 9.7, 26.3, 29.4 and 53.1 CPU-seconds with peak working sets of 425, 630, 1,011 and 1,529 MB on a 12-logical-CPU, 16 GB machine. These are local measurements: actual hibernation eviction is not observable in `wrangler dev`, the runtime logs `NOSENTRY SQLite alarm overdue` warnings while alarms still execute, and real Clerk latency, Cloudflare placement, multi-colo routing, object migrations and production alarm scheduling remain unverified. No Cloudflare capacity or production SLO is claimed.

## Integration fixes and staging preparation (14 November 2026)

The remaining frontend/backend integration gap was the profile update. The Worker now accepts `PATCH /api/me`, validates the shared display-name rules, updates Clerk through the Backend API, fans the new name to the user's existing rooms through an internal Durable Object route, appends `profile_updated`, and re-indexes the directory. Client-supplied `X-Auction-Operation` is stripped by `internalHeaders`, so a browser cannot select an internal room operation. The room object updates a member once, does not bump the room version for an unchanged name, and reports a missing member without failing the provider update.

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS; Vite 17.93 s, dependency annotation warnings only |
| Core | 264 passed, 0 failed, 0 skipped (19 test files) |
| Local | 76 passed, 0 failed, 0 skipped |
| Browser regression after the integration changes | 34 passed, 0 failed, 0 skipped, 0 flaky, 10.0 minutes |
| Accessibility | 4 passed, 0 failed, 0 skipped, 0 flaky; axe unchanged at 32 scans, 0 violations, 26 incomplete |
| Staging config dry-run | PASS: `ROOM`, `DIRECTORY`, `ASSETS`; no R2 binding |
| Staging preflight | PASS in config-only mode; fails closed on missing/placeholder values and secret patterns in `dist` |

The browser rerun wrote into the Phase 1 evidence directory because `AA_EVIDENCE_DIR` was not set. Its structured result and server log were copied to [browser-results-profile.json](evidence/WP-G-WORKERS-RUNTIME/browser-results-profile.json) and [browser-servers-profile.log](evidence/WP-G-WORKERS-RUNTIME/browser-servers-profile.log), and the Phase 1 directory was restored from HEAD. The post-integration source hashes are recorded in [tested-source-profile.json](evidence/WP-G-WORKERS-RUNTIME/tested-source-profile.json); the original [tested-source.json](evidence/WP-G-WORKERS-RUNTIME/tested-source.json) remains the Package G baseline.

Wrangler's first staging dry-run exposed a real gap: `durable_objects` and `vars` are not inherited by named environments, so staging initially resolved only `ASSETS`. `env.staging` now declares the two object bindings explicitly and inherits both SQLite migration tags from the top level. The configuration audit, permissions, expected costs and rollback are in [STAGING-DEPLOYMENT-PLAN.md](STAGING-DEPLOYMENT-PLAN.md). The staging Worker is now deployed and audited: version `cc191a81-279a-4d85-bf4e-28145a002d16` at 100% on https://auctionarena-staging.palligopi1924.workers.dev with 8 bindings; production `auctionarena` does not exist. See [the staging record](evidence/STAGING-DEPLOYMENT/README.md).


Phase 1 local correctness evidence: [validation](evidence/WP1-RULE-FIXES/validation.json). The recorded run passed TypeScript, production frontend build, 164 core tests, 76 local tests and 32 Chromium desktop/mobile-viewport browser cases, with 34 axe scans reporting zero violations. This is local evidence, not a cloud runtime, human accessibility, production readiness or capacity claim.

The Cloudflare target now has a staging deployment: the Worker, both SQLite Durable Object namespaces, migrations, Clerk sign-in, CORS and realtime bidding were exercised on Cloudflare, while hibernation eviction, alarm delivery, placement, a production Clerk instance and capacity remain unverified. Clerk live challenge/deletion/webhook flows, human accessibility, directory projection retention and distributed recovery remain open; local load limits are recorded in Package F and local workerd measurements in Package G. Local hardening is implemented within the bounds and legacy exceptions documented in WP2. Preserve existing fixture and evidence records. Detailed earlier verification status is archived at ../archive/aws-v2/docs/reports/BUILD-STATUS.md.

## WP-H player catalog and auction plans (19 November 2026)

WP-H passed local verification against the uncommitted working tree based on `53967a2`. Evidence: [report](../plan/tasks/WP-H-REPORT.md), [decisions](../plan/tasks/WP-H-DECISIONS.md), and [WP-H-PLAYER-POOLS](evidence/WP-H-PLAYER-POOLS/).

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS, 501.84 kB JS / 47.78 kB CSS; chunk-size warning only |
| Core | 307 passed, 0 failed, 0 skipped (22 test files) |
| Local | 78 passed, 0 failed, 0 skipped |
| Browser desktop | 23 passed, 0 failed, 0 skipped, 0 flaky |
| Browser mobile viewport | 23 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | 16 scans per viewport, 0 violations; incomplete entries need human review |
| Load smoke | 20 users / 1 room, 0 errors, ping p95 1.78 ms, state p95 25.27 ms, broadcast p95 39.62 ms |
| Catalog | 250 players, `real-v1-3fb107eb`; Quick 80 / Standard 120 / Mega 250, 0 quota adjustments |
| Assets | 224 bundled WebP (10.47 MB), 21 unconverted placeholders, 5 missing, 0 ambiguous, 0 matched logos |

The new planner and room-plan tests cover all three modes, seeded determinism, quotas, role balance, the opening marquee, set sizes, marquee spread, the three-role-run cap, tier spreading, approval immutability, draft/approved CSV, host-only export, order-blind snapshots and a 250-player snapshot under the 128 KB budget. The browser flow covers host auto-preview, mode switching, regeneration, draft and approved CSV, approve-and-start, participant privacy, photos/crests, the live order in the opening set, reload immutability and a full Mega opening set. The local restart test covers persistence, live immutability and stale-preview rejection.

At the original WP-H checkpoint, not verified: the WP-H plan path in local `wrangler dev`/workerd (the earlier Package G runtime result did not include these endpoints; the later Quick 80 correctness run below adds limited coverage); a 100/250/1,000-user load rerun with planned pools (the saved 20-user smoke is not a capacity result); a completed catalog-auction results page; and unsold recall, which did not exist at that WP-H checkpoint (a host-controlled recall round was added afterwards and is present in the current engine). The live browser flow fully exercised Standard and Mega; Quick was previewed and regenerated but not approved/started for a full set. The 307 core-test result is recorded from the final run but was not saved as a separate WP-H artifact. Photo licenses are unrecorded because no manifest was supplied; 21 supplied files are SVG placeholders and 5 photos are missing, so those players use initials avatars. No team logo matched the fictional team identities, so all crests are generated. Against the prompt's definition of done, the MUST tier and implemented SHOULD scope are met, but the literal Phase 6 checklist is not fully complete for the reasons above. This is local evidence only; no Cloudflare, production, capacity or WCAG-conformance claim is made.


## Latest local load test and recovery closeout (19 November 2026)

OpenCode's independent load run used the real Worker, room Durable Object, SQLite and WebSocket path in local `wrangler dev`/workerd. It used fresh isolated state per level, Node WebSocket clients, 20 members maximum per room, a 40-second steady window and the legacy 24-player sample pool. Eight main bids and one accepted race winner per room preceded the first settlement. [Full report](AUCTIONARENA-LOAD-TEST.md), [summary](evidence/AUCTIONARENA-LOAD-TEST/load-summary.json), [manifest](evidence/AUCTIONARENA-LOAD-TEST/run-manifest.json) and [hashes](evidence/AUCTIONARENA-LOAD-TEST/SHA256SUMS.txt).

| Users / rooms | Result | Bid-ack p95 | Broadcast p95 | Main bids | Expected race conflicts | Peak workerd working set |
| --- | --- | --- | --- | --- | --- | --- |
| 100 / 5 | PASS | 133 ms | 134 ms | 40/40 | 5 | 418 MiB |
| 250 / 13 | PASS | 262 ms | 221 ms | 104/104 | 13 | 646 MiB |
| 500 / 25 | PASS | 565 ms | 430 ms | 200/200 | 25 | 991 MiB |
| 1,000 / 50 | PASS | 1,549 ms | 1,215 ms | 400/400 | 50 | 1,548 MiB |

All clients connected; all expected broadcasts arrived and every room settled. There were zero HTTP 5xx/network failures, socket errors, early closes, missing broadcasts or persisted-integrity problems. Expected `STALE_VERSION` race losers and five claim retries at 1,000 users are not failures. Broadcast p95 pools individual member deliveries, not each action's slowest recipient. JSON memory fields retain their `Mb` names but the conversion is MiB.

The highest tested zero-error local level is 1,000 users across 50 rooms. The highest tested sub-second bid-ack p95 is 500 across 25. These are short local workerd measurements, not production capacity, a soak test or support for 1,000 users in one room. The 20-member cap is unchanged.

The separate 20-user Quick 80 correctness scenario passed plan approval, two sold lots, a host-ended third unsold lot, 20-client convergence, duplicate/reused receipt handling, unauthorized bidding rejection, bid races and two non-host reconnects. A 21st join returned 404 `ROOM_NOT_FOUND`. Persisted budget, sale, order and receipt integrity passed. Bid-ack p95 was 71 ms and broadcast p95 46.13 ms. This adds limited WP-H coverage in real local workerd; Quick's complete browser opening set, completed catalog results, full planned-pool multi-room load and WP-H production-runtime coverage remain open. Unsold recall is absent; the separate WP-H 307-core-test artifact is still missing.

| Recovery verification | Result |
| --- | --- |
| Evidence checksums | PASS, 15/15; every saved JSON is listed |
| Manifest versus raw results/integrity | PASS, including the separate 20-user run |
| Summary regeneration | PASS in a private temporary copy; only `generatedAt` differs |
| Test/server cleanup | PASS, no relevant process or checked development/load listener remains |
| Protected data and assets | PASS, 59 existing `.data/` files and 255 `Assets/` files unchanged; fixtures 139DCB/19B480 present |
| Evidence/private environment preservation | PASS, unchanged against the pre-edit recovery baseline |
| Git hygiene | PASS, `git diff --check`; index and HEAD unchanged; nothing staged, committed or pushed by recovery |
| Fresh application/load reruns | Not run; this closeout changed only documentation and validated existing evidence |

The recommended next package is bid-path instrumentation, subject to the owner's next instruction. Full-snapshot fan-out, storage and Directory contention are candidates, not established causes. Pending Directory projections already coalesce and successful bids do not await their delivery. Instrument before deciding on compact deltas or further batching. No optimization, deployment, staging change, new account or cost was introduced during closeout.

Historical Cloudflare documentation-transition check: an isolated copy of committed 9040a38 source passed typecheck, build, 164 core tests, 76 local tests, 32 browser cases and the separate 4-case accessibility suite, with zero failures or skipped cases. The full browser run recorded 34 axe scans and zero violations; incomplete checks require human assessment. The build emitted dependency annotation warnings. Details and temporary output locations are in [the transition audit](../architecture/CLOUDFLARE-AUDIT.md). No deployment or account mutation is authorized.

## UI/UX redesign verification (21 November 2026)

The desktop/mobile redesign is complete in the uncommitted working tree above `53967a2`. It preserves the server-authoritative engine, auction rules, Clerk/local identity paths, WebSocket transport, existing selectors and all room, plan, history, deletion and results behavior. Shared tokens, live-desk reflow, player cards and lobby styles are in `apps/web/src/arena-design.css`; behavior remains in `apps/web/src/main.tsx`.

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS; dependency annotation and chunk-size warnings only |
| Core | 313 passed, 0 failed, 0 skipped (22 files) |
| Local | 78 passed, 0 failed, 0 skipped |
| Browser desktop | 26 passed, 0 failed, 0 skipped, 0 flaky |
| Browser mobile viewport | 26 passed, 0 failed, 0 skipped, 0 flaky |
| Responsive reflow | 2 passed at 320, 360, 375, 390, 430, 768, 1024, 1280, 1440 and 1680 px |
| Accessibility suite | 4 passed, 0 failed, 0 skipped, 0 flaky |
| Axe | 32 scans (16 per viewport), 0 violations; incomplete entries need human review |

Inspected captures cover landing, local sign-in, create/review, lobby host/ready, live auction at 320/390/1440, squads, players, members, history, results and the end-auction dialog. The mobile live desk keeps the lot heading, countdown, price and the single bid action on the first screen; desktop adds next-valid-bid and purse-after-bid context. Player cards reflow to five desktop columns, two at 390 px and one at 380 px and below. The lobby exposes the room code, invitation link and an explicit note that starting approves the current plan. Stale capacity/sample-pool text and mojibake separators were corrected, and toasts are suppressed while a modal is open.

Limits: the axe incomplete entries require human assessment; no WCAG conformance claim is made. No load or capacity test was rerun, so the 3,000-user local aggregate and production capacity statements are unchanged. Clerk production challenges/webhooks, Cloudflare hibernation/alarm delivery, multi-colo latency and production deployment remain unverified. The redesign is not committed, pushed or deployed.

## Production-release verification (23 November 2026)

This pass completed the production-release engineering mission on the existing uncommitted tree above `53967a2`. It did not rebuild the app: the mode system, plan relocation, Upcoming Players, invite bar, delete-auction flow and Auction Experience section were already present from earlier work. The mission's remaining correctness gap was Quick's nationality composition, which was enforced only as an overseas maximum.

Domain changes:

- `packages/shared/src/domain.ts`: `AuctionModeRules` gains `minOverseas`; Quick is `minOverseas: 2` (exactly two), Standard/Mega are `0`. Added `modeNationalityLabel` so forms render "Exactly 3 Indian · exactly 2 overseas" for Quick and "At least 7 Indian · max 4 overseas" otherwise.
- `packages/shared/src/bid-rules.ts`: `purchaseRestriction` now checks composition for mode rooms — it refuses a purchase that would exceed the overseas maximum, and refuses one that leaves too few remaining slots to reach the required overseas/Indian counts. Legacy rooms without a mode keep only the overseas cap. This runs in the same shared function the server uses for bid validation and the engine uses for recall eligibility.

Retired superseded feature (whole-room deletion replaced per-entry deletion):

- Removed `packages/shared/src/history-deletion.ts` and its export.
- Removed the local `DELETE /api/rooms/:code/history/:eventId` route and `LocalRoomStore.deleteHistory`.
- Removed the Worker route and `RoomDurableObject.handleDeleteHistory`, plus the retired error-code mappings.
- Removed the per-entry case from `RoomHistory.tsx` (UI was already gone) and deleted `tests/core/history-deletion.test.ts` and `tests/e2e/history-deletion.spec.ts`, plus the three obsolete Durable Object history-deletion cases.
- Room deletion, event replay and history paging are untouched.

Auction Plan, How It Works and navigation:

- Removed the "Export order" button and its `exportPlan` handler from the room toolbar. The host-only `GET /api/rooms/:code/plan/export` endpoint remains for programmatic use; the plan spec now asserts the endpoint directly and asserts the button is gone.
- Deleted the obsolete `how-it-works.spec.ts` and its successor `auction-experience.spec.ts`. Both navigation items ("How It Works" and then "Auction Experience") have since been removed from the desktop and mobile nav, so there is no navigation destination left to test; the in-page explanation section remains and is still asserted by `overview.spec.ts`.
- Overview structural assertions updated from `article` to the new `button.format-card` mode cards.

Test-helper correction: the create form no longer has editable purse/squad/overseas/timer fields (they are fixed by mode), so `tests/e2e/helpers.ts` `create()` now selects the mode and only sets team count and lobby options. This was a stale test assumption, not an app regression.

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS; dependency annotation and chunk-size warnings only |
| Core | 334 passed, 0 failed (24 files; adds `tests/core/auction-modes.test.ts`, 15 cases) |
| Local | 78 passed, 0 failed, 0 skipped |
| Auction Experience navigation spec | Removed with the nav item; the in-page section is asserted by `overview.spec.ts` |
| Plan browser spec | 8 passed, 0 failed (desktop + mobile): photo decode/fallback, approved-order opening set, order-blind participants, Mega 250 |
| Overview browser spec | Passes after baseline refresh; baselines changed only for the approved mode-card metadata, the renamed Auction Experience section and the relocated Auction Plan |
| Plan + accessibility specs | Re-run after the CSV and create-helper changes (see the recorded run) |

Plan-spec root cause and fix: the join form now takes one "Room code or invitation link" field, so the guest helper must fill the full link rather than the bare token; the plan flow also moved from the lobby to Overview (the host's waiting room is auto-selected), the mode is fixed at creation (the panel shows a locked `.plan-mode-fixed` label instead of mode buttons), and the removed Export order/Download CSV buttons are now asserted absent while the host-only CSV endpoint is checked directly. The photo-fallback case uses a fresh browser context so the aborted request is not served from the cache warmed by the decode loop.

Mode verification highlights (`tests/core/auction-modes.test.ts`): the rule table matches the approval exactly; presets and settings validation reject any deviation; Quick refuses a third overseas and refuses to fill before its two overseas are signed; Standard caps overseas at four; an eleven-player squad minus a four-overseas cap always leaves seven Indians; a team may bid while incomplete but never past squad size; the budget reserve still blocks over-commitment; the server rejects a crafted invalid bid; and pre-start feasibility blocks an under-sized pool and a pool lacking enough Indians.

Limits: these are local `node:sqlite` and local-runtime results. Cloudflare hibernation eviction, real alarm delivery, multi-colo latency and production capacity remain unverified. Unsold recall is unchanged (existing behavior, not automatic). Google OAuth completion still requires a real account.

## Functional regression audit: Clerk sign-in and How It Works (23 November 2026)

A manual check reported that real Clerk sign-in and Google were gone and that How It Works returned to the landing page. Both reproduced as real defects, with distinct root causes; neither was visible to the previous automated suites because those suites only ever exercised the local-auth bundle.

Root causes:

- **Sign-in.** The normal command `npm run dev` started only Vite (`vite --host 127.0.0.1`) with no API, so `/api/config` was unreachable and the app fell back to the local-identity UI. The README's primary command was `dev:local`, which deliberately clears the Clerk keys, and a previously built `dist/` has no Clerk key either. The Clerk UI itself was intact: with the real keys loaded, the app renders Clerk's own "Sign in to AuctionArena" panel including **Continue with Google**, and the Google button performs a genuine Clerk→Google OAuth redirect.
- **How It Works.** Clicking the link always worked. A fresh load of `/#how` (deep link or refresh) did not scroll, because the browser resolves the fragment before React renders `#how`, and the effect that handled the section was gated on an explicit click (`if(!howRequest)return`).

Fixes (minimal, UI unchanged):

- `package.json`: `dev` now runs the Clerk launcher (`scripts/dev-clerk.mjs`); the old Vite-only entry is retained as `dev:vite`. `dev:local` stays the explicit local/test mode.
- `apps/web/src/main.tsx`: the How It Works effect runs when a `#how` hash is present or on an explicit click; it scrolls to the section in both cases but only moves focus after a user action, so the skip-link still receives the first Tab. The identity-reset path preserves `#how` instead of stripping it.
- `apps/web/src/main.tsx`: a production bundle built without `VITE_CLERK_PUBLISHABLE_KEY` now shows an explicit "Clerk is not configured for this build" message instead of the local-identity system. Local identities remain the non-production evaluation fallback.

Verification: real-browser inspection of `npm run dev` on http://127.0.0.1:5173 shows 65 Clerk elements and the "Continue with Google" control; clicking it redirects to `accounts.google.com` with Clerk's OAuth parameters. Direct `/#how` and refresh land on the section at 320/390/768/1440 with no focus theft, while a plain `/` load stays at the top. New tests: `tests/core/dev-startup.test.ts` (5 cases) locks the startup mode, and `tests/e2e/how-it-works.spec.ts` gains a deep-link/refresh case that fails on the pre-fix code. Google OAuth completion requires a real Google account and is not claimed here.

## Continuation verification (22 November 2026)

This continuation audited the same uncommitted tree above `53967a2` and reran the full local gate against isolated evidence. It fixed two genuine test defects introduced with the later work: a type annotation that failed `tsc` (`tests/core/room-durable-object.test.ts`) and a wake assertion that wrongly expected the room version to stay unchanged. The Overview visual baseline was not regenerated and no assertion was widened. The before/after Overview captures differ only where a focused skip-link overlays the header (5,102 px under y 25 at 1440; 10,424 px under y 106 at 390), and two fresh Overview runs are byte-identical to the saved `WP-OVERVIEW-AFTER` evidence, confirming the difference is a capture artifact rather than a layout change.

| Check | Result |
| --- | --- |
| TypeScript | PASS, exit 0 |
| Production frontend build | PASS; dependency annotation and chunk-size warnings only |
| Core | 323 passed, 0 failed, 0 skipped (23 files) |
| Local | 78 passed, 0 failed, 0 skipped |
| Browser desktop + mobile | 70 passed, 2 skipped, 0 failed, 0 flaky (21.5 min); the 2 skips are per-project guards |
| Axe | 32 scans (16 per viewport), 0 violations; incomplete entries need human review |

The two skips are deliberate: `overview.spec.ts` runs the 768 px tablet shot once in the desktop project, and `how-it-works.spec.ts` runs the touch-navigation case in the mobile project only. History and room deletion reran 14/14 (host-only authorization, ended-room-only status, protected records, cancel, repeat, cross-room IDs and database-failure rollback). The `room-durable-object` wake test now asserts exactly one `connected` heartbeat event on the state read, matching the local store's heartbeat path, instead of an unchanged version. SQLite row removal is proven; physical database shrinkage and Cloudflare billing were not measured and are not claimed. No load or capacity test was rerun, and nothing was committed, pushed or deployed.
