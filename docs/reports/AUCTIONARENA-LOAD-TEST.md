# AuctionArena local load test

**Status:** local measurement complete. This is not a Cloudflare, production, or 1,000-user capacity claim.

**Date:** 19 November 2026

**Runtime:** local `wrangler dev` 4.162.0 / workerd, Node 22.23.2, Windows 11 Home 10.0.26300, Intel Core 5 210H (8 cores / 12 logical threads), 15.7 GiB RAM.

**Evidence:** `docs/reports/evidence/AUCTIONARENA-LOAD-TEST/` (hashes in `SHA256SUMS.txt`).

---

## Verdict

- **Highest verified stable concurrency under the stated zero-error criteria: 1,000 users across 50 rooms.** All 1,000 WebSocket connections succeeded, all 400 expected bids were accepted, all 50 rooms settled, there were zero HTTP 5xx/network errors, zero socket errors, zero early closes, and zero missing broadcasts, and every persisted room passed the integrity check.
- **Highest level with sub-second bid acknowledgement p95: 500 users across 25 rooms.** Bid-ack p95 was 565 ms, broadcast p95 430 ms, and ping p95 125 ms.
- At **1,000 users / 50 rooms**, latency is materially degraded: bid-ack p95 **1,549 ms**, broadcast p95 **1,215 ms**, ping p95 **475 ms**, workerd peak working set **1,548 MiB**, and workerd CPU **62.89 s**. It passes the 2,000 ms broadcast and 1,000 ms ping targets, but it is not a sub-second operating point.
- The requested layouts **250/10, 500/10, 1,000/20** and **single-room 50/100/250/500** are not legal in the current app. A room hard-caps at 20 members (`MAX_MEMBERS = 20` in `apps/api/src/worker/room-do.ts`; `/api/health` returns `maxMembers: 20`), and spectators count toward the cap. The legal equivalents are **250/13, 500/25, 1,000/50**, and a single room of **20**. A 21st join was explicitly attempted and rejected with 404 `ROOM_NOT_FOUND`; the room stayed at 20 members.
- All results are local `workerd` measurements over localhost. They do not establish Cloudflare production capacity, internet latency, browser behaviour, or cost.

### Requested phases and what was actually run

| Phase | Requested | What was run | Result |
|---|---|---|---|
| 1 | Inspect the harness, verify the real room API/DO/WebSocket path, run 100 users / 5 rooms | 100 users / 5 rooms, 40 s steady state, 8 bid rounds, real HTTP actions and WebSocket broadcasts | Pass, 0 errors |
| 2 | 250/10, 500/10, 1,000/20 | Not legal; ran the minimum legal layouts 250/13, 500/25, 1,000/50 | Pass at all three |
| 3 | Single-room 50/100/250/500 | Not legal; ran the maximum legal single room of 20 users, plus a richer 20-user correctness/stress scenario | Pass; 21st join rejected |
| 4 | Correctness: duplicate receipts, sold/unsold, budgets, authorization, screen divergence, approved order | 20-user Quick-plan scenario plus persisted-SQLite checks on every load level | 0 violations, 0 integrity problems |
| 5 | This report | Users, rooms, duration, ramp, runtime, connections, p50/p95/p99, CPU/memory, errors, commands, evidence, bottlenecks, limitations, highest stable level, next recommendation | Complete |

---

## 1. Scope and safety

- No Cloudflare deployment, no production traffic, no paid infrastructure, no R2 activation, no production migration, and no Clerk user creation.
- The runs used an isolated project copy at `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-verify` with a junction to the repository's `node_modules`, no `.env.local`, no `.wrangler` state, and no `.data` file.
- Each load level used a fresh `--persist-to` state directory. Levels never shared persisted state.
- Local Clerk authentication used a generated RS256 keypair and local tokens; no Clerk network call was made. The private key and local `.dev.vars` stayed in `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime`, outside the repository.
- No auction, bidding, settlement, authorization, or financial rule was changed. The only additions are load-only scripts under `scripts/`: `check-load-integrity.mjs`, `load-auction-correctness.mjs`, `run-load-test.ps1`, and `summarize-auction-load.mjs`.
- No commit or push was made. The owner's `.data/auctionarena.json`, `Assets/`, and fixtures were not touched.

---

## 2. Environment

| Item | Value |
|---|---|
| OS | Windows 11 Home Single Language, 10.0.26300, 64-bit |
| CPU | Intel Core 5 210H, 8 cores / 12 logical threads, 2.2 GHz |
| RAM | 16,857,817,088 bytes (15.7 GiB) |
| Node | v22.23.2 |
| Wrangler | 4.162.0 |
| Runtime | local `wrangler dev` / workerd |
| Harness | Node `ws` clients over localhost |
| Network | loopback only; no TLS, internet RTT, CDN, or browser |

