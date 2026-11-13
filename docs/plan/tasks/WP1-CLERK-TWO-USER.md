---
id: WP1-CLERK-TWO-USER
title: Verify a private auction with two real Clerk development identities
owner: conductor
depends_on: [WP1-CLERK-READINESS]
phase: 1
paths: [apps/web, scripts, tests, docs]
acceptance:
  - Two synthetic Clerk development identities use one private room
  - Uninvited identity cannot list/read the room or mint a socket ticket
  - Switching identities clears cached room, dialog, route and invitation credentials
  - Invalid invitation does not grant membership; valid invitation joins through the UI
  - Both owners claim/ready; guest cannot start; host starts and guest bids
  - Both browsers receive real WebSocket result snapshots with matching sale/budgets/squad
  - Both see completed results; reload and sign-out preserve privacy
evidence_required: [typecheck, core-tests, local-browser-regression, live-clerk-two-user]
status: done
---

User approved two development test users and one room. The opt-in host command is `npm.cmd run test:clerk:two -- --create-test-users`. It shares the existing runner's development-instance pinning, automatic preview startup, safe diagnostics and owned-process cleanup. New evidence goes to WP1-CLERK-TWO-USER; prior single-user evidence remains untouched.

Added scripts/clerk-two-user-flow.ts. Mutations run through product controls except development identity/ticket setup and deliberate unauthorized API probes. No auth tokens, invite tokens, browser storage or traces are saved. Failure screenshots mask all inputs. The two synthetic users and room remain for inspection; sessions/tickets are revoked where applicable.

Application correction: identity changes now clear the old modal, invite/code state, errors/notices, target/edit state, route and invitation cache. A tab-scoped identity marker survives a provider reload, and cleanup waits for Clerk's loaded identity. Cached room/list rendering and subscription admission require current nonblocked membership. Anonymous sign-in continuation is preserved. Profile-name projection remains outside this slice.

The first host run created two synthetic users and room 19B480, then failed during the first sign-out/account switch. The saved screenshot shows an anonymous home page; the initial report did not distinguish invitation cleanup, route cleanup and guest activation. The corrected runner records precise checkpoints and bounded boolean/count diagnostics. Sign-out waits for the SDK and application cleanup before the next ticket sign-in.

The host retried with `npm.cmd run test:clerk:two -- --resume`. It archived the failed report, checked each retained user's private test-purpose/role metadata, and verified that the retained room was still an unstarted host-only lobby with no purchases. It created no additional user or room. A changed fixture is refused rather than replayed.

Local validation after the correction: TypeScript (including scripts), all 63 core tests, and six browser regressions passed. The browser cases run the full local sale/management flow, local account switching, and signed-out full reload on desktop/mobile.

Completed 2026-11-11: the corrected host retry passed every acceptance check in room 19B480. Uninvited guest list/read/socket-ticket access was denied, invalid invitation was rejected, valid invitation admitted the guest, both owners claimed/readied, guest start was denied, host started and guest bid. Both browsers received WebSocket RESULT snapshots with one purchase at 100 lakhs; Chennai's budget became 1900 and Mumbai's remained 2000. Host end, both results views, guest reload, both sign-outs and unauthenticated 401 denial passed with no browser runtime errors. Reviewed both screenshots and independently reconciled the persisted COMPLETED/HOST_ENDED room (completed-room.json). The two synthetic users and completed room remain for inspection; do not rerun this completed fixture. Ticket sign-in does not cover password/OTP/OAuth/MFA, live mobile, or cloud runtime behavior.
