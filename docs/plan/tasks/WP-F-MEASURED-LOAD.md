# WP-F measured local load

Scope: transition package F, the final item in the owner-authorized local sequence. It measures the existing single-process Node runtime at 100, 500 and 1,000 concurrent users across multiple rooms. It does not deploy, create a cloud resource, activate R2, migrate production data or claim Cloudflare or production capacity.

## Workload

`scripts/load-local.mjs` starts one isolated API process per level through `scripts/load-api.mjs`. The API uses a temporary `DATA_FILE`, local development sessions, no Clerk credentials and no private `.data` file. Each level:

- creates `ceil(users / 20)` rooms, because the local runtime caps a room at 20 members;
- fills each room to 20 members (one host plus 19 joined members);
- opens one WebSocket per user with a short-lived ticket;
- runs a 10-second steady-state window;
- sends one WebSocket ping per user, staggered across the first 5 seconds;
- polls `GET /api/rooms/:code/sync?afterVersion=<version>` every 2 seconds, with clients staggered across the interval;
- sends one host `claim` action per room at about 3 seconds and measures delivery of the resulting version to all 20 room sockets.

The final run used `--connectConcurrency=10` so the 1,000-user setup could complete without the connection resets seen at higher setup concurrency.

## Pass criteria

A level passes only when all users connect, request/pong/action errors are zero, ping and poll p95 are at most 1,000 ms, broadcast delivery p95 is at most 2,000 ms, and every room broadcast completes. These are local measurement gates, not production SLOs.

## Results

| Users | Rooms | Connected | Setup | Connect | Ping p95 | Poll p95 | Broadcasts completed | Delivery p95 | Errors | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 5 | 100 | 1.35 s | 0.32 s | 8.31 ms | 24.30 ms | 5 / 5 | 131.25 ms | 0 | PASS |
| 500 | 25 | 500 | 11.97 s | 31.81 s | 9,576.39 ms | 18,004.65 ms | 7 / 25 | 9,347.08 ms | 1,093 | FAIL |
| 1,000 | 50 | 1,000 | 91.85 s | 137.34 s | 14,780.25 ms | 8,975.05 ms | 0 / 50 | not measured | 2,917 | FAIL |

The 500-user failures include 194 ping/pong errors, 881 poll errors and 18 broadcast action errors. The 1,000-user failures include 764 ping/pong errors, 2,103 poll errors and 50 broadcast action errors. Error samples are `pong timeout`, `TypeError: fetch failed` and request timeouts. All sockets were connected at the start of each steady-state window; the failures occur under load, not during admission.

The intended steady-state window was 10 seconds. The measured window was 10.1 s at 100 users, 40.1 s at 500 and 32.2 s at 1,000 (31.1 s in the probe). The stretch at 500 and 1,000 is itself a symptom of event-loop and request contention; the levels are not directly comparable in wall-clock duration.

A separate 500-user diagnostic used a 60-second poll interval, effectively disabling polling. It still failed: ping p95 was 14,168.41 ms with 155 ping errors and 9 poll errors. All 25 broadcasts completed, but delivery p95 was 25,992.31 ms, far beyond the 2,000 ms gate. The limit is therefore not caused only by the 2-second poll rate; file-backed whole-database work, the 10-second presence timeout and event-loop contention also contribute. The exact split was not isolated.

## Local optimization

`LocalRoomStore.sweep` previously cloned the entire file-backed database on every heartbeat and read. Package F adds `needsAdvance`, which mirrors `advanceRoom`'s change conditions and skips the clone when no room is due. It over-approximates: a false positive clones and advances, while a false negative would lose a deadline. Typecheck, the 259-test core suite and the 76-test local suite still pass. The optimization did not make 500 or 1,000 users pass.

## Interpretation and limits

- This is the single-process local Node runtime with file-backed JSON state. It is not Workers, Durable Objects, SQLite-backed object storage, hibernation or alarm delivery.
- Client and server share one 12-logical-CPU, 16 GB Windows machine. CPU, disk and event-loop contention are not representative of Cloudflare placement.
- The workload measures steady-state socket liveness, polling and one action per room. It does not cover full bidding, chat, history paging, reconnect storms or many actions per room.
- The local runtime caps a room at 20 members and a host at 10 active rooms. The test sizes rooms to the member cap.
- The 100-user pass is a measured local result for this workload, not a general capacity guarantee. No 500- or 1,000-user capacity is established, and no Cloudflare capacity is claimed.
- `wrangler` and Miniflare were unavailable offline, so the Workers runtime and bindings remain unverified. Browser and accessibility runs exercise the unchanged local Node runtime.

## Verification

The final evidence was collected in an isolated copy at `C:\Users\palli\AppData\Local\Temp\auctionarena-wpf-45f0e0db\work` with a dependency junction, no private environment file and an empty temporary `.data` directory. TypeScript exited 0; the core suite passed 259/259 in 19 files; the local suite passed 76/76; the browser regression passed 34/34 and the separate accessibility suite 4/4, with no failures, skips or flaky cases. Browser axe recorded 34 scans and accessibility 32, both with zero violations; 28 and 26 incomplete entries respectively still need human assessment. All six Package F source/test hashes matched the repository working tree.

Evidence is in [docs/reports/evidence/WP-F-MEASURED-LOAD](../../reports/evidence/WP-F-MEASURED-LOAD/README.md). No commit, deployment, account setting, cloud resource, R2 activation or production migration was created.

## Next gate

The local sequence is complete within its measured limits. The next step is an owner decision on Workers/Miniflare runtime verification and any deployment; neither is authorized by this package. The local runtime remains the development runtime until a tested replacement exists.