Room settings used by the load harness:

```
name: Worker Load Auction
teamCount: 8, budget: 8000, minSquad: 2, maxSquad: 8, maxOverseas: 4
timerSeconds: 30, lateExtension: true, bidIncrement: 10
autoAdvance: true, resultSeconds: 2, spectators: true
bidRule: tiered-v1 (10 / 20 / 25 increments)
```

The correctness scenario used the same settings except `timerSeconds: 10` so two lots could be completed inside the scenario.

---

## 3. Workload and method

### 3.1 Load harness

`scripts/load-worker.mjs` drives the real Worker, room Durable Object, and WebSockets:

1. Creates `ceil(users / 20)` rooms and joins each room to 20 members (or 19 in the 250/13 layout).
2. Requests a short-lived WebSocket ticket per member and opens one WebSocket per member.
3. Claims all 8 teams in each room and starts the auction.
4. Sends 8 sequential bids per room, alternating the t1 and t2 owners. Each bid uses the real tiered next-bid amount and the current `expectedVersion`.
5. At round 2, sends a two-client race with the same expected version and amount; exactly one bid must win and one must receive `STALE_VERSION`.
6. Runs a 40 s steady-state window with WebSocket pings and heartbeats.
7. Waits for the first lot to settle and records the delivery of the `RESULT` snapshot to every member.
8. Samples the `workerd` working set and CPU once per second.

Measured definitions:

- **Bid acknowledgement (action):** time from sending the HTTP `POST /api/rooms/:code/actions` to receiving the accepted response.
- **Broadcast:** time from sending the accepted action to a member receiving that version (or a later authoritative version) on its WebSocket. The harness waits for every member and pools the individual delivery latencies, including race-winner deliveries. Its p95 is a percentile across deliveries, not a percentile of per-action slowest-member times.
- **Ping:** WebSocket `ping`/`pong` round trip.
- **Loop lag:** the harness's own event-loop delay; a large value could indicate client contention, but does not identify a bottleneck by itself.
- **Memory/CPU:** summed `workerd` working set and CPU seconds from the Windows process sampler.

Ramp behaviour:

- Setup and connect each use **20 concurrent operations**. There is no fixed users-per-second ramp.
- Measured effective rates (claim rates count attempts, including retries, over the claim-and-start phase):
  - 100/5: setup ≈ 103 members/s, connect ≈ 111/s, claims ≈ 41/s.
  - 250/13: setup ≈ 140/s, connect ≈ 119/s, claims ≈ 47/s.
  - 500/25: setup ≈ 142/s, connect ≈ 126/s, claims ≈ 48/s.
  - 1,000/50: setup ≈ 119/s, connect ≈ 84/s, claim attempts ≈ 33/s (405 / 12.447 s = 32.54/s); successful claims ≈ 32/s (400 / 12.447 s = 32.14/s).
- Ramp-down closes all sockets at once after the steady-state window. The host-presence alarm then marks members disconnected and pauses the room; this is why the persisted rooms are `PAUSED` rather than `LIVE`/`RESULT`.

Important counting note: the 8 main bids per room are counted in `accepted`. The race winner is an additional accepted bid and is not included in `accepted`, but it is included in broadcast deliveries and persisted `bid` events. Each room therefore persists 9 accepted bid events (8 main + 1 race), while `accepted` is 8 per room.

### 3.2 Persisted integrity checker

`scripts/check-load-integrity.mjs` reads each room's SQLite state read-only and checks:

- the room count matches the expected count;
- aggregate budget conservation: the sum of remaining budgets and squad spend across all teams equals `teamCount × settings.budget`;
- no negative budgets, no squad over `maxSquad`, no player in two squads;
- every sold player has a matching team, squad entry, and price;
- every unsold player has no sale fields;
- sold/unsold player counts match the persisted `sold`/`unsold` events;
- event versions are contiguous and event IDs and receipt IDs are unique;
- the room version matches the last persisted event;
- `LIVE` and `PAUSED` rooms have exactly one open player; `RESULT`/`COMPLETED`/`CLOSED` rooms have none;
- a settled current lot agrees with its winning bid fields (`soldTo`/`soldPrice` versus `leadingTeamId`/`currentBid`);
- an approved plan has no duplicate or missing player IDs, and the opened-player sequence follows the approved order.

The checker never writes to the database and never invents a room.

### 3.3 Correctness scenario

`scripts/load-auction-correctness.mjs` runs a single 20-user room through the real API:

