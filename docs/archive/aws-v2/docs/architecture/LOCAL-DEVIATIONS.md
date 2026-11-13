# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

# Local implementation boundary

The master architecture remains the target. This first runnable build proves a local vertical slice; it does not replace that target or pass its production gate.

| Target | Local implementation | Release implication |
| --- | --- | --- |
| AWS DynamoDB item-per-entity transactions | File-backed state in one Node service | One writer process only; no multi-instance safety claim |
| Redis leases plus DynamoDB fencing | Local serialized operations | Distributed stale-owner protection remains unimplemented |
| uWebSockets.js realtime service | Local Node transport / HTTP confirmed snapshots | Production transport, distributed fan-out, and backpressure require separate work |
| Durable timer wheel and elected sweeper | Local scheduler and persisted deadline | Process restart tests do not prove AWS failover |
| Aurora projections and immutable archive | Local room persistence | SQL schema supplied; migration and archive consumer not connected or tested |
| Clerk production identity | Clerk integration plus explicit local developer sessions | Local sessions are not production accounts; disable outside local development |
| CDK full service deployment | Data/network foundation | No AWS resources or public endpoint deployed |
| pnpm/Turbo workspaces | Root package scripts and source package boundaries | Workspace orchestration is unfinished |
| Replay returns the original stored acknowledgement | Local receipts retain request fingerprints and return the current confirmed room | Duplicate accepted actions cannot execute twice, but original acknowledgement replay remains unfinished |
| Per-entity commits and delta event fan-out | Atomic whole-file snapshots and whole-room WebSocket snapshots | Write amplification and snapshot traffic are local development limits; distributed adapters remain unimplemented |

Only fictional players and teams are intended for this build. Budgets are integer lakhs and virtual only. No payment feature is present.

Any final report must distinguish unit/in-process tests, local network tests, browser tests, and actual deployed service tests. The master architecture's 10k, 100k, and 1M stages are targets, not measured capacity. Phase 2/3 work must not be represented as a passed Phase 1 gate.
