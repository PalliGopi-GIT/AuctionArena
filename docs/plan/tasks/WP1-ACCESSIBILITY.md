---
id: WP1-ACCESSIBILITY
title: Improve accessible navigation, dialogs and shared auction announcements
owner: conductor
depends_on: [WP1-ROOM-RESILIENCE]
phase: 1
paths: [apps/web, tests, package.json, package-lock.json, docs]
acceptance:
  - Axe WCAG A/AA and best-practice scans cover primary local screens and dialogs on both viewports
  - Skip navigation, mobile navigation and selected room sections are accessible by keyboard
  - Modal background is inert and focus stays inside the active dialog
  - Authored controls have 44px targets, including checkbox label hit areas
  - Long room names and modal forms reflow at 320 CSS pixels
  - Shared bid updates coalesce within one second; critical updates are spaced by two seconds
  - Timer announcements occur at 10/5-second thresholds and pending private speech clears on exit
  - Findings, incomplete checks and human/device verification boundaries remain explicit
evidence_required: [typecheck, axe-scans, keyboard-browser, announcement-tests, full-browser-regression, screenshots]
status: done
---

Added @axe-core/playwright through the user's host terminal because agent cache/network access is restricted. Baseline scans are retained under WP1-ACCESSIBILITY. Initial findings included homepage avatar-label contrast, skipped heading levels, logo label/content mismatch and narrow long-name overflow. Added skip/main focus, mobile navigation, pressed room-section state, inert modal background, 44px controls/checkbox labels, safe long-name wrapping and corrected result region/note semantics. Disabled mobile bid controls no longer float over the clock; enabled controls retain the existing sticky behavior.

Added a pure auction announcement scheduler and React live regions. Shared updates coalesce over 1000ms, critical announcements are separated by at least 2000ms, stale connection warnings cancel on recovery, and timer warnings occur at thresholds rather than every second. Room exit/dialog isolation clears queued private speech without resetting the critical-message rate limit. Eight deterministic tests cover bidding bursts, thresholds, pause/result spacing, transient disconnection, cleanup, reconnecting into a paused room and speech-limit preservation across context changes. No additional API calls or auction mutations are introduced.

Automated coverage targets local-profile screens: home, sign-in, create/review, lobby, squads, players, members, history, edit rules, live/paused auction, end confirmation, results/manual copy and room list. Keyboard checks cover skip/main focus, inert background, form/review focus, authored target bounds, long-name reflow and player filtering. This does not establish human screen-reader testing, real-device/Safari support, third-party Clerk challenge UI or complete WCAG conformance. Axe incomplete findings remain available for review rather than being disabled.

The dependency installation also exposed a separate npm audit report: seven affected packages (two critical, one high, four moderate). The host saved the full report in .data/npm-audit.json. Critical chains involve Vitest/Tinypool; Zod, the Node server adapter and transitive build tooling also require review. No audit fix --force was run. A compatibility-tested dependency upgrade is the next priority after this accessibility slice.

Completed 2026-11-11 for this implementation/automated-audit scope. TypeScript and all 78 core tests passed. Both sixteen-state axe matrices (32 scans) report zero violations without disabled rules. All 20 existing auction browser cases passed. Two added keyboard assertions initially required an unspaced brand name; Chrome correctly exposed Auction Arena. The expectation was corrected and both keyboard/reflow cases passed, including additional home scans, skip visibility and clearing speech on room exit/sign-out. Aggregate validation composes 24 verified cases from the full run (22 passed plus those two assertion failures) and corrected keyboard rerun; it does not rewrite the raw full-run JSON as a clean single run. Build/owned-server cleanup passed; both test ports are stopped. Final validation, baseline/final scans, core log, build log, screenshots and the open dependency audit are in WP1-ACCESSIBILITY. The targeted command is npm.cmd run test:a11y.

Human screen-reader/device/zoom testing and axe incomplete contrast/obscuration review remain explicitly unverified. This completion does not claim full WCAG conformance, third-party Clerk accessibility or production security. WP1-DEPENDENCY-HARDENING is the next implementation priority.