- 20 members, 8 claimed teams, and a real Quick-plan preview/approval (80 players, 10 sets of 8, real catalog `real-v1-3fb107eb`);
- two lots in the approved order with competing bids;
- a duplicate accepted bid with the same action ID and content;
- an action-ID reuse with changed content;
- a teamless bid and an outsider bid;
- a two-client same-version race;
- a 20-client convergence check after each settlement;
- two client reconnects with a 300 ms pause between close and reconnect;
- a host `end` after the second lot, which settles the auto-advanced third lot and completes the auction.

The 21st join is attempted explicitly to document the 20-member cap.

### 3.4 Orchestration

`scripts/run-load-test.ps1`:

- refuses to start if any `workerd` process is already running, so the memory sample cannot be contaminated;
- creates a fresh `--persist-to` state per level;
- starts `wrangler dev` on a dedicated port with a level-specific `ALLOWED_ORIGINS`;
- waits for `/api/health` to report `maxMembers: 20`;
- runs the harness, kills the process tree, waits for the port and `workerd` to clear;
- runs the integrity checker and writes `integrity-<users>.json`;
- stops at the first failed level and writes `run-manifest.json` with ports, state paths, timestamps, and failures.

---

## 4. Results

### 4.1 Connections, workload, and errors

| Level | Rooms | Members/room | Setup | Connect | Claims | Steady window | Harness total | Connected | Bids accepted/expected | Race conflicts | HTTP errors | Socket errors | Missing broadcasts | Rooms settled |
|---|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 20 / 1 | 1 | 20 | 0.36 s | 0.19 s | 0.43 s | 40 s | 43.35 s | 20/20 | 8/8 | 1 | 0 | 0 | 0 | 1/1 |
| 100 / 5 | 5 | 20 | 0.97 s | 0.90 s | 0.98 s | 40 s | 45.26 s | 100/100 | 40/40 | 5 | 0 | 0 | 0 | 5/5 |
| 250 / 13 | 13 | 3×20 + 10×19 | 1.78 s | 2.10 s | 2.23 s | 40 s | 49.19 s | 250/250 | 104/104 | 13 | 0 | 0 | 0 | 13/13 |
| 500 / 25 | 25 | 20 | 3.52 s | 3.96 s | 4.19 s | 40 s | 54.29 s | 500/500 | 200/200 | 25 | 0 | 0 | 0 | 25/25 |
| 1,000 / 50 | 50 | 20 | 8.40 s | 11.95 s | 12.45 s | 40 s | 75.57 s | 1,000/1,000 | 400/400 | 50 | 0 | 0 | 0 | 50/50 |

Notes:

- `Harness total` is `finishedAt − generatedAt`; it includes setup, connect, claims, the 40 s steady window, settlement, and the memory-sampler stop.
- The orchestrator's server wall time (startup through kill) was 55.6 s, 57.0 s, 62.9 s, and 83.8 s for 100/250/500/1,000.
- `HTTP errors` counts only 5xx and network failures. The HTTP 400 responses are expected: one race loser per room, plus 5 claim `STALE_VERSION` retries at 1,000/50. The 1,000/50 status counts were 2,905 × 200, 50 × 201, and 55 × 400.
- Every level had 0 ping errors, 0 action errors, 0 socket errors, 0 early closes, and 0 missing broadcasts.

### 4.2 Latency (milliseconds)

| Level | Ping p50 / p95 / p99 | Ping max | Bid-ack p50 / p95 / p99 | Bid-ack max | Broadcast p50 / p95 / p99 | Broadcast max |
|---|---:|---:|---:|---:|---:|---:|
| 20 / 1 | 3 / 10 / 30 | 32 | 47 / 58 / 58 | 58 | 25 / 36 / 39 | 39 |
| 100 / 5 | 6 / 13 / 68 | 99 | 107 / 133 / 149 | 149 | 60 / 134 / 138 | 139 |
| 250 / 13 | 5 / 29 / 200 | 232 | 237 / 262 / 266 | 299 | 108 / 221 / 260 | 291 |
| 500 / 25 | 9 / 125 / 289 | 327 | 483 / 565 / 569 | 638 | 310 / 430 / 454 | 504 |
| 1,000 / 50 | 8 / 475 / 788 | 1,014 | 1,432 / 1,549 / 1,561 | 1,567 | 810 / 1,215 / 1,342 | 1,382 |

Broadcast delivery counts were 180, 900, 2,250, 4,500, and 9,000 respectively (room members × 9 accepted versions: 8 main bids + 1 race winner). The 250/13 count is 2,250 because that layout has 250 members total (3 rooms of 20 and 10 rooms of 19).

### 4.3 Resources and settlement

