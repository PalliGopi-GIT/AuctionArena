# WP-B storage ports and SQLite parity

Scope: transition package B, authorized by the owner's continuation on 13 November 2026. It defines a per-room storage port, adapts the existing room runtime and legacy file store to it, and proves local parity. It does not implement Workers, Durable Objects, alarms, cross-room queries or a deployment.

## Implemented

- `packages/storage/src/port.ts` defines one-room `RoomStorage`: detached reads and a synchronous atomic `transaction(update)`. An exception rolls back every write; omitting `next`, returning `undefined`, or returning a promise throws. A storage instance cannot change `room.code` or move `room.version` backwards.
- `MemoryRoomStorage` is the ephemeral reference adapter. It clones on read and write, bounds history and receipts in the same commit, and never exposes committed references.
- `SqliteRoomStorage` stores one room in schema v1: `room_schema`, `room_state` (financial/lobby state without history), `room_events` (retained history by version) and `room_receipts` (receipts by insertion ordinal). State, events and receipts are written in one transaction. Unknown schema versions are refused before writing.
- `NodeSqliteDriver` uses Node 22 `node:sqlite` with WAL, full synchronous durability and `BEGIN IMMEDIATE`. It is a local parity adapter, not a production adapter.
- `packages/room-runtime/src/record.ts` keeps the shared authorization, receipt, version and bounding rules. `packages/room-runtime/src/recovery.ts` now also exports `recoverRoomOnWake`: disconnect members, settle an elapsed deadline, and pause a still-open lot instead of resuming it silently.
- `apps/realtime/src/store.ts` uses the shared wake transition. Its file format, authorization, heartbeat batching, account lifecycle and broadcasts are unchanged.
- `packages/storage/README.md` documents the port, schema and the Durable Object mapping (`ctx.storage.transactionSync` + `ctx.storage.sql.exec`). All port operations stay synchronous, so no `await` is required or permitted inside a change.

## Parity and failure tests

`tests/core/room-storage.test.ts` drives memory, in-memory SQLite and file-backed SQLite against the legacy file store:

- A full auction (claims, readiness, start, bid, duplicate bid, pause, resume, settlement, next lot, host end) matches the legacy room, history and receipts after every step.
- A fault injected at every SQL write boundary rolls back state, events and receipts; a later attempt still succeeds.
- Retried actions are idempotent before and after a database reopen; reused IDs with different content are rejected.
- Stale and future expected versions are rejected without mutation.
- Receipts are evicted at the cap; the evicted action is rejected as stale and is not re-executed. The legacy store reaches the same result.
- New unversioned actions stop at 4,096 legacy receipts; versioned actions continue.
- Room identity changes and backwards versions are refused.
- A live room recovers on wake exactly like the file store; an elapsed deadline settles instead of pausing.
- History is bounded to 1,000 events, the truncation marker survives a reopen, and stale event rows are deleted.
- Unknown schema versions are refused without rewriting data; legacy receipts survive history redaction.

## Verification

Final results and evidence are recorded in [build status](../../reports/BUILD-STATUS.md) and `docs/reports/evidence/WP-B-STORAGE-PORTS/`. Verification runs in an isolated source copy with a dependency junction, no private environment file and temporary data. Browser and accessibility suites run against the local HTTP/WebSocket runtime only.

## Limits and next gate

The port proves local transaction, retry, eviction and recovery behavior. It does not prove Cloudflare transaction semantics, alarm retries, hibernation, multi-object coordination or capacity. `idFromName` routing, room existence, authorization and private/nonexistent-room equivalence remain package C responsibilities. The Durable Object adapter, one-alarm-slot scheduling, duplicate alarm handling and transactional settlement under wake remain package D responsibilities. Cross-room index, archive, deletion and export remain package E. No deployment, cloud resource, R2 activation, cost or production migration is authorized.
