# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

---
id: WP1-ROOM-RESILIENCE
title: Complete room sharing, host-loss and spectator browser flows
owner: conductor
depends_on: [WP1-CLERK-PROFILES]
phase: 1
paths: [apps/web, tests/e2e, docs]
acceptance:
  - Browser clipboard invitation admits a second local test identity
  - Results links contain only the room code and work without cached invitation credentials
  - Clipboard denial exposes a selectable, labelled link with keyboard focus containment and restoration
  - A pending clipboard result cannot expose an old identity's link after sign-out
  - Real host network loss pauses an accepted bid before settlement and preserves it past the original deadline
  - Host reconnection requires explicit resume and settles the preserved bid exactly once
  - Late invited spectators are admitted read-only only when enabled, with claim/bid intents denied
  - Admitted spectators receive real WebSocket results and can reload; disabled spectators gain no membership
evidence_required: [typecheck, browser-build, desktop-mobile-browser, core-regression, screenshots]
status: done
---

The existing clipboard error suggested manual copying without exposing a link. Added a read-only link dialog with selection, an accessible label/help text, keyboard wrap/Escape and trigger-focus restoration. Pending copy callbacks check current identity and room membership before showing private data. Identity/access loss clears the dialog. Results sharing now produces a room-only URL, independently of invitation credentials, matching the existing member-only results policy.

Dialog focus now follows content changes (including create review) while preserving the original opener until the dialog closes. This is a bounded keyboard/focus improvement, not a complete accessibility audit.

Browser scenarios exercise real Clipboard API success, permission-denial fallback, delayed denial after sign-out, actual host offline/reconnect with server time, and late spectator admission/denial. Host-loss tests keep the guest connected beyond the original deadline before resuming and reconcile the single purchase. Spectator tests explicitly bypass disabled controls to verify server rejection. No engine/API behavior is changed unless a regression identifies a gap. Tests use the existing isolated local-profile harness, temporary data and ports 3101/5273. They do not access Clerk or touch completed development fixtures.

Completed 2026-11-11. TypeScript and all 70 core tests passed. All ten new desktop/mobile browser cases passed, then the full expanded suite passed 20/20 with zero failures/flaky cases in about 7.4 minutes. The final suite includes focus checks for the create form and settings review, both invitation/results manual fallbacks, and a bound against inflating resumed time. Reviewed masked manual-copy, paused-host and spectator-result screenshots. Automatic production build and owned-server shutdown passed; ports 3101/5273 were verified stopped. Evidence: docs/reports/evidence/WP1-ROOM-RESILIENCE/validation.json, full-browser-results.json, core-vitest.txt, browser-build.log and six screenshots. Engine/API behavior already satisfied the new transport tests, so only frontend sharing/focus code and browser coverage changed.
