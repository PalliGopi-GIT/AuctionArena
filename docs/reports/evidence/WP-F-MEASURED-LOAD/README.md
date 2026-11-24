# WP-F measured local load verification

This is new evidence for the uncommitted working tree based on commit `53967a2`, collected on 14 November 2026 local time. Earlier evidence remains unchanged. [summary.json](summary.json) records the criteria and per-level outcomes; [validation.json](validation.json) records the verification checks; [tested-source.json](tested-source.json) records SHA-256 hashes of the six Package F files. No commit was made.

The isolated workspace was `C:\Users\palli\AppData\Local\Temp\auctionarena-wpf-45f0e0db\work`: committed files plus current application/test changes, a dependency junction, no private environment file, and an empty temporary `.data` directory. All six Package F source/test hashes matched the repository working tree at run time. The existing fixtures 139DCB/19B480, private data and earlier evidence were not copied or changed.

## Load results

- `load.json` is the combined report for the final 100/500/1,000-user run. `load-100.json`, `load-500.json` and `load-1000.json` are the same report split per level. `load-run.txt` records the command and console lines; `load-exit.txt` records exit 0.
- `probe-500-ping.json` is the 500-user diagnostic with a 60-second poll interval, effectively disabling polling. `probe-run.txt` and `probe-exit.txt` record its command and exit.
- The 100-user level passed: 100/100 connected, zero errors, ping p95 8.31 ms, poll p95 24.30 ms, 5/5 broadcasts completed, delivery p95 131.25 ms.
- The 500-user level failed: 500/500 connected, 1,093 errors, ping p95 9,576.39 ms, poll p95 18,004.65 ms, 7/25 broadcasts completed, delivery p95 9,347.08 ms.
- The 1,000-user level failed: 1,000/1,000 connected, 2,917 errors, ping p95 14,780.25 ms, poll p95 8,975.05 ms, 0/50 broadcasts completed.
- The 500-user ping-only diagnostic failed: ping p95 14,168.41 ms, 155 ping errors, 9 poll errors, 25/25 broadcasts completed but delivery p95 25,992.31 ms. The local limit is not caused only by the 2-second poll rate.
- The intended steady-state window was 10 seconds; measured windows were 10.1 s at 100 users, 40.1 s at 500 and 32.2 s at 1,000, with 31.1 s in the probe. The stretch is a symptom of event-loop and request contention, not a longer test.

Error samples are `pong timeout`, `TypeError: fetch failed` and request timeouts. All sockets connected before the steady-state window; failures occurred under load.

## Regression checks

- `core.json`: 259/259 tests passed in 19 files, zero failed or skipped. `core-exit.txt` records exit 0. `core-output.txt` is the raw runner output.
- `local/local-tests.json`: 76/76 local tests passed, zero failed or skipped. `local/local-exit.txt` records exit 0. `local/run.log` is the same report.
- `browser/`: 34 passed, 0 failed, 0 skipped, 0 flaky, 0 global errors. 34 axe scans, 0 violations and 28 incomplete rule entries. `browser/exit.txt` records exit 0.
- `a11y/`: 4 passed, 0 failed, 0 skipped, 0 flaky, 0 global errors. 32 axe scans, 0 violations and 26 incomplete rule entries. `a11y/exit.txt` records exit 0.
- `typecheck.log` is empty because TypeScript passed; `typecheck-exit.txt` records exit 0.

The incomplete axe entries need human assessment and are not violations or a conformance claim. Browser and accessibility runs exercise the unchanged local Node runtime, not the Worker or Durable Objects.

## Limits

The load harness runs the single-process local Node runtime with file-backed JSON state, not Cloudflare Workers, Durable Objects or SQLite-backed object storage. Client and server share one 12-logical-CPU, 16 GB Windows machine, so CPU, disk and event-loop contention are not representative of Cloudflare placement. The local runtime caps a room at 20 members and a host at 10 active rooms. The workload covers steady-state socket liveness, 2-second polls and one host action per room, not full bidding, chat, history paging or reconnect storms. The 100-user pass is a measured local result for this workload, not a capacity guarantee. No 500- or 1,000-user capacity and no Cloudflare capacity is claimed.

`wrangler` and Miniflare were unavailable offline, so `wrangler.jsonc`, the `ROOM`/`DIRECTORY` bindings, SQLite-backed object storage, hibernation, alarm delivery and the 101 upgrade were not executed. No deployment, account setting, cloud resource, R2 activation, credit card charge or production migration was created.
