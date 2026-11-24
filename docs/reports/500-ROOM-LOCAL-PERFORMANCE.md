# 500-room local performance engineering

The target is 500 active rooms with ten connected clients each. The current acceptance gates require bid and broadcast p95 below 1,000 ms and ping p95 below 500 ms. Every client, accepted bid version, expected race outcome, first sale and durable financial result must agree. Any unexpected action error or disconnect fails the run. The application still limits each room to 20 members.

## Strict local investigation

**Two independent runtimes passed 2,000 users across 200 rooms.** The highest single-runtime strict pass covered 1,000 users across 100 rooms. The three-runtime attempt at 3,000 users reached the host's free-memory guard during setup. No 4,000- or 5,000-user run followed.

The direct runtime ran on Windows with an Intel Core 5 210H, eight physical cores and twelve logical processors. The benchmark kept the same eight main bids, two-client race, forty-second bid spread, sixty-second first lot and seventy-second ping window. It used approved Quick 80 plans, synthetic signed identities and exactly ten open sockets per room. Setup and connection ramp were measured separately. Multi-process runs wait for every generator to claim teams before starting any auction and keep sockets open until every generator finishes its settlement checks.

The archived bundle reproduced both failures. At 1,000 users the control accepted 800 main bids and delivered 9,000 versions. Ping p95 reached 558 ms, with its two slowest five-second windows near settlement and automatic advance. At 2,000 users it connected all sockets, accepted 1,499 of 1,600 main bids and recorded 33 unexpected action errors. Bid, broadcast and ping p95 were 5,298, 3,292 and 2,589 ms. The calibrated HTTP flush-to-Worker interval reached 3,024 ms at p95. The Worker-to-room callback interval reached 483 ms, room readiness was below clock resolution, bid commit was 5 ms, and WebSocket ingress-to-pong was 1 ms. The workerd process reached 0.91 CPU cores at p95. A separate live thread sample attributed 2.73 of 2.77 process CPU seconds to one thread. These measurements localize delays to either side of callback boundaries. They cannot identify a particular workerd input gate or kernel queue.

Six fixed-rate, six-second controls used the same 1,000 connected sockets in waiting rooms. In forward and reverse order, authenticated HTTP history reads alone had p95 of 43 and 110 ms, WebSocket heartbeats and pings alone had ping p95 of 75 and 33 ms, and combined reads and socket traffic had HTTP p95 of 56 and 45 ms and ping p95 of 74 and 63 ms. All six controls had zero errors. These measurements isolate dispatch at the corresponding offered rates. The capacity runs also execute real bid transactions, broadcast the complete room and settle a player.

The workerd CPU profile collected 6,249 samples in the application isolate. The transaction callback during bid advancement, bid mutation and alarm advancement accounted for 429, 415 and 327 samples on three distinct stacks. The broadcast function directly accounted for another 475 samples on the bid stack. The SQLite adapter previously deep-cloned the full record before and after every transaction and reserialized the previous state for comparison. It now uses the original SQLite row strings as its comparison baseline. Callbacks still receive fresh parsed values, financial state and receipts commit together, and the adapter retains the original room identity and version for its transition checks.

Every client in the 2,000-user control negotiated WebSocket per-message deflate. When clients declined the extension on the identical archived bundle, all 1,600 main bids, 200 race outcomes and 18,000 exact deliveries succeeded. Workerd peak working set fell from 1,162 to 688 MiB and generator CPU from 0.63 to 0.37 cores on average. Bid, broadcast and ping p95 still missed the gates at 2,620, 1,795 and 982 ms. The uncompressed clients received 688 MB of socket traffic during the timed window. Protocol negotiation is a material local cost and changes wire bandwidth.

The strict runner compares each socket's first sale to the persisted player, purchaser and price, checks each team's budget, and verifies the SQLite files after runtime exit. Some initial Windows reads encountered temporary WAL mapping errors during shutdown. The original failures are retained alongside independent readbacks. Both early 2,000-user controls subsequently returned all 200 room records and passed the financial checks. Later runs use graceful shutdown and a private copy of the SQLite database and WAL. SQLite reconstructs the temporary shared-memory index on that copy.

