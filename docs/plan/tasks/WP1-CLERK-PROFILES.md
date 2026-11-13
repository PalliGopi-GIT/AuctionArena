---
id: WP1-CLERK-PROFILES
title: Project Clerk participant names into the local application
owner: conductor
depends_on: [WP1-CLERK-TWO-USER]
phase: 1
paths: [apps/api, apps/realtime, scripts, tests/core, docs]
acceptance:
  - Profile lookup uses only the cryptographically verified Clerk subject
  - Names are derived from Clerk first/last name, then username, with a private fallback
  - Local profile projection survives restart and updates existing room members and result owners
  - Name updates are persisted before versioned WebSocket delivery and preserve auction state
  - Cached names survive provider outages and lookup latency is bounded
  - Auction intents and socket tickets never fetch Clerk profiles
  - Live check reuses the completed synthetic fixture without provisioning or auction actions
evidence_required: [typecheck, core-tests, local-tests, browser-regression, live-clerk-profiles]
status: done
---

Implemented Clerk-sourced display names using the installed Backend SDK's users.getUser(verifiedSubject). An optional profiles map in the development file stores only name and fetch time keyed by verified subject. Existing files without this map remain valid; malformed new entries fail recovery. No email, phone, avatar, raw provider object or metadata is projected.

Successful profile reads update matching existing room members, including completed-result owners. The local store commits before broadcasting a versioned profile_updated event. Ownership IDs, membership, readiness, auction status, deadlines, purchases, budgets and squads are preserved; historic event text is not rewritten. Names are trimmed, whitespace/control characters normalized, and capped at 60 Unicode code points.

Refresh occurs at most once per five minutes on authenticated profile/room reads and room creation/join. Concurrent fetches coalesce. Each refresh waits at most 1.5 seconds; failures back off for 30 seconds, preserve the last saved name, and do not change authentication. First use without a provider response uses signed name claims or Auction fan. Intents, socket-ticket minting and WebSocket delivery use saved projection data without profile fetches. This is a local adapter, not the target cross-room user storage and webhook implementation. No profile editing, uniqueness enforcement, deletion sync or cloud deployment is included.

Local verification passed: TypeScript including scripts; all 70 core tests (seven new profile scenarios); 76 local engine/store/connection/results tests; six selected desktop/mobile browser regressions; production builds through those browser and Clerk preflight launchers. The first live-helper launch exposed a Node strip-only import issue; separating the pure name formatter from the API resolver corrected it. Plan-only and automatic preview startup/config/cleanup now pass without remote provisioning.

Completed 2026-11-11: the host ran `npm.cmd --prefix "C:\Users\palli\OneDrive\Desktop\IPL-AUCTION" run test:clerk:profiles -- --verify-profiles` and all six recorded checks passed. The helper verified test-purpose metadata for the retained users, signed in with short-lived tickets, checked API/result names in completed room 19B480, reconciled unchanged auction state across both WebSocket views and reload, signed out and verified unauthenticated 401 without browser runtime errors. No users/rooms were created and no auction intents were sent; prior live evidence remains separate.

Reviewed host-profiles.png and guest-profiles.png: Mumbai shows AuctionArena Test host and Chennai shows AuctionArena Test guest. Independently reconciled the persisted name/fetch-time map and both member names against the live report in projected-room.json. Completed status, host ownership, one p1 purchase for 100 lakhs, Chennai's budget 1900, Mumbai's budget 2000 and squads match the earlier completed-room evidence. The helper stopped its own preview. No repeat host execution is needed for this milestone.
