---
id: WP1-RECOVERY
title: Verify and repair local room recovery
owner: conductor
reviewers: [review_core]
depends_on: [WP1-LOCAL]
phase: 1
slice: local-core
paths: [apps/web, apps/realtime, packages/shared, packages/engine, tests, scripts, docs, package.json]
acceptance:
  - Reconnect uses a fresh ticket and discards stale room responses
  - Recovered sales reconcile in both directions with squads and budgets
  - Pure domain and local persistence tests run without external dependencies
  - Verification evidence distinguishes local tests from browser and cloud tests
evidence_required: [local-runtime, source-syntax, review]
status: done
---

2026-11-11 conductor: resumed incomplete build. npm registry access returns EACCES; no dependencies installed. Running local domain tests is independent of the blocked UI/API installation.

Contract decision: split dependency-free domain types/data from Zod schemas, retaining all existing index exports. No wire-format or money-rule changes intended.

2026-11-11 conductor: local recovery slice completed. Final evidence: 31 passed / 0 failed in docs/reports/evidence/WP1-RECOVERY/local-tests.json. Source parser passed 11 TypeScript files; TSX/typecheck excluded. Reviewer identified bidirectional sale validation, unaffordable recovery bid, delayed host pause, and offline resume timer inflation; all four have fixes and executable regressions. Full build, original Vitest suite, browser QA and the Phase 1 gate remain blocked by missing dependencies; see docs/reports/BUILD-STATUS.md.