| Level | workerd CPU (s) | Peak working set (MiB) | Mean working set (MiB) | Harness RSS (MiB) | Loop-lag p95 / max (ms) | Worst result delivery after deadline (ms) | Integrity |
|---|---:|---:|---:|---:|---:|---:|---|
| 20 / 1 | 3.06 | 271 | 264 | 65 | 6 / 13 | 42 | 1/1 rooms, 0 problems |
| 100 / 5 | 8.11 | 418 | 399 | 99 | 7 / 18 | 105 | 5/5 rooms, 0 problems |
| 250 / 13 | 14.64 | 646 | 595 | 132 | 6 / 24 | 160 | 13/13 rooms, 0 problems |
| 500 / 25 | 26.38 | 991 | 892 | 236 | 7 / 18 | 151 | 25/25 rooms, 0 problems |
| 1,000 / 50 | 62.89 | 1,548 | 1,279 | 267 | 6 / 16 | 371 | 50/50 rooms, 0 problems |

CPU is cumulative workerd CPU seconds over the harness window, not host CPU percentage. Workerd memory is the Windows working set; harness RSS is Node's resident-set measurement. Memory values use 1,048,576 bytes per MiB, despite the retained JSON fields being named `*Mb`. The harness's own loop lag stayed at 6–7 ms p95, giving no sign of sustained client event-loop saturation without ruling out other client costs. Every room settled; the worst result delivery was 371 ms after the deadline at 1,000/50.

### 4.4 Single-room maximum (20 users)

The requested single-room levels 50, 100, 250, and 500 are impossible under the 20-member cap. The maximum legal single room was measured twice:

| Run | Users | Connected | Bids | Ping p95 | Bid-ack p95 | Broadcast p95 | CPU | Peak RSS | Integrity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Single-room load | 20 | 20/20 | 8/8 | 10 ms | 58 ms | 36 ms | 3.06 s | 271 MiB | 1/1 rooms, 0 problems |
| Correctness/stress | 20 | 20/20 | 10 accepted (+2 race winners) | — | 71 ms | 46.13 ms | — | — | 1/1 rooms, 0 problems |

The single-room load run also had 1 expected race conflict, 0 HTTP errors, 0 socket errors, and 0 missing broadcasts. The correctness run additionally exercised joins, team claims, plan approval, two lot transitions, duplicate/reused IDs, unauthorized bids, a race, two reconnects, and 20-client convergence.

The 21st join was attempted in the correctness room:

```json
{ "attempted": 21, "status": 404, "code": "ROOM_NOT_FOUND", "membersAfter": 20 }
```

The app deliberately returns the same private response as a bad invitation, so the cap does not reveal that the room exists.

### 4.5 Correctness results

All of the following are from `correctness.json`; the persisted room was independently checked in `integrity-correctness.json`.

| Check | Result |
|---|---|
| Connections | 20/20 |
| 21st join | 404 `ROOM_NOT_FOUND`; room stayed at 20 members |
| Plan | Quick, 80 players, 10 sets of 8, 0 adjustments, approved, catalog `real-v1-3fb107eb` |
| Claims | 8/8, p95 62 ms |
| Lot 1 | P003 Sanju Samson, 5 rounds, sold to t2 for 300; 20/20 convergence in 649 ms, one client signature |
| Lot 2 | P032 Suryakumar Yadav, 5 rounds, sold to t2 for 300; 20/20 convergence in 652 ms, one client signature |
| Final | `COMPLETED`, `HOST_ENDED`, 2 sold / 1 unsold, version 52, budget total 64,000 = 8 × 8,000 |
| Duplicate accepted bid | 200, version 39 → 39, delta 0 |
| Action-ID reuse with changed amount | 400 `ID_REUSED`, version 39 |
| Teamless bid | 400 `NO_TEAM`, version 39 → 39 (no state change) |
| Outsider bid | 404 |
| Same-version race | 1 winner, 1 `STALE_VERSION` |
| Reconnect | 2 clients, handshake p95 77.82 ms, both received the current state and were marked connected |
| Action latency | p50 61 ms, p95 71 ms |
| Broadcast latency | p50 35.83 ms, p95 46.13 ms, 240 deliveries, 0 missing |
| Errors / violations | 0 HTTP errors, 0 socket errors, 0 violations |

The final lot 3 was opened by auto-advance and then settled unsold by the host's `end`; the final counts are therefore 2 sold and 1 unsold. The persisted room's version is 72 rather than the in-memory final version 52 because 20 `disconnected` events were appended after the clients closed. A read-only check of the retained SQLite events confirmed those event types; no pause was added to this completed room. The auction result, budgets, and sold/unsold counts are unchanged.

### 4.6 Persisted integrity by level

