# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

---
id: WP1-E2E
title: Automate local browser lifecycle on desktop and mobile viewport
owner: conductor
depends_on: [WP1-ROOM-COMPLETION]
phase: 1
paths: [apps/web, tests/e2e, scripts, playwright.config.ts, vite.config.ts, docs]
acceptance:
  - Separate browser identities sign in, create, invite, claim, ready, start and bid
  - Real server settlement reconciles sale and purse on both clients
  - Pause/resume, refresh and participant reconnect preserve room state
  - Removal blocks HTTP reads and clears the removed browser's room view
  - Results reopen with the confirmed sale and budget
  - Invite rotation rejects old links; leave releases teams; close records no sales
  - Chromium desktop and mobile viewport run against isolated temporary data
evidence_required: [browser-results, screenshots, build]
status: done
---

Run `npm.cmd run test:e2e`. Results, screenshots and server/build output are under `docs/reports/evidence/WP1-E2E/`. The suite builds the production frontend and starts an isolated local API, using IPC shutdown so Windows execution does not depend on process-tree termination. The development database is never opened.

Application fix: preserve API error codes and consume `connectRoom.accessLost` in the React UI. Removed members now leave the stale arena view and see an error. The lifecycle test asserts both server denial and browser cleanup.

Scope: local test identities and single-process persistence, Chromium desktop and mobile viewport. Real mobile devices, Clerk, distributed runtime and production readiness are not established.
