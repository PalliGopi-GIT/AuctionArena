# WP-E cross-room directory verification

This is new evidence for the uncommitted working tree based on commit `53967a2`, collected on 13 November 2026 local time. Earlier evidence remains unchanged. [validation.json](validation.json) summarizes exact outcomes and [tested-source.json](tested-source.json) records SHA-256 hashes of the twelve WP-E files from the isolated verification copy. No commit was made during this task.

The isolated workspace was `C:\Users\palli\AppData\Local\Temp\auctionarena-wpe-06503ed37e3d4f1787319bba1aab7cff\work`: committed files plus current application/test changes, a dependency junction, no private environment file, and an empty temporary `.data` directory. All twelve E source/test hashes matched the repository working tree at run time. The existing fixtures 139DCB/19B480, private data and earlier evidence were not copied or changed.

- `core.json`: final 259-test Vitest result in 19 test files, including 29 new cross-room tests. The baseline was 230 tests after Package D.
- `local/`: final 76-test local result and TAP output. The unchanged runner's historical task label is retained.
- `browser/`: 34-case regression result, production build/server log and 34 axe scans. No retries or failures.
- `a11y/`: separate four-case accessibility result, server/build log and 32 axe scans. No retries or failures.
- `typecheck.log` is empty because TypeScript passed; `typecheck-exit.txt` records exit 0.

The 29 new tests cover: a global SQLite directory projection with privacy-minimised discovery; version-guarded, idempotent upserts that discard stale room snapshots; blocked-member exclusion; immutable completed-room archives available only to participants; account export without other participants' identities; immediate denial and idempotent completion of deletion; resistance to a delayed snapshot re-adding a deleted member; deletion discovery through former members and history authors; sole-member room removal across a file-backed restart; the directory Durable Object's internal-header check and routes; the room object's durable coalescing outbox, serialized flushes, permanent-error discard and user-deletion fan-out; and Worker `/api/me`, `/api/me/export`, `DELETE /api/me`, provider failure, room fan-out failure, missing bindings and dependency errors.

These tests use in-process fakes, `node:sqlite` and fake Durable Object state. They do not run in the Workers runtime.

`wrangler` and Miniflare were unavailable offline, so `wrangler.jsonc`, the `ROOM`/`DIRECTORY` bindings, SQLite-backed object storage, actual hibernation, alarm delivery and the 101 upgrade were not executed. The browser and accessibility runs exercise the unchanged local Node runtime, not the Worker or the directory object. Package F measured load is not included. No deployment, account setting, cloud resource, R2 activation or production migration was created.
