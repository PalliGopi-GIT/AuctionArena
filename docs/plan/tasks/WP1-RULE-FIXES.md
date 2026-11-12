---
id: WP1-RULE-FIXES
title: Correct bid tiers, client deadline timing and private-room access failures
phase: 1
status: complete
paths: [packages/shared, packages/engine, apps/realtime, apps/api, apps/web, tests, scripts, docs]
acceptance:
  - New rooms use +10 below 200 lakh, +20 from 200 through 500 inclusive, and +25 above 500
  - Existing unversioned rooms retain their configured flat increment and accepted prices
  - Server validation, client bid amount, affordability and recovery use the same room-specific ladder
  - Client closes bidding 150 ms early; server still enforces the actual deadline
  - HTTP midpoint and matched ping/pong samples correct client clock offset
  - Missing and inaccessible private rooms have identical public status, code and message
  - ACCOUNT_DELETED terminates polling and reconnects and clears the visible room without a working socket
  - TypeScript, production build, core, local and full browser suites pass with bounded evidence
---

The owner explicitly confirmed the inclusive 500 boundary and legacy-room preservation in conversation on 12 November 2026. This resolves the ambiguity in architecture section 5.8 without changing old auction rules. `bidRule: tiered-v1` is assigned only at new-room creation; absent markers keep the original flat rule. No live database is migrated or rewritten by this task.

Test-first baseline: 25 new cases, 6 passed and 19 failed before implementation. A second privacy expansion added three denied-join cases: 25 passed and 3 failed before that correction. The implemented scope covers wrong/expired invites, completed/full rooms and denied late spectators as well as reads, tickets, actions and invitation rotation. Existing members explicitly blocked by the host retain their known `ROOM_BLOCKED` response; authorization and host-only errors remain enforced.

Final verification: TypeScript and current standalone Vite production build pass; core 164/164, local 76/76 and one full browser run 32/32 pass with no failures/skips/flaky cases. All 34 axe scans have zero reported violations. Both owned test ports are stopped. Evidence: docs/reports/evidence/WP1-RULE-FIXES/validation.json. The standalone final build started after the browser run completed.

New browser cases exercise real two-browser 300→320 bidding, real pong frames, and UI teardown/retry cessation for a deliberately injected ACCOUNT_DELETED HTTP response with WebSockets unavailable. The latter is a client regression, not live Clerk deletion verification. No Clerk fixtures/settings, AWS resources, deployment or SQL migration are involved. Phase 2 has not started.
