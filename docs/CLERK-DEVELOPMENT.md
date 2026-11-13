# Clerk development sign-in

The project already uses Clerk. Do not run `clerk init` or create a replacement application.

## Connect the selected application

In the project directory, use a host PowerShell terminal:

```powershell
npx.cmd -y clerk@latest doctor --json
npx.cmd -y clerk@latest apps list --json
```

Choose the application that belongs to AuctionArena, then replace the placeholder below with that application ID:

```powershell
npx.cmd -y clerk@latest link --app <selected_application_id>
npx.cmd -y clerk@latest env pull
npx.cmd -y clerk@latest doctor --json
```

Pull development keys only. Keep `.env.local` private and do not paste keys into chat, reports, or source control. The app uses `VITE_CLERK_PUBLISHABLE_KEY` in the browser and `CLERK_SECRET_KEY` only on the API server. Existing Clerk skills are already installed.

## Start the application

```powershell
npm.cmd run dev:clerk
```

This command privately loads `.env.local`, requires development keys, derives the expected issuer from the publishable key, disables local-profile sign-in, and serves a production frontend bundle on `http://127.0.0.1:5173` with the API on port 3001. It uses `.data/auctionarena-clerk.json` by default; the local-profile database remains separate. Restart the command after frontend changes. It refuses occupied ports rather than connecting to an unrelated server.

The bundle lives in `.data/clerk-preview/`, separate from the local/E2E build in `dist/`. Run the launcher in the host terminal if an agent sandbox blocks outbound HTTPS: secret-key verification retrieves Clerk signing keys and must reach Clerk. The API keeps verification enabled and returns an authentication failure if it cannot verify a token.

`npm.cmd run dev:local` explicitly clears Clerk keys in its child processes, so pulling `.env.local` does not switch the local-profile UI to Clerk.

`API_PORT` and `WEB_PORT` can override the ports; `ALLOWED_ORIGINS` must include the exact frontend origin. `CLERK_JWT_KEY` can hold the selected instance's PEM public key for networkless verification. The launcher sets `CLERK_ISSUER`; direct API launches can set it explicitly. No secret belongs in a `VITE_*` variable.

The API verifies signature, expiry, activation time, authorized party and configured issuer through the installed Clerk SDK. It requires a nonempty user subject and session ID, and rejects pending sessions. Private room ownership uses the verified subject, never an identity supplied in request JSON. Standard tokens may omit names. The API now resolves the authenticated subject through users.getUser and persists only the display name/fetch time in the local database. First/last name wins, then username; email, phone and metadata are never display-name fallbacks. Existing room/result member names update with a versioned, persisted event; ownership and auction data stay unchanged.

Names refresh after five minutes on profile/room reads and room admission, with concurrent requests coalesced, a 1.5-second wait cap and 30-second failure backoff. Known names remain available during outages. First use without profile data uses signed name claims or Auction fan. Actions, socket tickets and WebSocket delivery do not fetch Clerk profiles. The local adapter now also supports unique custom application names, signed webhooks and durable account-deletion jobs; custom names survive provider refresh. Cross-room user storage and actual live webhook/deletion checks remain pending.

The Profile dialog sends PATCH /api/me for displayName only. Deletion requires exact typed confirmation and, for Clerk users, a signed first-factor age under five minutes using the SDK reverification flow. Hosts must first close/end their active rooms. A committed 202 request immediately denies access; the background worker retries provider deletion and then anonymizes shared records while preserving auction financial state. POST /api/webhooks/clerk requires CLERK_WEBHOOK_SIGNING_SECRET and optionally CLERK_INSTANCE_ID; never expose these in VITE_* or reports. Local tests use ephemeral signing secrets and do not establish real webhook delivery. No endpoint or instance-setting mutation has been performed automatically.

## Live verification and remaining coverage

The user renamed the existing Clerk application from Wrapper to AuctionArena. The application ID and development instance are unchanged. Our embedded components additionally use typed localization overrides in apps/web/src/auth-branding.ts so product headings say AuctionArena. The branded bundle was built and confirmed as served by the preview.

Room 0B9CEC is persisted in the Clerk development database with a Clerk user as host, Chennai claimed and ready, and no local-profile sessions. This verifies the basic real-token/create/claim persistence path; it is not an automated browser test pass.

The host-run automated smoke test passed with room 139DCB. It checked the actual AuctionArena heading, real Clerk ticket sign-in and API identity, pending-create continuation, room creation, Mumbai claim, reload, sign-out clearing room UI and unauthenticated private access returning 401. The result and screenshots are under docs/reports/evidence/WP1-CLERK-LIVE/. The synthetic user/room were retained for inspection; the test closed its own preview.