| Level | Rooms | Status at rest | Sold players | Unsold players | Bid events | Receipts | Problems | Errors |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 20 / 1 | 1 | PAUSED | 1 | 0 | 9 | 18 | 0 | 0 |
| 100 / 5 | 5 | PAUSED | 5 | 0 | 45 | 90 | 0 | 0 |
| 250 / 13 | 13 | PAUSED | 13 | 0 | 117 | 234 | 0 | 0 |
| 500 / 25 | 25 | PAUSED | 25 | 0 | 225 | 450 | 0 | 0 |
| 1,000 / 50 | 50 | PAUSED | 50 | 0 | 450 | 900 | 0 | 0 |
| Correctness | 1 | COMPLETED | 2 | 1 | 12 | 23 | 0 | 0 |

Every room's budget total equalled `8 × 8,000 = 64,000`, every sold player matched a squad entry and price, every unsold player had no sale fields, event versions were contiguous, and event/receipt IDs were unique.

---

## 5. Analysis

### 5.1 Scaling

Latency increases across the tested levels, with the largest absolute bid-ack increase between 500 and 1,000 users:

- Ping p95: 10 → 13 → 29 → 125 → **475 ms**.
- Bid-ack p95: 58 → 133 → 262 → 565 → **1,549 ms**.
- Broadcast p95: 36 → 134 → 221 → 430 → **1,215 ms**.
- Peak workerd working set: 271 → 418 → 646 → 991 → **1,548 MiB**.
- workerd CPU: 3.06 → 8.11 → 14.64 → 26.38 → **62.89 s**.

The 1,000/50 bid-ack distribution is tight (p50 1,432 ms, p95 1,549 ms, p99 1,561 ms). Queueing, storage, serialization, fan-out and runtime scheduling are candidates to instrument; these measurements do not isolate their contributions. The harness loop lag was 6 ms p95, which gives no sign of sustained client event-loop saturation but does not rule out all client costs. The ratio of recorded workerd CPU to harness wall time is about 0.83 core; that average does not exclude peak or individual-thread saturation and does not measure other host processes.

The 1,000/50 run recorded a peak workerd working set of 1,548 MiB (about 1.51 GiB) on a 15.7 GiB machine. The difference from 500 users was 557 MiB, or about 1.1 MiB per additional user, while room count also doubled. This is a process-level observation, not an isolated per-user allocation or proof that memory cannot become limiting.

### 5.2 Candidate bottlenecks, not yet isolated

1. **Per-bid full-snapshot fan-out.** At 1,000/50 the harness delivered 9,000 full room snapshots (50 rooms × 9 accepted versions × 20 members). The current code serializes a bounded snapshot once per broadcast and sends it to each socket. Serialization and fan-out are candidates to measure; the aggregate bid-ack and delivery timings do not establish their share of the delay.
2. **Global Directory Durable Object during setup and claims.** The 1,000/50 claim-and-start phase took 12.45 s, with 5 `STALE_VERSION` retries and a claim p95 of 1,462 ms. Setup took 8.40 s and connect 11.95 s. The shared directory is a candidate contention point, but these phase timings do not isolate it. The current room outbox already coalesces pending projections, and successful bids and claims launch delivery without awaiting it; joins and selected membership/status changes still await delivery.
3. **Local workerd scheduling.** The 0.83-core average and the 1,000/50 latency step justify measuring runtime scheduling and queue delay. They do not identify a limiting thread or establish a local or Cloudflare capacity ceiling.
4. **Room count was not varied independently.** The 20-member cap forces 50 rooms at 1,000 users. Both room count and total fan-out increase between levels, so this ladder cannot separate their effects. Keep the cap unchanged and instrument the existing workload first.

### 5.3 Comparison with WP-F and WP-G

WP-F used the local Node runtime and a different workload (ping, 2 s sync polling, one host claim per room); it passed 100/5 but failed 500/25 and 1,000/50 with many errors. It is not directly comparable to this harness.

WP-G used the same workerd harness and is the closest comparison:

| Level | WP-G ping p95 | This run ping p95 | WP-G bid-ack p95 | This run bid-ack p95 | WP-G broadcast p95 | This run broadcast p95 | WP-G peak RSS | This run peak RSS | WP-G CPU | This run CPU |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 / 5 | 18 ms | 13 ms | 129 ms | 133 ms | 128 ms | 134 ms | 425 MiB | 418 MiB | 9.7 s | 8.11 s |
| 250 / 13 | 270 ms | 29 ms | 634 ms | 262 ms | 545 ms | 221 ms | 630 MiB | 646 MiB | 26.3 s | 14.64 s |
| 500 / 25 | 181 ms | 125 ms | 771 ms | 565 ms | 558 ms | 430 ms | 1,011 MiB | 991 MiB | 29.4 s | 26.38 s |
| 1,000 / 50 | 437 ms | 475 ms | 1,317 ms | 1,549 ms | 1,097 ms | 1,215 ms | 1,529 MiB | 1,548 MiB | 53.1 s | 62.89 s |

