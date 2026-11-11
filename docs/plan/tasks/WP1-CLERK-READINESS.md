---
id: WP1-CLERK-READINESS
title: Prepare Clerk development runtime and verify token boundaries
owner: conductor
depends_on: [WP1-AUCTION-COMPLETION]
phase: 1
paths: [apps/api, scripts, tests/core, docs]
acceptance:
  - Development launcher loads private keys without printing them and disables local profiles
  - API verifies signed sessions, origins, issuer, lifetime and active session identity
  - Cryptographic tests exercise the installed Clerk SDK and private-room isolation
  - Live Clerk/browser behavior is distinguished from offline verifier evidence
evidence_required: [typecheck, core-tests, local-tests, browser-regression, live-clerk]
status: done
---

Prepared dev:clerk, strict origin handling, optional PEM/issuer verification, active-session checks and 17 cryptographic/configuration tests. Existing installed SDK generation is preserved. The existing app was retained; the authorized host smoke test created one synthetic development user and ticket session.

The agent session could not fetch the Clerk CLI (registry request denied with EACCES) and could not use the host CLI cache. The user selected the existing Wrapper application app_3LlP2OcDruOfpacg7AYHbOGU7jj, development instance ins_3LlP2P5dv6hhyDKp3h6huKBFkFd. The user linked it and pulled development keys privately; their host doctor report confirms reachable application and valid development environment. No replacement app was created.

The real-key preview built and served successfully on API 3201 / frontend 5373. HTTP probes confirmed health 200, configured Clerk with localDevAuth=false, and unauthenticated me 401. An outbound signing-key probe failed EACCES in the agent environment, so that preview was stopped and live verification moved to the host, where the smoke test subsequently passed.

Local verification: TypeScript passed; 40 core tests passed (17 new authentication/configuration tests); 76 local tests passed; four selected desktop/mobile lifecycle/management regression tests passed. The earlier six-scenario full local E2E evidence is preserved separately. The cryptographic tests use ephemeral local keys with the real SDK, not Clerk-issued sessions.

The user started dev:clerk in the host terminal on :3201/:5373. Tool probes independently confirmed health/config 200 and localDevAuth=false. The later automated run used the same ports, starting the preview itself after the stopped-preview fix.

The user renamed Wrapper to AuctionArena and confirmed the visible name changed. Added typed embedded Clerk branding and rebuilt the served preview; typecheck and auth tests (17) passed. Earlier read-only inspection confirmed Clerk-backed room 0B9CEC with Chennai claimed/ready and no local-profile sessions. The opt-in host live helper then automated its own synthetic identity/room, as recorded below. Evidence: docs/reports/evidence/WP1-CLERK-LIVE/.

Completed 2026-11-11: after the stopped-preview fix, the host smoke test passed with room 139DCB. Result.json records seven checks: preview configuration, selected development instance, AuctionArena heading, real Clerk session with pending create continuation, exact API identity, UI create/claim/reload and sign-out with unauthenticated room access returning 401. Screenshots and a read-only database check confirm the room and Mumbai claim. Readiness acceptance is met for ticket-based development sign-in. Password/OTP/OAuth/MFA, cross-user live enforcement, identity switching and Clerk mobile remain later coverage; no production/distributed-runtime claim is made.