### Matched builds and runtime placement

The following latencies are p50 / p95 / p99 in milliseconds. CPU seconds and peak working set cover the sampled workerd processes together, including setup. Both application builds used the same local esbuild command. Every row in this table used normal client compression negotiation.

| Users / rooms | SQLite adapter | Runtimes / generators | Strict result | Bid acknowledgement | Broadcast | Ping | Workerd CPU seconds / peak MiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 / 100 | Before | 1 / 1 | Pass | 34 / 56 / 67 | 27 / 49 / 65 | 26 / 69 / 283 | 51.5 / 681 |
| 1,000 / 100 | After | 1 / 1 | Pass on independent readback | 32 / 53 / 70 | 24 / 45 / 64 | 12 / 44 / 297 | 47.0 / 669 |
| 1,000 / 100 | After, repeat | 1 / 1 | Pass | 32 / 54 / 65 | 24 / 45 / 59 | 27 / 86 / 433 | 48.0 / 680 |
| 2,000 / 200 | Before | 1 / 1 | Fail latency | 1,766 / 2,840 / 3,101 | 1,096 / 2,076 / 2,281 | 384 / 1,383 / 1,670 | 110.1 / 1,148 |
| 2,000 / 200 | After | 1 / 1 | Fail latency | 1,536 / 2,551 / 2,733 | 1,042 / 1,994 / 2,224 | 321 / 1,038 / 1,695 | 107.2 / 1,143 |
| 2,000 / 200 | After | 1 / 2 | Fail latency | 1,303 / 2,463 / 2,651 | 848 / 1,546 / 1,938 | 273 / 1,107 / 1,590 | 110.1 / 1,209 |
| 2,000 / 200 | After | 2 / 2 | Pass | 42 / 80 / 100 | 30 / 68 / 88 | 30 / 141 / 588 | 139.5 / 1,343 |
| 2,000 / 200 | After, independent repeat | 2 / 2 | Pass | 40 / 69 / 93 | 28 / 62 / 86 | 39 / 117 / 621 | 127.1 / 1,310 |

The repeat verified another 1,600 main bids, 200 expected race conflicts, 18,000 exact-version deliveries and 200 matching persisted sales. All 2,000 sockets remained connected throughout the common 70-second activity window. Both independent runs met the gates on each runtime and across the pooled observations.

At 2,000 users the storage change reduced measured bid commit p95 from 5 to 3 ms and advancement p95 from 4 to 2 ms. Both matched builds accounted for 1,600 main bids, 200 stale-version race losers, 18,000 deliveries and 200 first sales. Each had zero unexpected action, HTTP, ping or socket errors and zero early closes. The matched single-runtime correction improved latency and left all three p95 gates above their limits.

Holding the two generators fixed isolated the effect of runtime placement. With one runtime the generators still missed all three latency gates. With two independent runtimes they met all three gates on each runtime and across the pooled samples. Individual bid / broadcast / ping p95 values were 79 / 66 / 160 ms and 82 / 70 / 131 ms. The generators shared a 70.0-second activity window. The two workerd processes used 0.85 and 0.84 CPU cores at p95. The generators averaged 0.40 and 0.38 cores and each had about 20 ms p95 event-loop delay. Across both generators, the best before/after clock probes bounded offset between -3.84 and +5.06 ms. The generator process count alone does not explain the prior failure.

Each local runtime owned disjoint room codes, a separate SQLite directory and its own Directory Durable Object. Runtime placement changes both scheduling capacity and Directory contention. Their individual contributions and the behavior of a shared production directory remain unmeasured.