The 250/13 and 500/25 levels are faster in this run; the 1,000/50 level is slower on bid-ack and broadcast, slightly slower on ping, and higher on CPU. The 1,000/50 run was the last level in the ladder, so machine state, thermal pressure, or run-to-run variance could contribute. This report does not claim a regression or an improvement from WP-G; it records a fresh local measurement. The important stable result is that 1,000/50 still completed with zero errors and a clean persisted state, but with less latency margin than WP-G's recorded run.

### 5.4 Runtime warnings

The `wrangler` stderr for the 20/1, 100/5, and 500/25 levels contained:

```
WARNING NOSENTRY SQLite alarm overdue, running despite AlarmManager mismatch;
scheduledTime = ...; localAlarmTime = ...; currentTime = ...
```

The scheduled and local alarm times differed by sub-second amounts (about 0.1–0.5 s). This is a local workerd alarm-scheduling warning, not an application error. All rooms settled, the worst result delivery was 371 ms after the deadline, and the integrity checks passed. It should be treated as a local-runtime limitation; production alarm timing is best-effort and is not measured here.

---

## 6. Limitations

- **Local runtime only.** `wrangler dev`/workerd on one Windows machine is not Cloudflare. No multi-colo routing, production Durable Object scheduling, TLS, CDN, or internet RTT is exercised.
- **Simulated clients, not browsers.** The harness uses Node `ws` clients. It does not render React, run the browser event loop, or measure real device CPU, memory, or paint time.
- **20-member cap.** The requested 250/10, 500/10, 1,000/20 and single-room 50/100/250/500 layouts are illegal. The legal equivalents are reported. The 21st join is rejected with the same private response as a bad invitation.
- **40 s steady state, 8 bids, one lot.** The load harness bids on the first lot and does not drive multiple lot transitions under load. The correctness scenario covers three lots (two sold, one unsold) but with 20 users, not 1,000.
- **Sample players in the load rooms.** The load harness uses the default 24-player sample pool, not the real 250-player catalog or an approved plan. The correctness scenario uses the real 80-player Quick plan, but only three lots.
- **No reconnect storm, controlled host-disconnect/resume under load, or spectator-only rooms.** The host stays connected during the load window. The correctness scenario reconnects two non-host spectators; paused sample rooms after ramp-down are not a controlled host-recovery drill.
- **Action and broadcast latency are localhost lower bounds.** Real networks add RTT, TLS, retries, and browser scheduling.
- **Memory is a summed process working set.** It includes the workerd runtime baseline and does not break down per Durable Object. The sampler only ran when exactly one workerd process existed.
- **No fixed users-per-second ramp.** The ramp is bounded by 20 concurrent setup and 20 concurrent connect operations; the effective rates are derived from the measured durations.
- **1,000/50 is the highest tested local level, not a measured ceiling.** It passes the stated zero-error and 2,000 ms broadcast / 1,000 ms ping targets, but its bid-ack p95 of 1,549 ms is not sub-second. The highest tested sub-second bid-ack level is 500/25; neither result is a production operating limit.
- **No production or 1,000-user capacity claim.** The results do not establish cost, Cloudflare quota behaviour, or reliability under real traffic.

---

## 7. Highest verified stable concurrency

Two definitions matter:

1. **Zero-error stability (the criteria used by `load-summary.json`):** 0 connection failures, 0 HTTP 5xx/network errors, 0 socket errors, 0 early closes, 0 missing broadcasts, all expected bids accepted, one expected race conflict per room, all rooms settled, ping p95 ≤ 1,000 ms, broadcast p95 ≤ 2,000 ms, and a clean persisted integrity check.
   - **Highest verified: 1,000 users / 50 rooms.**
   - Measured: 1,000/1,000 connected; 400/400 bids accepted; 50/50 rooms settled; 0 errors; ping p95 475 ms; bid-ack p95 1,549 ms; broadcast p95 1,215 ms; peak working set 1,548 MiB; CPU 62.89 s.
2. **Sub-second bid acknowledgement p95:**
   - **Highest verified: 500 users / 25 rooms.**
   - Measured: 500/500 connected; 200/200 bids accepted; 25/25 rooms settled; 0 errors; ping p95 125 ms; bid-ack p95 565 ms; broadcast p95 430 ms; peak working set 991 MiB; CPU 26.38 s.

The 1,000/50 result is a local measurement, not a production capacity guarantee. The 500/25 result is the highest tested local level meeting sub-second bid-ack p95, not a deployment recommendation.