The two-user host test also passed in room 19B480: switching through sign-out, denied uninvited list/read/socket access, invalid/valid invitations, claims/readiness, host-only start, bid, real WebSocket sale, completed results/reload and both sign-outs. Remaining coverage includes password/OTP/OAuth/MFA, direct active-session switching without sign-out and live Clerk mobile flows. Use existing application users or obtain authorization before provisioning additional disposable users.

The automated cryptographic tests use ephemeral local signing keys with the real Clerk SDK. They establish verifier behavior and private-room isolation, not successful communication with a Clerk instance or browser sign-in. The local-profile Playwright suite remains separate.

```powershell
npm.cmd run test:auth
```

An opt-in host-run automation helper is available:

```powershell
npm.cmd run test:clerk:live
```

That prints the plan without remote changes. To authorize creating one synthetic development test user and a room and run the automated browser steps:

```powershell
npm.cmd run test:clerk:live -- --create-test-user
```

The helper uses a running Clerk-only preview at http://127.0.0.1:5373, or starts one automatically if the connection is refused. It closes only a preview it started itself. It will not replace a running server with the wrong authentication mode, invalid responses or an unresponsive port. Startup and connection failures have specific redacted error codes/messages.

The helper pins the selected development instance, starts a clean headless Chrome context, checks the actual Clerk heading, signs in with a short-lived Backend API ticket, verifies the API subject, creates/claims/reloads a room and signs out. It leaves the synthetic user/room for inspection; it does not use personal accounts. Reports/screenshots go to docs/reports/evidence/WP1-CLERK-LIVE/. Tokens, raw SDK errors, browser storage and traces are not recorded. Ticket sign-in does not establish that password, OTP, OAuth or MFA challenges work. The recorded successful run has status passed and roomCode 139DCB.

To check automatic preview startup and configuration without contacting Clerk or creating users/rooms, run `npm.cmd run test:clerk:live -- --preflight-only`. That saves preflight-result.json separately from full live results.

The approved two-user extension is `npm.cmd run test:clerk:two -- --create-test-users`. It verifies cross-user private access, account switching, invitations, bidding, WebSocket settlement, results and sign-out. It saves separate evidence under `WP1-CLERK-TWO-USER` and leaves the passing single-user evidence intact. The first host attempt retained two users and room 19B480, then failed during account switching.

The corrected host run used `npm.cmd run test:clerk:two -- --resume` and passed. This reused the retained identities/room and created no additional users or rooms. It verified private synthetic-test metadata and an unchanged, host-only lobby before continuing. The runner archived the previous report, recorded detailed safe checkpoints, and closed its own preview. result.json, host-results.png, guest-results.png and completed-room.json now record the completed flow. Do not rerun this completed fixture: resume deliberately refuses completed or changed rooms.

Profile verification passed on the host with `npm.cmd run test:clerk:profiles -- --verify-profiles`. It reused the existing synthetic identities and completed room 19B480, confirmed both API/result names against Clerk Backend profiles, checked both WebSocket snapshots and reload, and signed out with 401 private denial. It created no identities/rooms or auction actions. Both screenshots and independent persisted-name/auction reconciliation confirm the result. Evidence is separate under WP1-CLERK-PROFILES; no rerun is needed without a new reason. Without the flag the helper prints the plan; --preflight-only checks preview startup without remote access.

References: [Clerk React setup](https://clerk.com/docs/react/getting-started/quickstart), [token verification](https://clerk.com/docs/reference/backend/verify-token), [session-token claims](https://clerk.com/docs/guides/sessions/session-tokens), [getUser](https://clerk.com/docs/reference/backend/user/get-user), [Playwright testing](https://clerk.com/docs/guides/development/testing/playwright/overview).

## Challenge readiness and prepared account test

The host ran npm.cmd run test:clerk:readiness successfully. WP1-AUTH-COVERAGE/readiness.json contains 122 safe configuration flags: password, email-code and Google OAuth sign-in are enabled; multi-session is disabled. MFA/authenticator availability is not yet established. This inventory is not a challenge-completion pass.

The plan-only npm.cmd run test:clerk:challenges prints the proposed scope without remote changes. Its --preflight-only mode passed, starting/stopping a separate preview on API 3401/web 5573 with .data/auctionarena-clerk-challenges.json and .data/clerk-challenge-preview. It created no users or rooms and preserved completed 139DCB/19B480 fixtures. Both owned ports are stopped.

The user explicitly requires approval before new test accounts or Clerk settings changes. Do not run --create-test-users until that approval is granted. The prepared scope creates at most two purpose-tagged development users and one private room, verifies password/email-code desktop/mobile-viewport API identity, name editing/reload and deletion of only the tagged guest. Retries reuse only its tagged fixtures and reset only their test passwords. Google OAuth, MFA, direct multi-session switching, live webhook delivery and human devices remain separate checks; no instance setting is changed by this harness.
