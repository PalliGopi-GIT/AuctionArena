# WP2 local storage and message bounds

Scope: transition package A only, authorized by the owner's continuation on 13 November 2026. The existing single-process local runtime stays in use. Storage ports and the Cloudflare runtime are separate later packages.

## Implemented behavior

- Connected-member heartbeats update presence in memory. The scheduled sweep batches pending presence writes at one-second intervals; authoritative actions and connection-state changes still persist immediately. A restart disconnects members as before.
- Persist the most recent 1,000 history events per room. Keep accepted prices, squads, budgets and result state independently of event retention. Expired activity is not an archive; the history screen explains retention.
- The current client submits the room's `expectedVersion`. Retain 1,024 versioned action receipts per room. A duplicate with a retained receipt is deduplicated; an evicted retry with its original version is rejected without another mutation. Stale actions require the user to review current state; they are not silently retried with a new version.
- Preserve existing unversioned receipts to protect old accepted actions. Refuse new unversioned actions once there are 4,096 legacy receipts, with `CLIENT_UPDATE_REQUIRED`; versioned clients can continue. Historical databases already above this legacy cap retain those records. This is an explicit exception to the receipt bound.
- HTTP and socket room snapshots contain at most 100 recent events and omit blocked members who have no team attribution. A snapshot over the 128 KiB budget (including reserved envelope space) is refused rather than truncating financial state. Socket backpressure remains in place.
- Authorized `/history` requests page at most 100 events using an exclusive version cursor. `/sync?afterVersion=` returns a bounded authoritative snapshot and retained events, or a reset marker for expired/future/oversized replay. The client resumes with its latest room version. This uses bounded snapshots, not state deltas.
- The history UI holds one page, offers older/latest navigation and ignores responses after room/identity changes. Inaccessible private and nonexistent history/sync routes return equivalent privacy errors.

## Verification

Evidence and exact final results are recorded in [build status](../../reports/BUILD-STATUS.md) and the new `docs/reports/evidence/WP2-LOCAL-BOUNDS/` directory. Validation runs in an isolated source copy with temporary data and development identities; existing fixture/data/evidence directories are not used as test data.

Final result: typecheck and production build PASS; 174 core, 76 local, 34 browser and 4 separate accessibility cases PASS, with zero failures/skips/flaky cases. Full browser axe recorded 34 scans with zero violations; the separate accessibility run recorded 32 scans with zero violations. Incomplete rules and human/device accessibility remain open. The implementation is uncommitted.

New tests cover batched heartbeat commits, more than 1,000 real actions, receipt eviction, file recovery, legacy deduplication/caps, cursor paging and reset, access checks, snapshot bytes, result attribution and desktop/mobile history navigation. Existing engine, auth, room, timing, privacy and account-deletion suites remain required.

## Limits and next gate

These are per-room bounds, not a bound on all rooms, sessions, profiles, moderation records or the whole database. The local store still clones the database and writes one file, and snapshots still send current room state. Neither production throughput nor concurrent-user capacity is established. Global retention/archive, storage ports, SQLite transactions, Workers, Durable Objects, hibernation and alarms remain unimplemented. R2 remains off. Do not start package B or deploy without the owner's next instruction.
