# WP-D room Durable Object verification

This is new evidence for the working tree based on commit `53967a2`, collected on 13 November 2026 local time. Earlier evidence remains unchanged. [validation.json](validation.json) summarizes exact outcomes and [tested-source.json](tested-source.json) records SHA-256 hashes of the four WP-D files from the isolated verification copy. No commit was made during this task.

The isolated workspace was `C:\Users\palli\AppData\Local\Temp\auctionarena-wpd-d43a0750cd70402eba3c566c3db851bf\work`: committed files plus current application/test changes, a dependency junction, no private environment file, and an empty temporary `.data` directory. The four D source/test hashes matched the repository working tree at run time. The existing fixtures 139DCB/19B480, private data and earlier evidence were not copied or changed.

- `core.json`: final 230-test Vitest result in 40 suites, including the 16 new room Durable Object tests. The baseline was 214 tests after Package C.
- `local/`: final 76-test local result and TAP output. The unchanged runner's historical task label is retained.
- `browser/`: 34-case regression result, production build/server log and 34 axe scans. No retries or failures.
- `a11y/`: separate four-case accessibility result, server/build log and 32 axe scans. No retries or failures.
- `typecheck.log` is empty because TypeScript passed; `typecheck-exit.txt` records exit 0.

The D tests exercise one room per object with SQLite-backed state through a fake Durable Object state: creation and invite hashing, private missing/malformed responses, joining and invite rotation, authorized state/history/sync, action idempotency across a new object instance, reused IDs and stale versions, transactional lot settlement and result advance, retried alarms on the same and a new instance, host-absence pause and resume, wake recovery, leave/revocation, hibernating socket acceptance and broadcast, ping/pong, disconnect events, socket attachment after wake, and rejected upgrades. They do not run in the Workers runtime.

`wrangler` and Miniflare were unavailable offline, so `wrangler.jsonc`, the Durable Object binding, SQLite-backed storage, actual hibernation, alarm scheduling and the 101 upgrade were not executed. The browser and accessibility runs exercise the unchanged local Node runtime, not the Worker or room object. Cross-room discovery, archive, deletion and export are Package E; capacity is Package F. No deployment, account setting, cloud resource or production migration was created.