The 3,000-user attempt began with 5,561 MiB free. The 1,536 MiB guard stopped it at 1,517 MiB, before the team-claim barrier or timed bid window. The three workerd processes reached a sampled 1,805 MiB combined and consumed 73.1 sampled CPU seconds during setup. The host figure also includes generators, compression buffers, the operating system and other processes. The saved state contained 300 rooms on independent readback, with zero bid events and zero sales. Bid, broadcast, ping and disconnect metrics for a completed 3,000-user workload are unavailable.

### Host and generator controls

The affinity test assigned workerd and Node disjoint CPU sets on the four higher-efficiency-class cores and four lower-class cores reported by Windows. Each process could use two physical cores of each class. At 1,000 users the fixed placement passed with bid / broadcast / ping p95 of 51 / 46 / 50 ms. The two unpinned runs on the same build recorded 53 / 45 / 44 and 54 / 45 / 86 ms. The comparison shows variability at this load and provides insufficient evidence to require affinity pinning.

The archived bundle connected 1,000 sockets in 9.78 seconds at connection concurrency 20 and 4.81 seconds at concurrency 10 on the subsequent trial. Both diagnostic auctions passed. At the lower concurrency, concentrating the same HTTP request rate on half the room codes returned history-read p95 of 51 and 66 ms on the forward and reverse repetitions. Halving the combined message rate at fixed room count yielded ping p95 of 85 and 72 ms. All ten control legs completed without errors. These waiting-room controls and the timed bid workload have different costs. The capacity trials always used ten connected users per active room, so those trials cannot independently vary total rooms and total clients.

### Reproducing the strict series

Use Node 22.23.2 on Windows with the locally installed Miniflare 5.20261113.0-beta and workerd 1.20261113.1. The evidence includes the exact historical, before and after bundles. The following commands extract the tested after bundle into a new temporary directory and repeat the highest passing workload. Each invocation needs a fresh output directory. The runner generates its own synthetic credentials and binds each runtime to loopback.

```powershell
$bench = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("arena-replay-" + [guid]::NewGuid().ToString('N')))
$bundle = Join-Path $bench.FullName 'index.mjs'
$modules = Join-Path $env:TEMP 'opencode\wrangler-runtime\node_modules\miniflare'
python -c "import gzip,pathlib,sys; pathlib.Path(sys.argv[2]).write_bytes(gzip.decompress(pathlib.Path(sys.argv[1]).read_bytes()))" docs/reports/evidence/500-ROOM-STRICT/bundles/after.mjs.gz $bundle
node scripts/run-strict-local.mjs "--bundle=$bundle" "--modules=$modules" "--output=$($bench.FullName)\run" --users=2000 --instances=2 --generators=2 --port=9190
```

For the matched single-runtime comparison, use the before and after bundles in separate runs with `--instances=1 --generators=1`. The two-generator control uses `--instances=1 --generators=2`. The runner records the bundle hash, affinity, compression settings, host samples and per-instance verdicts. The bounded CPU profile and traffic controls use `--profile=true --controls=true`. In a separate 2,000-user trial, sending small client frames uncompressed while retaining compression for snapshots gave bid / broadcast / ping p95 of 2,297 / 1,699 / 1,012 ms. The local server compatibility-flag experiment still negotiated per-message deflate with normal clients. The deployed configuration was untouched.

The application changes are in `packages/storage/src/sqlite-room.ts` and `packages/storage/src/port.ts`. The strict runner, verdict checks, profiler, load generator, local server, timing summary and SQLite inspector live under `scripts/`. Regressions cover in-place mutation, retained receipts, rollback, and pooled versus per-runtime acceptance. TypeScript, 112 relevant core tests, 78 local tests, three benchmark-verdict cases and two browser sale/reconnect cases passed. The core tests completed Quick 80, Standard 120 and Mega 250 and their recall rounds. The timed multi-room workload measured the opening sale in Quick 80. Sustained full-auction load, a shared cross-room directory at scale and production routing remain separate validation work. [Trial matrix](evidence/500-ROOM-STRICT/matrix.json) · [Raw traces, integrity records, bundles and checksums](evidence/500-ROOM-STRICT/)

