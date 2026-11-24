# Storage ports

One room per storage instance. The port is intentionally small so the local
adapters and the Cloudflare Durable Object use the same room-runtime code.

## Guarantees

- `read()` returns a detached copy; callers cannot mutate committed state.
- `transaction(update)` is a synchronous read/modify/write. The update receives a
  detached current value and returns `{ next, result }`. Returning `null` deletes
  the room; omitting `next`, returning `undefined`, or returning a promise throws.
- An exception anywhere in the update or the write rolls back every table. The
  caller acknowledges only after `transaction` returns.
- Committed room identity cannot change and `room.version` cannot move backwards.
- History is bounded to `HISTORY_LIMIT` events and versioned receipts to
  `RECEIPT_LIMIT`; legacy unversioned receipts are preserved. Bounding happens in
  the same commit, so an evicted action is rejected by its stale expected version
  rather than re-executed.

## Adapters

| Adapter | Use |
| --- | --- |
| `MemoryRoomStorage` | Tests and ephemeral single-process use. Not durable. |
| `SqliteRoomStorage` + `NodeSqliteDriver` | Local parity tests on Node 22 `node:sqlite`. Not a production adapter. |
| Durable Object adapter (package D) | `ctx.storage.transactionSync` plus `ctx.storage.sql.exec`. |

## Durable Object mapping

`SqlDriver` maps to the Durable Object SQLite API without changing the room
runtime:

```ts
const driver: SqlDriver = {
  all: (query, ...bindings) => ctx.storage.sql.exec(query, ...bindings).toArray(),
  run: (query, ...bindings) => { ctx.storage.sql.exec(query, ...bindings).toArray(); },
  transaction: callback => ctx.storage.transactionSync(callback),
};
```

All three methods are synchronous, which is what `transactionSync` requires.
One Durable Object instance owns one room database; `idFromName(code)` only
derives the object ID. Room existence, membership and invitation checks stay in
the runtime and must be evaluated before any write.

## Schema v1

`room_schema` stores the schema version. `room_state` stores financial/lobby
state without history, `room_events` stores retained history keyed by version,
and `room_receipts` stores action receipts with an insertion ordinal. Opening a
database with a different schema version throws before any write.