---

## 8. Recommended next performance improvement

**Instrument the bid acknowledgement path, then use those measurements to choose an optimization. Keep the room cap unchanged.**

Why instrumentation is the next recommended step:

- At 1,000/50, the run delivered **9,000 full room snapshots** (50 rooms × 9 accepted versions × 20 members).
- Bid-ack p50/p95 was **1,432/1,549 ms** and broadcast p50/p95 was **810/1,215 ms**.
- Recorded workerd CPU divided by harness wall time is about **0.83 core**, and harness loop lag was **6 ms p95**. These support investigating the server path, but do not establish a bottleneck or exclude transient/thread-level saturation.
- The 500/25 level, with half the rooms and half the fan-out, had bid-ack p95 **565 ms** and broadcast p95 **430 ms**. The step from 500 to 1,000 is superlinear in latency (2.7× bid-ack p95 for 2× users) while memory grows only 1.56×.

Concrete sequence:

1. **Instrument the bid path** inside `apps/api/src/worker/room-do.ts` and `packages/room-runtime`: separate storage transaction time, snapshot serialization time, WebSocket send time, and directory-outbox time. Confirm which segment dominates the 1,432 ms p50 at 1,000/50.
2. **Evaluate compact bid/timer deltas if serialization or fan-out dominates.** Include version and changed auction/player/team fields, with full snapshots for join, reconnect and explicit resync. Preserve authorization, order privacy, replay and settlement tests. Measure whether an approved implementation improves latency; no benefit is established yet.
3. **Measure the existing Directory projection coalescing before adding more batching.** Check outbox queue age, flush duration and the membership operations that await delivery. The current successful bid/claim path already avoids waiting for the directory; changing it blindly would not address a proven cause.
4. **After a separately approved optimization, re-run the same 500/25 and 1,000/50 workload in fresh isolated directories.** Compare p50/p95/p99, CPU, peak working set and correctness. Do not raise the 20-member cap. No rerun or optimization is authorized by this closeout.

Success requires lower bid-ack/broadcast latency without new correctness failures, privacy regressions or increased resource use. If the suspected segment does not dominate, use the instrumentation to choose the next change. Any later staging test needs explicit approval; this recovery task does not access or modify staging.

---

## 9. Reproduction commands

These are historical commands, not instructions to rerun during recovery. They target existing evidence and runtime paths. A future approved run must use new isolated state and evidence directories so it cannot overwrite these records.

The runs used the isolated copy at `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-verify` and the runtime directory at `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime`. The runtime contains the local `.dev.vars`, the RS256 private key, and fresh state directories. No secret values are reproduced here.

### 9.1 Four-level ladder

From PowerShell, invoke the script with `&` so the `[int[]]` parameter binds correctly. `powershell.exe -File` passes `100,250,500,1000` as one string and fails parameter conversion.

```powershell
& 'C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-verify\scripts\run-load-test.ps1' `
  -Levels 100,250,500,1000 `
  -DurationMs 40000 `
  -Bids 8 `
  -EvidenceDir 'C:\Users\palli\OneDrive\Desktop\IPL-AUCTION\docs\reports\evidence\AUCTIONARENA-LOAD-TEST'
```

The script starts `wrangler dev` per level with a fresh state:

```text
wrangler dev --config wrangler.jsonc --persist-to <runtime>\level-<users>\state
  --env-file <runtime>\level-<users>\.dev.vars
  --ip 127.0.0.1 --port <8801..8804> --log-level warn
```

### 9.2 Single-room maximum

```powershell
& 'C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-verify\scripts\run-load-test.ps1' `
  -Levels 20 `
  -DurationMs 40000 `
  -Bids 8 `
  -BasePort 8805 `
  -EvidenceDir 'C:\Users\palli\OneDrive\Desktop\IPL-AUCTION\docs\reports\evidence\AUCTIONARENA-LOAD-TEST\single-room'
```

### 9.3 Correctness scenario

Start a fresh `wrangler dev` on port 8810 with a fresh state and the same `.dev.vars` pattern, then run:

```powershell
node scripts/load-auction-correctness.mjs `
  --base=http://127.0.0.1:8810 `
  --key="C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime\clerk-private.pem" `
  --output="C:\Users\palli\OneDrive\Desktop\IPL-AUCTION\docs\reports\evidence\AUCTIONARENA-LOAD-TEST\correctness.json" `
  --mode=quick `
  --lots=2
```

The server invocation is the same as the orchestrator's, with `--port 8810` and `--persist-to <runtime>\state-correctness`.

### 9.4 Integrity and aggregation