## Earlier acceptance gates

The original series used ping p95 at or below 1,000 ms and broadcast p95 at or below 2,000 ms. It recorded bid acknowledgement separately. Under those historical gates the highest pass was 1,000 clients across 100 rooms using direct Miniflare. Wrangler dev passed 500 clients across 50 rooms. Both 2,000-client direct runs failed. The earlier 572 ms ping result exceeds the current gate.

## Changes

- The local harness accepts an explicit room size and optional Quick, Standard or Mega plan. Early sockets receive heartbeats during the ramp. The stricter workload checks exact accepted versions, the expected stale-version race loser, and convergence on the first result across the whole room.
- The runner creates unique state directories, requires a fresh evidence directory, binds to loopback, explicitly starts Wrangler locally and includes a free-memory stop. It uses synthetic local identities and fixture-free SQLite state.
- Opt-in bid timing records the room advance, transaction, alarm, snapshot, socket sends, response serialization and launch of outbox work. The paced diagnostic also measures Worker authentication and the round trip to the room object. Local timers reflect what workerd exposes. The outbox launch metric excludes asynchronous Directory completion.
- Room actions check membership during the existing advancement read and still check it again before the action commits. The Directory receives a smaller projection for live rooms and reconciles rows using set operations. Existing rows are retained when memberships are unchanged. Tombstones, former participants, completed archives and version checks remain part of the transaction.

## Measured burst comparison

Each room used the 24-player sample pool, eight main bid intents, a two-client race and a 30-second lot timer. The nominal steady window was 40 seconds. The optimized comparison used the same workload before the later exact-version and pacing additions.

| Runtime | Users / rooms | Result | Accepted main bids | Ack p95 | Broadcast p95 | Ping p95 | Workerd peak working set |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 100 / 10 | Pass | 80/80 | 1,688 ms | 1,861 ms | 472 ms | 428 MiB |
| Optimized | 100 / 10 | Pass | 80/80 | 655 ms | 773 ms | 299 ms | 408 MiB |
| Baseline | 500 / 50 | Fail | 372/400 | 5,813 ms | 4,307 ms | 2,014 ms | 1,040 MiB |
| Optimized | 500 / 50 | Fail latency gates | 400/400 | 4,174 ms | 3,442 ms | 1,672 ms | 1,004 MiB |

Both optimized levels had zero action, HTTP, socket or missing-broadcast errors and clean integrity checks. At 500 users, claim-and-start time dropped from 35.55 to 24.49 seconds. The baseline 500-user run overlapped a regression suite, so the magnitude of the measured gain is directional. Neither run establishes a sustained capacity limit.

On the failed baseline, the reported acknowledgement percentile includes rejected main bid responses. Every measured main bid succeeded in the optimized runs.

In the baseline 500-user run, p95 inside the room handler was 8 ms for commit, 1 ms for the snapshot, and 3 ms for fan-out. Those individual stage values are much smaller than end-to-end p95. They do not identify queueing, the exact cost of Directory work, or a single dominant cause. This evidence does not justify replacing authoritative snapshots with a new protocol yet.

## Paced Quick 80 workload

The paced run claimed teams before starting the rooms, used approved Quick 80 plans, a 60-second lot and a 70-second ping window. The eight main bids and the race per room were preserved. First bid times were spread across 20 seconds. The stricter harness required the exact accepted version at each socket.

| Users / rooms | Result | Accepted main bids | Ack p95 | Broadcast p95 | Ping p95 | Workerd peak working set |
| --- | --- | --- | --- | --- | --- | --- |
| 100 / 10 | Pass | 80/80 | 63 ms | 46 ms | 23 ms | 426 MiB |
| 500 / 50 | Fail broadcast gate | 400/400 | 2,760 ms | 2,148 ms | 920 ms | 971 MiB |
| 500 / 50, 40-second spread | Fail ping gate | 400/400 | 1,458 ms | 1,019 ms | 1,117 ms | 997 MiB |

