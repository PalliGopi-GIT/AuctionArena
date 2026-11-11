---
id: WP1-OWNERSHIP-CORE
title: Implement provider-independent room ownership coordination
owner: realtime
reviewers: [architect, reliability, security]
phase: 1
depends_on: [WP1-DISTRIBUTED-RUNTIME]
paths: [apps/realtime/src/ownership.ts, packages/testkit/src/ownership-simulator.ts, tests/core/ownership.test.ts, docs]
acceptance:
  - Concurrent acquisitions elect one owner in an atomic lease/fence model
  - Epoch and version conditions reject stale writers and conflicting proposals
  - Local lease expiry, renewal loss and explicit release stop admission
  - Late I/O cannot revive a released owner or acknowledge uncertain writes
  - An accepted engine bid preserves its deadline and settles once after simulated handover
  - No AWS adapter, deployment or production reliability claim is implied by model tests
status: in_review
---

2026-11-12: Split the provider-independent coordinator from WP1-DISTRIBUTED-RUNTIME so useful local implementation can proceed while the required AWS MCP skills/tools remain unavailable. This waives the parent dependency only for this local slice; service adapters remain gated on toolkit guidance. No public protocol or engine rule changes are included.

The coordinator exposes atomic lease/fenced-write ports, unique acquisition tokens, monotonic request-start lease bounds, serialized proposals, synchronous demotion callbacks and explicit uncertain-write handling. It confirms the lease after claiming an epoch. Failed acquisition releases only its own token. Committed responses never cause an automatic retry; callers must rehydrate after conflicts and use durable idempotency for uncertain outcomes.

The testkit models atomic conditions in memory and injects clock changes, lost lease keys, delayed I/O and response loss. It is test-only, has no persistence and is not imported by production code. The real-engine scenario models accepted bidding, expired-owner handover, stale direct transaction rejection and a single sale with reconciled budget/squad. This is not a real datastore integration test or a cloud drill.

Before application wiring: implement and verify real item-per-entity adapters, idempotency replay, durable timers/outbox, recovery validation and scheduled renewals. Stop timers/close sockets through onLost. Reads, joins, account projections and every other mutation must use the same durable fence. Independent architecture/security/reliability review and actual integration/drill evidence remain required.

2026-11-12: Implementation moved to in_review after TypeScript, production build, 130 core tests (20 ownership cases) and 76 local tests passed with zero failures/skips. Evidence: [validation](../../reports/evidence/WP1-OWNERSHIP-CORE/validation.json), [core result](../../reports/evidence/WP1-OWNERSHIP-CORE/core-results.json), [review boundary](../../reports/evidence/WP1-OWNERSHIP-CORE/review.md). Browser tests were not rerun: the module is not imported by the running application. This status is not an independent approval or completion of the distributed runtime.
