# WP-D room Durable Object, hibernation and alarms

Scope: transition package D, continuing the owner's authorized sequence on 13 November 2026. It adds the one-room-per-object Durable Object, SQLite-backed authoritative state, hibernating WebSockets, one alarm slot and wake recovery. It does not add cross-room discovery, archive, deletion, export, a deployment or any cloud resource.

## Implemented

- `apps/api/src/worker/room-do.ts` implements `RoomDurableObject`. One object owns one room; room state, recent events, receipts and invite metadata live in SQLite through the Package B `SqliteRoomStorage` port. Memory is only a cache between requests.
- Every mutation runs inside `ctx.storage.transactionSync`. Action application uses `applyStoredAction`, and deadline/result/host-presence work uses `advanceRoom`, so state and receipts commit together or roll back together. Duplicate action IDs return the stored result; a changed fingerprint is rejected as `ID_REUSED`.
- The constructor uses `blockConcurrencyWhile` to run `validateRoomRecovery` and `recoverRoomOnWake`. A live lot is paused on wake with `Service restarted; host must resume`; members must re-establish presence. The recovered room is persisted in the same transaction.
- One alarm slot is computed by `nextAlarmAt`: the live lot deadline, the result advance time, or the host-absence check, whichever is due first. Alarms call `advanceRoom` transactionally and reschedule from the persisted state, so a retried alarm cannot settle or advance twice.
- WebSockets use `ctx.acceptWebSocket(server, [userId])`, a serialized `{userId, name}` attachment, `webSocketMessage`, `webSocketClose` and `webSocketError`. Broadcasts send room snapshots, close revoked or attachment-less sockets, and close slow connections with `1013`. Ping frames are answered without a persistence write.
- `POST /api/rooms` creates a room and returns a 32-byte invite token. Only the SHA-256 hash and a 24-hour expiry are stored; create and invite rotation return the raw token once. A second create for an allocated code returns `409 ROOM_EXISTS`.
- Join, state, history, sync, actions, invite and socket routes enforce membership. Missing, non-member, malformed and mismatched room probes return the same private `404 ROOM_NOT_FOUND` body and message without room state. `leave` revokes the member and returns `{left:true}`.
- `wrangler.jsonc` declares the Worker entry, the `ROOM` binding, a `new_sqlite_classes` migration for `RoomDurableObject`, `nodejs_compat`, the built `ASSETS` directory and observability. `apps/api/src/worker/index.ts` exports the object alongside the Worker `fetch` handler.
- History paging and reconnect replay reuse the shared bounds: 100 events per page, `nextBefore`, snapshot/replay reset when the cursor is outside retained history or the payload exceeds 124 KiB.

## Tests

`tests/core/room-durable-object.test.ts` has 16 cases:

- Create one room, return an invite, persist only its SHA-256 hash, and serve authorized state.
- Refuse a second create for an allocated code.
- Keep missing, non-member, malformed and mismatched probes private without leaking room state or opening sockets.
- Join with the current invite, reject a wrong invite and hide the room.
- Apply actions idempotently across a new object instance, reject reused IDs with changed content, and reject stale expected versions while returning current state.
- Start an auction, settle on an alarm, advance the next lot, and retry the same alarm without a version change.
- Retry an alarm idempotently after a new object instance while a result is pending.
- Pause a live room when the host is absent and resume after reconnect.
- Recover a persisted live room on wake, disconnect members and pause the lot.
- Rotate the invite, invalidate the old link and refuse non-hosts.
- Page history and replay events with the same bounds as the local store.
- Leave the lobby, revoke the member and preserve the host room.
- Accept a hibernating socket, broadcast snapshots, answer pings and record a disconnect.
- Survive hibernation with the socket attachment and existing connections.
- Reject socket upgrades without membership, a matching room or an upgrade header.
- Map malformed bodies, missing identity and invalid settings to JSON errors.

The fake Durable Object state uses `node:sqlite`, `transactionSync` emulation, fake alarms and socket doubles. These are integration tests of the object logic, not a Workers runtime test.

## Verification

The final isolated run used a temporary source copy with a dependency junction, no private environment file and an empty temporary `.data` directory. Results and evidence are in `docs/reports/evidence/WP-D-ROOM-DURABLE-OBJECT/` and [build status](../../reports/BUILD-STATUS.md). TypeScript passed; the core suite passed 230 tests (16 new) in 40 suites; the local suite passed 76. The browser regression passed 34 cases and the separate accessibility suite passed 4, with zero failures, skips or flaky cases. Browser axe recorded 34 scans and accessibility 32, both with zero violations; 28 and 26 incomplete rule entries respectively still need human assessment. Browser and accessibility runs exercise the unchanged local Node runtime, not the Worker.

## Limits and next gate

- `wrangler` and Miniflare were unavailable offline, so the actual Workers runtime, Durable Object binding, SQLite-backed storage, hibernation, alarm delivery and 101 WebSocket upgrade were not executed. `wrangler.jsonc` and the binding remain unverified.
- The tests use a fake state; they do not prove Cloudflare transaction isolation, alarm scheduling, eviction behavior or multi-room scheduling.
- One alarm slot is intentional. There is no queue, no distributed lock and no cross-room scheduler.
- A wake disconnects all members and pauses a live lot. The host must reconnect and resume; automatic resumption is not implemented.
- Socket tickets are issued by the Package C Worker, expire after 30 seconds and are replayable within that window. The object rechecks membership on every request and socket event.
- Cross-room discovery, index, archive, deletion and export are Package E. Measured 100/500/1,000-user load is Package F.
- No deployment, account or setting change, R2 activation, cost or production migration is authorized. No capacity claim is made.
