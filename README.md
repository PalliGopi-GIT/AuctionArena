# AuctionArena

An original cricket auction application built around server-confirmed room state. **The local Phase 1 application now includes Phase 2 storage/message hardening. See current verification below. The Cloudflare runtime, deployed service and production reliability remain unimplemented and unverified.**

Continuing development in a new session? Start with [AGENTS.md](AGENTS.md) and [NEXT_AGENT_HANDOFF.md](NEXT_AGENT_HANDOFF.md). They provide the reading order, current verified scope, source map and next implementation. Check [build status and evidence](docs/reports/BUILD-STATUS.md) before repeating completed work.

## Run locally

Requires Node 22.15 or later and an internet connection for the initial install (verified here on 22.23.2). From this directory in a normal PowerShell terminal:

```powershell
npm.cmd install
npm.cmd run dev:local
```

Open the Vite URL (normally http://127.0.0.1:5173). `dev:local` explicitly enables development identities and runs both the API and frontend. Use different browser profiles to simulate friends. Create a room, claim a team, copy the invite, join from the other profile, claim a different team, then start.

The API binds only to loopback. This build is for local evaluation, not public internet access. Rooms and local identities persist in `.data/auctionarena.json`. Do not run multiple processes against this file. Never commit runtime data or secrets.

The project also provides pnpm workspace configuration and Turbo task configuration. Dependencies are installed and `package-lock.json` is present. Package manifests currently share one root dependency set; regenerate the lockfile after dependency changes.

## Clerk

The existing AuctionArena development app (formerly Wrapper) is linked, and the user pulled its development keys into private `.env.local`. The React provider, sign-in/sign-up controls and API session verification are implemented. Seventeen cryptographic/configuration tests pass using the installed Clerk SDK with ephemeral keys. A host-run live browser smoke test passed for real ticket sign-in, API identity, room creation/claim/reload and sign-out with private access denied (room 139DCB). The two-user host test also passed for switching identities through sign-out, private invite/access enforcement, claims/readiness, bidding, WebSocket settlement, results/reload and both sign-outs (room 19B480). Embedded sign-in/sign-up copy uses AuctionArena explicitly. Password, OTP, OAuth, MFA, direct active-session switching and live Clerk mobile flows remain unverified.

Run `npm.cmd run dev:clerk` from the host PowerShell terminal. It privately loads `.env.local`, builds a separate Clerk preview, starts the API with local-profile auth disabled, derives the trusted issuer and validates exact allowed origins. It uses `.data/auctionarena-clerk.json` by default. Keep secret keys out of `VITE_*` variables. See [Clerk development instructions](docs/CLERK-DEVELOPMENT.md) for ports, host network requirements and live-verification steps. `npm.cmd run test:auth` checks verifier/configuration behavior without contacting Clerk.

Participant names use a persistent local projection for the verified Clerk subject. The Profile dialog now supports unique application names and typed account-deletion requests. Signed webhooks project provider updates, while durable deletion jobs immediately deny access and later anonymize shared records without changing accepted prices, budgets or squads. Clerk deletion requires a fresh verified first factor. [Account-lifecycle evidence](docs/reports/evidence/WP1-ACCOUNT-LIFECYCLE/validation.json) verifies the local implementation; actual provider deletion/reverification and webhook delivery remain pending. The earlier host profile-name check passed with the completed fixture; preserve those users/room.

## Product flow

Home → sign in/local test profile → create private room and review rules → share invitation → lobby and team selection → live bidding → confirmed sold/unsold result → final results, squads and chronological history. Hosts can edit lobby rules, renew the invitation, remove and block participants, and close or end a room. Participants can leave a lobby before the start.

Copying an invite or results link now offers a selectable manual fallback when clipboard access is unavailable. Results links contain only the room code and remain limited to existing members. Dialogs support keyboard focus containment, Escape and focus restoration. Actual browser checks cover host-heartbeat pause/reconnect/resume and late invited spectators under both policy settings.

The local UI also has skip/main focus, mobile navigation, modal background isolation, larger authored targets, narrow long-name reflow and throttled auction announcements. Shared bids coalesce; critical updates are spaced; countdown speech occurs at thresholds. [Accessibility evidence](docs/reports/evidence/WP1-ACCESSIBILITY/validation.json) records 32 zero-violation axe scans and keyboard checks, with manual incomplete/SR/device checks still open. These results are not a full WCAG-conformance claim.

Original forest/charcoal and lime visual identity, responsive desktop/mobile layouts, original CSS player illustrations, fictional team/player data, visible pending/error states, keyboard focus, modal focus management, reduced-motion styles, and server connection status are included. External Google Fonts have local font fallbacks.

## Correctness design in this local build

- The browser submits intents; the pure engine decides all rules using injected server time.
- Local mutations execute synchronously in one process; a file lock prevents a second local writer.
- Accepted state is written and flushed to a temporary file then renamed before it is broadcast.
- Private rooms require a 256-bit invitation token; only its hash is persisted. Tokens expire after 24 hours. Existing membership persists.
- WebSocket admission uses a one-use 30-second ticket in a subprotocol, not a URL. Snapshots are versioned and contain at most 100 recent events; two-second authenticated polling resumes using the latest version. Missed/expired replay falls back to current state. Presence writes are batched at one-second intervals.
- Persist at most 1,000 recent events per room; the history screen pages at most 100 at a time. Accepted prices, budgets, squads and results remain separate durable state. Expired activity is not archived.
- Current actions include an expected room version. Retain 1,024 versioned receipts per room; a retained duplicate is deduplicated and an evicted original retry is rejected as stale. Preserve legacy receipts; new unversioned actions stop at 4,096 and ask the user to refresh. Historical over-cap legacy data stays intact. See [bounds and exceptions](docs/plan/tasks/WP2-LOCAL-BOUNDS.md).
- Bids enforce ownership, next price, deadline, squad, overseas and minimum-squad budget reserve rules.
- Between lots, auctions complete when the pool is exhausted, every participating squad is full, or no participating team with space can afford any remaining base price and its reserve. Results record and explain the reason; older saved results remain readable.
- Disabled bid buttons explain connection, pending, deadline, pause, spectator, leading, squad, overseas and budget/reserve restrictions. Purchase checks are shared with server validation.
- Settlement changes the player, squad, budget, and history together. Host end explicitly settles an accepted leading bid.
- A host absent for over 10 seconds causes a pause from the grace-expiry time, including when a scheduler sweep is delayed. A lot whose deadline preceded that expiry still settles. Returning does not automatically resume. Restart recovers saved state and pauses a still-open lot; elapsed deadlines settle according to server time.
- Late bids within 5 seconds reset the deadline to 10 seconds, at most 5 times per player.

## Verify

The dependency-free suite runs on Node 22.15+ and needs no external services:

```powershell
npm.cmd run test:local
```

Latest local result: 76 passed, 0 failed. This executes the real engine, local file store, room management, results, completion and bid-restriction tests; connection tests use fake sockets. The contention scenario uses 10 rooms, 200 simulated members, and 2,000 competing in-process intents, with no real network clients. Latest Phase 1 evidence is saved under `docs/reports/evidence/WP1-RULE-FIXES/`; earlier reports remain historical. Set `AA_EVIDENCE_DIR` to keep a new run in its own evidence directory.

Automated browser checks (installed Chrome required):

~~~powershell
npm.cmd run test:e2e
~~~

This builds the production frontend and starts isolated servers on :3101/:5273 with temporary data. Cases cover desktop/mobile Chromium room lifecycle, privacy, reconnection, bidding, results, accessibility and history paging. The development database is untouched. See [current build results](docs/reports/BUILD-STATUS.md) for exact counts and evidence; earlier reports remain historical. Mobile emulation does not establish real-device or Safari support; dialog keyboard checks do not constitute a full accessibility audit.

If restricted filesystem permissions prevent Vite config bundling, use `npx.cmd vite build --configLoader runner` and `npx.cmd vitest run tests/core --configLoader runner`, with `npx.cmd tsc --noEmit` separately.

`npm.cmd run test:a11y` runs focused scans and keyboard/reflow checks. Latest Phase 1 result: TypeScript/build pass, 164 core tests, 76 local tests and one clean 32-case browser run pass; 34 axe scans report zero violations. See [current validation](docs/reports/evidence/WP1-RULE-FIXES/validation.json). New rooms use confirmed +10/+20/+25 lakh tiers; existing rooms retain their flat rules. Earlier reports remain historical. [Human Windows/Android checks](docs/MANUAL-ACCESSIBILITY.md) still need results; automated scans do not establish full conformance.

Phase 2 verification on 13 November 2026: typecheck/build passed, 174 core tests, 76 local tests, 34 browser cases and 4 separate accessibility cases passed with zero failures/skips/flaky cases. Full browser axe: 34 scans, zero violations; incomplete rules still need human review. See [Phase 2 validation](docs/reports/evidence/WP2-LOCAL-BOUNDS/validation.json). These results cover the local runtime only.

Zod 4.6.7, Vitest 5.1.0 and the Node adapter 2.1.3 are installed; Clerk SDK versions are unchanged. Oversized API bodies now return JSON `PAYLOAD_TOO_LARGE` with status 413. The fresh host audit has zero critical/high findings and two open moderate entries in a superseded infrastructure tooling chain. [Dependency review](docs/reports/evidence/WP1-DEPENDENCY-HARDENING/review.md) records the remaining advisory and upgrade rationale. No forced override, downgrade or audit suppression was applied; this is not a clean audit or production-security certification.

Run the full checks:

```powershell
npm.cmd run build
npm.cmd run test:report
npm.cmd run test:local
npm.cmd run test:e2e
npm.cmd run test:a11y
```

Use a fresh `AA_EVIDENCE_DIR` for local/browser runs and a fresh Vitest output path to preserve prior evidence. Read [the verification report](docs/reports/BUILD-STATUS.md) before relying on the implementation. Superseded infrastructure tools are retained but are not part of the active application checks.

## Cloudflare target

The selected target is Workers/Hono and one SQLite-backed Durable Object per room with hibernating WebSockets and alarms. It is not implemented yet; the local runtime remains in use. The root master records the restored design and open gaps. Phase 2 local hardening was authorized on 13 November 2026; storage-port and Cloudflare packages are next after its report and the owner's instruction. No deployment, account/settings changes, R2 activation or spending is authorized. Budget is $0 out of pocket.

## Deferred work

Automated Chromium desktop/mobile-viewport E2E covers the local lifecycle. Host-run Clerk ticket-sign-in, two-user auction and participant-profile checks passed (completed room 19B480). See [verification status](docs/reports/BUILD-STATUS.md). Required before the Phase 1 gate: actual Clerk challenge/mobile/account-deletion/webhook delivery checks, human accessibility, two moderate dependency fixes, Cloudflare runtime and cross-room data, recovery and settlement drills, measured socket/load tests, security review and deployment. The prepared opt-in challenge harness has passed its no-fixture preflight; new Clerk accounts or settings changes require explicit approval. Frontend decomposition remains deferred.

PWA install/offline shell, hardened production limits, watchlists, chat, bots, public discovery, analysis, and the remaining Phase 2/3 features are deferred until the core gate passes. No scalability claim is made.