```powershell
node --no-warnings scripts/check-load-integrity.mjs <state-dir> <expected-rooms>
node scripts/summarize-auction-load.mjs docs/reports/evidence/AUCTIONARENA-LOAD-TEST
```

The checker writes JSON to stdout and exits non-zero if any problem or error is found. The aggregator writes `load-summary.json` and prints the per-level verdict.

---

## 10. Evidence inventory

Primary evidence, all under `docs/reports/evidence/AUCTIONARENA-LOAD-TEST/`:

| File | Contents |
|---|---|
| `load-100.json`, `load-250.json`, `load-500.json`, `load-1000.json` | Per-level harness measurements: setup, connect, claims, pings, actions, broadcasts, settlement, memory, loop lag, sockets, HTTP statuses |
| `integrity-100.json` … `integrity-1000.json` | Read-only persisted-SQLite checks for every level |
| `load-summary.json` | Aggregate verdict, highest stable users, per-level p50/p95/p99, CPU, memory, integrity |
| `run-manifest.json` | Ports, fresh state paths, start/finish times, exit codes, pass/fail, failures |
| `correctness.json` | 20-user Quick-plan correctness/stress scenario |
| `integrity-correctness.json` | Persisted check of the correctness room |
| `single-room/load-20.json` | Maximum legal single-room load run |
| `single-room/integrity-20.json` | Persisted check of the single-room load run |
| `single-room/run-manifest.json` | Single-room orchestration manifest |
| `SHA256SUMS.txt` | SHA-256 hashes of the evidence files above |

Supplementary runtime artifacts outside the repository:

- `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime\level-<users>\wrangler.out.log` and `.err.log`
- `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime\correctness.out.log` and `.err.log`
- `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime\state-correctness\` (persisted correctness state)
- `C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-verify\` (isolated project copy)

The evidence JSONs contain room codes, synthetic load user IDs, timings, and local paths. They contain no bearer tokens, private keys, `.dev.vars` values, or real user data. A scan for JWT prefixes, `BEGIN ... PRIVATE KEY`, `CLERK_SECRET`, `WS_TICKET_SECRET`, `Authorization`, and `Bearer` found no matches.

---

## 11. What this does not establish

- No Cloudflare production capacity, multi-colo behaviour, Durable Object hibernation at scale, alarm reliability under production scheduling, or cost.
- No claim that 1,000 concurrent users will work in production. The 1,000/50 run is a local workerd measurement with 1,549 ms bid-ack p95.
- No browser, rendering, accessibility, or mobile-device performance claim.
- No Clerk network authentication, R2, or production migration claim.
- No change to auction, bidding, settlement, authorization, or financial rules.

## 12. Codex recovery closeout — 19 November 2026

The saved evidence was checked without rerunning the load tests or changing application code. The working tree, including OpenCode's uncommitted implementation, was the source of truth; HEAD remains `53967a292833c5ba3496fcbba02e8cdb39d446eb`.

| Recovery check | Result |
|---|---|
| SHA-256 inventory | PASS: all 15 listed JSON files match `SHA256SUMS.txt`; every JSON in this evidence folder is covered |
| Manifest and results | PASS: levels, ports, fresh state paths, exit codes and verdicts agree with raw results and persisted-integrity files; the separate 20-user manifest also passes |
| Summary reproduction | PASS: the current aggregator, run only against a private temporary copy, reproduces every field except `generatedAt` |
| Runtime/tool provenance | 34 of 35 inspected source/tool files match the retained isolated run copy byte for byte; only the summary postprocessor differs, and it reproduces the saved results |
| Sensitive-pattern scan | No JWT, private-key, Clerk-secret or bearer-token pattern found in the 15 JSON files; this is a scoped scan, not a universal secret audit |
| Process cleanup | No relevant test/server process or listener on the checked development/load ports; no process was terminated during recovery |
| Protected inputs | All 59 existing `.data/` files and 255 `Assets/` files match the pre-edit recovery baseline; fixtures 139DCB (`WAITING`) and 19B480 (`COMPLETED`) remain present |
| Change hygiene | Documentation only; existing evidence and private environment files unchanged; `git diff --check` passes; index and HEAD unchanged, with no staging, commit or push |

The report now distinguishes individual-delivery broadcast percentiles from per-action maxima, claim attempts from successful claims, and MiB from MB. The correctness room's version increase after shutdown is confirmed as 20 disconnect events. Potential bottlenecks remain hypotheses: directory projections already coalesce, and successful bids do not await their delivery.

The separate Quick 80 correctness run adds local workerd evidence for approval, the first two sold lots and a host-ended third lot. It does not close the browser opening-set/results gaps, planned-pool multi-room load, full-auction coverage or production-runtime verification. The next recommended package is bid-path instrumentation; no optimization or new work package was started here.