All connected clients received every expected bid version and agreed on the first result. Both integrity checks passed. The 500-user level missed the 2,000 ms broadcast gate by 148 ms. Worker authentication p95 was 1 ms, the Worker round trip to the room was 686 ms, and room commit, snapshot and socket send p95 were 12, 2 and 5 ms. End-to-end latency includes additional request and host scheduling outside those spans. The stage percentiles cannot be added or subtracted to attribute that time.

The 40-second spread kept the pool, lot timer, bid count, and steady window the same. All 500 sockets stayed connected. All 50 expected race conflicts were stale-version responses, all 4,500 bid deliveries matched the exact version, and all 50 rooms settled consistently for ten recipients. The persisted checks passed. Ping exceeded its gate by 117 ms even though bid and broadcast latencies fell. This supports investigating transport and workerd scheduling under mixed WebSocket and HTTP traffic before scaling the ladder. It does not establish the cause of the tail latency.

## Evidence limits

These workloads measure one sale cycle with synthetic identities and Node WebSocket clients on one Windows host. They do not establish full-auction soak behavior, a 5,000-user capacity guarantee, real-device performance or production capacity. The earlier 1,000-user result used a different room shape and system state. [Raw reports and integrity records](evidence/500-ROOM-LOCAL-PERFORMANCE/)

## Regression checks

TypeScript and the local Node suite passed, with 78 local tests. The default parallel core run passed 310 tests and timed out on two full auction fixtures. The serial run passed 311 and timed out on Mega at its existing 45-second limit. A separate Mega diagnostic in the isolated copy passed the same assertions in 42.7 seconds with a larger diagnostic timeout. Repository test thresholds were preserved. The new Directory regression verifies a bid-version update writes no membership rows and a later block removes the correct membership while preserving its participant record.

All 18 archived load, integrity and manifest JSON files passed their SHA-256 checks. The runner rejected a remote origin before reading a key or sending a request. The load processes and listeners stopped. Protected fixtures, input assets and earlier evidence matched their saved hashes, and the active local DB matched its preceding checkpoint. Git HEAD and index were unchanged and `git diff --check` passed.

## Scheduling investigation

The trace records Node fetch start and Undici request creation, body-sent and response-header events, plus body read and parse completion. The Worker stamps its first middleware callback and the point immediately before calling the room binding. The room stamps its fetch entry before readiness, readiness, reply preparation, and the point where it schedules each accepted-version snapshot. WebSocket traces capture the room message callback, pong enqueue, Node message callback and decode. The benchmarks use monotonic clocks for acceptance durations. Host timestamps are used only to partition those durations across processes.

An HTTP health probe before and after each run bounds the same-host clock offset using the shortest of 12 round trips in each phase, with a millisecond allowance for timestamp granularity. The 500-run bounds were -4.44 to +6.74 ms before and -8.49 to +10.30 ms after. Node's wall-to-monotonic drift stayed within 0.62 ms across those probes. Negative short cross-process segments are retained in the summary. They can result from measurement uncertainty and do not imply negative elapsed time.

The Worker and room stamps observe JavaScript callbacks. The gap before a callback can include local proxy, transport and scheduler time. Room readiness delay is separate from that gap. The WebSocket receive stamp starts before JSON parsing and cannot see how long bytes waited in the kernel or in the client's callback queue. Node CPU, event-loop utilization and delay, per-process workerd CPU and working set, and client socket buffer samples constrain these interpretations. Workerd returned no server-side buffered byte values in the first trace.

The equivalent 500-user Quick 80 repeat passed. Its bid, broadcast and ping p95 were 112.39, 77.33 and 80.78 ms. The earlier 1,117 ms ping p95 did not reproduce under the same workload shape. In the slowest five percent of traced pings, the time before the room callback dominated the samples, while callback-to-pong p95 remained 1 ms. Node averaged 0.23 CPU cores with 24.5% event-loop utilization and p95 native event-loop delay of 21.68 ms at 10 ms resolution. Local workerd's busier process reached 0.89 cores at p95 over the process samples. These results do not show sustained Node saturation or identify the specific queue responsible for the earlier failed run.

