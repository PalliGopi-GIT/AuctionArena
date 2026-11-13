# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

---
id: WP1-ROOM-COMPLETION
title: Complete local room management and result views
owner: conductor
reviewers: [room_core, results_ui]
depends_on: [WP1-RECOVERY]
phase: 1
slice: local-core
paths: [apps, packages, tests, scripts, docs]
acceptance:
  - Host may edit waiting-room rules and regenerate an invitation
  - Leave before start and host remove/block enforce membership on requests and open sockets
  - Sold players and team budgets are preserved during participant removal
  - Results summarize squads, spend, sold/unsold/unauctioned players and role/nationality counts
  - Tests and documentation distinguish local evidence from unavailable browser verification
evidence_required: [local-runtime, review, build]
status: done
---

Contract decision: add optional blockedUserIds to Room (old local files remain readable); actions update-settings (full Settings), leave (lobby only), remove-member (memberId, host only). Removal blocks reentry, preserves historical ownership after start, and frees claims only in WAITING. Host cannot remove self. Settings cannot remove a claimed team, reset ready indicators, and are frozen after start. Store.rotateInvite(code,user) is host-only and persists only the hash, revoking previous links. Route POST /api/rooms/:code/invite returns room, inviteToken and serverNow. Removal must revoke existing socket reads. No completed sale or budget may be edited.

Ownership: room_core owns packages/shared, packages/engine, apps/realtime, tests/local/management.test.mjs. results_ui owns apps/web/src/components/AuctionResults.tsx, apps/web/src/results.css, packages/results/src/index.ts, tests/local/results.test.mjs. Conductor owns API/socket integration, main UI, scripts and reports. No parallel edits to shared files.

2026-11-11 conductor: slice completed. Wired `RoomMembers` and `AuctionResults` into the main UI, fixed the WebSocket callback build error and page-title encoding, and extended the local runner to execute management and results suites. Verified: `npm.cmd run build` passed; `npm.cmd run test:local` 54 passed / 0 failed; `npx.cmd vitest run tests/core` 23 passed / 0 failed. Manual desktop Chromium flow passed for local sign-in, create, claim, edit rules, renew invite, second-member join, start, bid, sale, remove/block with preserved results, end, and results rendering. Clerk, mobile, automated browser E2E, copy-invite, leave, close-room, and reconnect/pause flows remain unverified. Evidence: `docs/reports/evidence/WP1-ROOM-COMPLETION/`; verification summary: `docs/reports/BUILD-STATUS.md`.
