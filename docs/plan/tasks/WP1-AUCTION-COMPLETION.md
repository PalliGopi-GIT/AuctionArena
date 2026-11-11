---
id: WP1-AUCTION-COMPLETION
title: Explain automatic auction completion and unavailable bids
owner: conductor
depends_on: [WP1-E2E]
phase: 1
paths: [packages, apps, tests, scripts, docs]
acceptance:
  - Stop before opening another lot when no participating non-full team can afford any upcoming base price and its reserve
  - Persist completion_reason and display it in results
  - Distinguish exhausted pool, full squads, unaffordable players, host end and pre-start close
  - Settle accepted bids before completion and preserve unauctioned outcomes
  - Show accessible bid explanations using shared purchase rules
  - Preserve old saved results without fabricating a completion reason
evidence_required: [local-tests, core-tests, browser-results, typecheck, build]
status: done
---

Architecture sections 5.8 and 5.10 govern the reserve and completion behavior. Completion is evaluated at the existing next-lot boundary: automatic mode waits for the result-display interval; manual mode waits for host advancement. A more expensive next player does not end an auction when a cheaper player later in the pool remains affordable.

Participating teams have an owner who has not been blocked. Full and unclaimed teams cannot keep a financially exhausted room open. Disconnected owners still count. Overseas eligibility remains a separate bid restriction and is not mislabeled as a financial completion reason.

The optional completion_reason field preserves compatibility with older local files. New results retain the reason; recovery rejects unknown or nonterminal reason fields. Host end settles a live or paused leading bid before recording HOST_ENDED. The new BidControl component associates each disabled bid with visible descriptive text; engine purchase validation and the UI share the same reserve, budget, squad and overseas checks.

Verified 2026-11-11: TypeScript passed; production bundle built in E2E setup; local suite 76 passed; core Vitest 23 passed; Chromium desktop/mobile-viewport E2E 6 passed, 0 failed/skipped. Evidence: docs/reports/evidence/WP1-AUCTION-COMPLETION/ and docs/reports/evidence/WP1-E2E/.