At 1,000 users across 100 rooms, all sockets connected. Main bid acceptance fell to 359/800, with 101 HTTP errors, 29 ping errors and 101 action errors, and no early disconnects. For successful traced bids, Undici request creation to body-sent p95 was 32 ms, while body-sent to Worker callback p95 was 9,128 ms. For completed pings, send to room callback p95 reached 10,688 ms and callback to pong p95 stayed at 1 ms. The slowest five percent of completed pings flushed from Node within 21 ms at p95. Node averaged 0.40 cores and 39.8% event-loop utilization. The busier workerd process used 0.98 cores at p95. These paired observations place most of the ping tail before the room callback. The experiment cannot locate the exact transport or runtime queue.

The direct Miniflare control used the same Worker bundle and passed 1,000 users across 100 rooms. It accepted 800/800 bids, delivered all 9,000 expected exact versions, converged in all 100 first settlements and passed persisted integrity. Body-sent to Worker callback p95 fell from 9,128 ms to 7.43 ms. Node used slightly more CPU in the passing run, averaging 0.45 cores, while workerd peak working set fell from 1,794 to 677 MiB. This identifies the Wrangler development serving path as a material factor in the failed configuration. The sequential control also changes the local serving topology and does not identify a unique internal queue or prove that the production path behaves similarly.

### Traced results

Latencies are milliseconds and list p50 / p95 / p99. Workerd CPU seconds and peak working set cover the full process sampling period, including ramp. Node CPU and event-loop utilization below cover the bid and ping workload.

| Serving path | Users / rooms | Verdict | Bid ack | Broadcast | Ping | Workerd CPU / peak MiB |
| --- | --- | --- | --- | --- | --- | --- |
| Previous Wrangler run | 500 / 50 | FAIL ping | 915 / 1,458 / 1,775 | 643 / 1,019 / 1,254 | 188 / 1,117 / 1,671 | 96.30 / 997 |
| Traced Wrangler repeat | 500 / 50 | PASS | 57.62 / 112.39 / 176.02 | 36.65 / 77.33 / 178.75 | 14.73 / 80.78 / 355.07 | 84.88 / 1,002 |
| Traced Wrangler | 1,000 / 100 | FAIL | 5,140.56 / 16,226.44 / 24,789.58 | 2,759.43 / 9,414.90 / 13,930.32 | 1,482.33 / 11,121.69 / 13,803.22 | 203.31 / 1,794 |
| Direct Miniflare | 1,000 / 100 | PASS | 31.97 / 56.90 / 85.78 | 25.60 / 56.61 / 79.38 | 26.86 / 572.13 / 955.87 | 66.41 / 677 |
| Direct Miniflare | 2,000 / 200 | FAIL | 7,276.45 / 18,099.68 / 212,032.76 | 5,024.76 / 11,421.11 / 14,132.38 | 1,767.71 / 7,728.67 / 11,869.55 | 390.48 / 1,204 |
| Direct Miniflare, generator cache | 2,000 / 200 | FAIL | 8,210.06 / 27,029.73 / 46,397.25 | 5,498.82 / 11,822.31 / 12,610.95 | 2,048.48 / 8,486.68 / 14,236.59 | 204.63 / 1,187 |

The direct 2,000-user run connected all sockets in 35.7 seconds and had zero socket errors or early disconnects. It accepted 577/1,600 main bids and recorded 254 HTTP errors, 238 action errors and 2,297 ping errors. Only 173 of 200 rooms met the first-result requirement. Persisted integrity passed. Completed ping samples again show the long segment before the room callback, with 7,474 ms p95 before entry and 1 ms inside the pong handler. The pre-run clock probe completed. A fetch failure prevented the post-run calibration, so cross-process partitions at this level have additional uncertainty. End-to-end monotonic measurements do not depend on that calibration.

