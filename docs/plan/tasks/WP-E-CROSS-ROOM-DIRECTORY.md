# WP-E cross-room directory, archive, deletion and export

Scope: transition package E, continuing the owner's authorized sequence on 13 November 2026. It adds cross-room discovery, an indexed room projection, immutable result archives, account export and account deletion. It does not add D1, R2, another provider, a deployment or any cloud resource. Measured 100/500/1,000-user load is Package F.

## Design decision

Room-local SQLite remains authoritative for live auction state and settlement. A room database cannot answer "which rooms does this user belong to?" or "what happened in all of this user's auctions?", so Package E adds one global SQLite-backed `DirectoryDurableObject`, addressed as `idFromName('global')`. It is an eventually consistent projection, not a second live-state writer.

- A room object writes a directory update into a durable `room_directory_outbox` inside the same synchronous storage transaction that changed the room. The projection therefore cannot commit a room change without a durable intent to publish it.
- Upserts carry the room version. The directory ignores a snapshot older than the indexed version, so a delayed retry cannot move discovery backwards.
- The outbox keeps only the newest row per room. Flushes are serialized, so a later `remove` cannot be overtaken by an in-flight stale `upsert`.
- A permanent `4xx` response discards that outbox row; `5xx` and transport failures retain it for a later request or alarm. There is no separate background drainer.
- The directory is written only through internal headers (`X-Auction-Internal: room` or `worker`); it is not a public endpoint.
- Deletion writes a `dir_deleted_users` marker before any fan-out. Reads filter that marker even when a delayed room snapshot still names the user, so deletion cannot be undone by stale delivery.
- Archives are immutable, keyed by `code:version`, and contain results only. They do not contain member IDs, names, bids or chat/history.

## Implemented

- `packages/directory/src/index.ts` implements `SqliteRoomDirectory` with `dir_schema`, `dir_rooms`, `dir_memberships`, `dir_participants`, `dir_archives`, `dir_archive_members`, `dir_deletion_jobs` and `dir_deleted_users`.
- `upsertRoom` filters blocked and deleted members, replaces memberships, records participants (current members, blocked IDs, history authors and supplied former participants), and archives an ended room once.
- `listRooms` returns privacy-minimised listings with the caller's role and no host or member identities. `archives` returns immutable result records only to recorded participants. `exportUser` returns the caller profile, listings and archives.
- `removeRoom` deletes only at or beyond the indexed version. `requestDeletion` marks the account deleted immediately and creates a durable job; `markProviderDeleted`, `retryDeletion` and `completeDeletion` are idempotent. Completion removes memberships, participants and sole-member rooms, and is safe to replay.
- `packages/room-runtime/src/deletion.ts` anonymizes one user in one persisted room: a sole member removes the room; a live host ends the auction; member/team/host references are replaced by a stable anonymous ID; authored history is redacted while accepted sales, squads and budgets are preserved; that user's action receipts are removed.
- `apps/api/src/worker/room-do.ts` adds the outbox, `enqueueDirectory`/`flushDirectory`, index publication after create, join, action, invite, alarm and wake recovery, and `POST /internal/users/:id/delete`. It reports `{removed, missing}` so a retry can finish directory cleanup after a room was already removed. Index payloads strip event history.
- `apps/api/src/worker/directory-do.ts` wraps the directory in a Durable Object with internal room upsert/remove/archive, user rooms/export/deleted, and deletion request/provider/retry/complete routes.
- `apps/api/src/worker/directory.ts` is the Worker-side client. `apps/api/src/worker/app.ts` adds `GET /api/me`, `GET /api/me/export` and `DELETE /api/me`.
- `DELETE /api/me` requires a typed `DELETE MY ACCOUNT`, a first factor no older than five minutes when reverification is enabled, no active hosted room, provider deletion before room fan-out, and directory completion after all rooms succeed. Failures return `502 DELETION_INCOMPLETE` and leave a retryable job.
- `wrangler.jsonc` adds the `DIRECTORY` binding and a `v2` `new_sqlite_classes` migration. `apps/api/src/worker/index.ts` exports both Durable Object classes.

## Tests

The final core run has 259 tests, 29 more than Package D's 230:

- `tests/core/room-directory.test.ts` (9): membership discovery without host identity; stale projection rejection and version-guarded removal; blocked-member exclusion; immutable completed-room archives limited to participants; export without other identities; immediate denial and idempotent deletion; delayed-snapshot resistance; deletion discovery after a member left but history names them; sole-member removal across a file-backed restart.
- `tests/core/directory-durable-object.test.ts` (5): internal-header rejection; upsert/list/export/remove routes; archive-only-when-ended and immutability; deletion request/provider/retry/complete idempotency; malformed input and unknown-route JSON errors.
- `tests/core/worker-directory.test.ts` (9): privacy-minimised `/api/me` and no-directory fallback; caller-only export with download headers; typed confirmation, fresh first factor and active-host refusal; provider deletion, room fan-out and completion; sole-member room removal; provider-failure retry; room-failure retry; missing directory/provider refusal; dependency-error mapping.
- `tests/core/room-durable-object.test.ts` (6 new, 22 total): outbox indexing without history; failed-delivery retention and wake flush; permanent-error discard; member anonymization plus redacted indexing; sole-member room removal plus directory removal; missing-room report for retried deletion.

The tests use in-process fakes, `node:sqlite` and fake Durable Object state. They do not run in the Workers runtime.

## Verification

The final isolated run used a temporary source copy with a dependency junction, no private environment file and an empty temporary `.data` directory. Results and evidence are in `docs/reports/evidence/WP-E-CROSS-ROOM-DIRECTORY/` and [build status](../../reports/BUILD-STATUS.md). TypeScript passed; the core suite passed 259 tests (29 new) in 19 test files; the local suite passed 76. The browser regression passed 34 cases and the separate accessibility suite passed 4, with zero failures, skips or flaky cases. Browser axe recorded 34 scans and accessibility 32, both with zero violations; 28 and 26 incomplete rule entries respectively still need human assessment. All twelve E source/test files matched the repository working tree by SHA-256. Browser and accessibility runs exercise the unchanged local Node runtime, not the Worker or directory object.

## Limits and next gate

- `wrangler` and Miniflare were unavailable offline, so the actual Workers runtime, `ROOM`/`DIRECTORY` bindings, SQLite-backed object storage, hibernation, alarm delivery and the 101 WebSocket upgrade were not executed.
- The directory is a single global object and a potential write bottleneck. No multi-object directory sharding, measured throughput or capacity claim exists.
- Delivery is eventually consistent. A just-completed room may be missing from discovery or export until the outbox flush succeeds. There is no dedicated drainer; a `5xx` or transport failure waits for later room activity or an alarm.
- A provider-deleted account whose room fan-out fails cannot self-retry because the Clerk identity is gone. The durable deletion job and pending-room list require an operator replay.
- The deletion fan-out is sequential per room and has no batch or queue. A user in many rooms can make the request long.
- Archives are privacy-minimised results, not a full audit log, backup or legal hold. They are immutable per code and version.
- Socket tickets, room authorization and settlement remain as Packages C and D; this package does not change their guarantees.
- No deployment, account or setting change, R2 activation, cost or production migration is authorized. No capacity claim is made.

Next gate: Package F measured local load at 100, 500 and 1,000 concurrent users, with explicit limits and no deployment or cost.
