# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

---
id: WP1-ACCOUNT-LIFECYCLE
title: Add unique application names, verified webhooks and durable account deletion
owner: conductor
phase: 1
depends_on: [WP1-CLERK-PROFILES, WP1-DEPENDENCY-HARDENING]
paths: [apps/api, apps/realtime, apps/web, packages/shared, packages/engine, scripts, tests, docs]
acceptance:
  - Verified subjects own profile mutations; account-switch assertions never become an identity source
  - Custom names normalize compatibility/whitespace and reject case-insensitive conflicts
  - Signed provider updates preserve custom names and reject stale deliveries
  - Fresh verified first-factor age is required before a Clerk deletion request
  - Durable deletion jobs immediately deny access and tickets, close sockets and retry across restarts
  - Cleanup anonymizes shared results without changing accepted prices, squads or budgets
  - Departed/renamed participants and legacy identity prose are covered by cleanup
  - UI, core/local/browser checks and live verification boundaries are recorded honestly
evidence_required: [typecheck, core-tests, local-tests, browser-tests, signed-webhook-tests, live-clerk]
status: in_review
---

Implementation is present in the single-process development adapter. Eighteen new backend tests pass, including actual Clerk SDK signature verification, reauthentication claims, name claims, stale webhook ordering, deletion retry/restart, old-ticket denial, socket closure, departing/renamed participants and accepted-sale reconciliation. The older provider-name test now expects a distinct collision label while still asserting unchanged verified-subject ownership and host authorization.

The local implementation is verified: TypeScript/build, 110 core, 76 local and all 28 browser cases pass. Matrix/profile axe scans total 34 with zero reported violations. Early new test selectors were corrected before the clean full run. Both owned servers are stopped. Evidence is in WP1-ACCOUNT-LIFECYCLE/validation.json and review.md. No completed live Clerk fixture has been changed or replayed. The task stays in review because live provider webhook delivery, account deletion and real challenges still require host checks. The user explicitly requires approval before new Clerk test accounts or settings changes; local cryptographic tests do not establish those live passes.

Deletion returns 202 after a durable job is committed; the background worker calls Clerk, then anonymizes shared records and removes sole-member rooms. An external deletion of an active host ends that room through the existing engine, settling an accepted leading bid once. A voluntary deletion requires the host to end/close active rooms first. These are development-adapter semantics; the distributed user store/worker remains pending AWS work.