At 2,000, Node used 0.95 cores on average and reached 86.1% event-loop utilization during the workload. Workerd used 0.99 cores at p95 of process samples. The stress was present on both sides. To check the contribution of client parsing without changing the traffic, an optional bounded load-generator cache reuses the parsed object for an identical, successfully decoded snapshot. Each socket still receives and matches its own version and participates in convergence checks. Server application logic and acceptance thresholds stay the same.

With the cache, 59,112 frames reused a parse and 7,569 were decoded individually. Node averaged 0.69 cores and 62.6% event-loop utilization. Workerd stayed near one core at p95 (0.97). All 2,000 clients connected in 18.9 seconds, with zero socket errors or early disconnects. The run still had 254 HTTP errors, 259 action errors and 1,433 ping errors. It accepted 650 of 1,600 main bids and 197 of 200 rooms met the first-result requirement. Persisted integrity passed. The main measured delay remained before callback entry, with 10,087 ms body-sent to Worker callback p95 and 8,441 ms ping send to room callback p95 versus 1 ms in the pong handler. The post-run clock probe timed out. The cache reduced observed generator CPU, but did not recover the gates. The remaining bottleneck is outside the measured app callbacks. The evidence does not justify changes to bid, auth or settlement logic.

### Reproduction

Use an isolated source copy and a private runtime directory with an ephemeral RS256 pair. Use the public PEM in `CLERK_JWT_KEY`, the issuer `https://local.auctionarena.test`, an ephemeral `WS_TICKET_SECRET`, and `LOCAL_BID_TIMING=1` in `base.dev.vars`. Keep the private PEM in `clerk-private.pem` in that private directory. Keep the evidence paths fresh. The harness binds to and accepts only loopback. Run the shells in sequence and allow the runner to stop at the first failed gate.

```powershell
$workload = @{
  RoomSize = 10; Mode = 'quick'; SeparateStart = $true; Trace = $true
  BidSpreadMs = 40000; TimerSeconds = 60; DurationMs = 70000
  RuntimeDir = $privateRuntime; WranglerBin = $localWrangler
}
& ./scripts/run-load-test.ps1 @workload -Levels 500 -BasePort 8971 -EvidenceDir $repeatEvidence
& ./scripts/run-load-test.ps1 @workload -Levels 1000,2000,3000,4000,5000 -BasePort 8981 -EvidenceDir $ladderEvidence
node scripts/summarize-local-latency.mjs '<fresh evidence>/load-500.json'
```

To test the direct control, use the Worker bundle produced by that local Wrangler run and pass its `.wrangler/tmp/dev-*/index.js` path as `-DirectBundle`. This starts the installed Miniflare runtime directly with two local SQLite bindings. The run exercises the same bundled API and WebSocket code. The direct control omits Wrangler's outer development proxy and the unused static asset route, so it has its own capacity verdict.

Use `-Levels 1000,2000,3000,4000,5000 -BasePort 8993` for the direct ladder. Repeating the failed level with cached decoding uses `-Levels 2000,3000,4000,5000 -BasePort 9001 -CacheSnapshots` and a separate evidence path. The bundle used in both controls has SHA-256 `9427c7a689278f2c00508864f29353a0be79c9c6dcbda10971270465a9ae4164`.

### Regression and evidence closeout

TypeScript, 78 local cases and 111 relevant core cases across six files passed after the instrumentation. The Mega fixture had previously timed out at 45 seconds. It was removed from the load process schedule and investigated separately. The fixture now reuses each persisted lot read across checks, avoiding 1,247 redundant full record reads over its 250 initial and 249 recall lots. It passed in 41.52 seconds under the original 45-second deadline. All assertions remained in place.

All 25 scheduling evidence JSON files passed SHA-256 verification. The previous evidence hashes, protected fixtures, local database, Git HEAD and index still match their recorded checks. No diagnostic workerd process or loopback listener remains. [Raw traces, manifests, integrity reports and summaries](evidence/500-ROOM-SCHEDULING/)
