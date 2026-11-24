# Staging deployment record

Date: 16 November 2026. Target: `auctionarena-staging` only. Production Worker `auctionarena` was not created, deployed or modified.

This folder records the executed staging deployment and the live checks that followed it. The pre-deployment audit, approval request, costs, permissions, rollback and open questions remain in [STAGING-DEPLOYMENT-PLAN.md](../../STAGING-DEPLOYMENT-PLAN.md).

## Deployment

| Item | Value |
| --- | --- |
| Worker | `auctionarena-staging` |
| Version | `cc191a81-279a-4d85-bf4e-28145a002d16`, 100% of traffic |
| Version created | 2026-11-15T15:50:35Z |
| URL | https://auctionarena-staging.palligopi1924.workers.dev |
| Cloudflare account | `64058e40ad01fc3841a8c6493a63bbdd` |
| `workers.dev` subdomain | `palligopi1924` |
| Wrangler | 4.162.0, isolated at `C:\Users\palli\AppData\Local\Temp\opencode\wrangler-runtime` |
| `compatibility_date` | 2026-11-13 |
| Bindings | 8 (see below) |
| Clerk issuer | `https://quality-labrador-8216.clerk.accounts.dev` (Clerk development instance) |

The `v1`/`v2` SQLite migrations were applied by the deploy: both `RoomDurableObject` and `DirectoryDurableObject` are bound and served real rooms. The Worker settings API does not expose the applied migration tags, so the tags are not asserted from that endpoint.

## Bindings

Captured in [live-bindings.txt](live-bindings.txt).

| Binding | Type |
| --- | --- |
| `ROOM` | Durable Object namespace (`RoomDurableObject`) |
| `DIRECTORY` | Durable Object namespace (`DirectoryDurableObject`) |
| `ASSETS` | Assets (`./dist`) |
| `CLERK_ISSUER` | Plain text variable |
| `ALLOWED_ORIGINS` | Plain text variable |
| `CLERK_SECRET_KEY` | Secret |
| `CLERK_JWT_KEY` | Secret |
| `WS_TICKET_SECRET` | Secret |

`env.staging` declares `ROOM`, `DIRECTORY`, `CLERK_ISSUER` and `ALLOWED_ORIGINS` explicitly because Wrangler does not inherit `durable_objects` or `vars` into named environments; `migrations` are inherited from the top level. The three secrets were set only through `wrangler secret put` stdin. No secret value is recorded here.

## HTTP checks

Captured in [http-smoke.txt](http-smoke.txt).

- `/api/health` 200, `mode: cloudflare-worker`, `maxMembers: 20`.
- `/api/config` 200, `localDevAuth: false`, `clerkConfigured: true`.
- CORS preflight from the staging origin echoes `https://auctionarena-staging.palligopi1924.workers.dev`; a foreign origin gets no allow-origin header.
- Unauthenticated `/api/rooms/:code`, room create and `/api/rooms/:code/ws-ticket` return 401. A syntactically valid but bogus bearer token returns 401 `SESSION_EXPIRED`.
- `/ws?room=TEST01` without a ticket returns 404 `ROOM_NOT_FOUND` (a private and a nonexistent room are indistinguishable).
- SPA fallback returns HTML for `/room/TEST01`.
- The served bundle hashes equal to the local `dist` build: `index-CUppEaP1.js`, 491,165 bytes. The Clerk publishable key is present; no `sk_`-style secret pattern appears.

## Account resources

Captured in [resources-and-clerk.txt](resources-and-clerk.txt).

- Workers in the account: `auctionarena-staging` only. `auctionarena` deployments return 404, so no production Worker exists.
- R2 buckets: 0. D1 databases: 0. KV namespaces: 0. Queues: 0. Pages projects: 0.
- Clerk's FAPI response allows the staging origin.

## Signed-in browser checks

Run with the two existing synthetic Clerk development identities (`purpose: auctionarena-two-user-test`) through short-lived sign-in tickets. No Clerk user, setting or application was created or changed.

- Create a private room: the arena renders, the React root has content, zero page errors and zero console errors.
- The live indicator reaches Connected and the client receives WebSocket room frames.
- A full reload restores the same room and reconnects.
- The account room list renders a card with code, status and `memberCount`.
- Two-user flow: host creates and claims a team, guest joins by invite, both ready, host starts the auction, guest bids, and the host sees `₹1.00 Cr` live with a connected socket and zero page errors.

Worker logs for the audit hour: 133 successful requests, 0 errors, and 7 `clientDisconnected` entries from closed test sockets.

## Incident found and fixed during verification

1. **Blank page after sign-in.** `GET /api/me` returns privacy-preserving `RoomListing` summaries (`code`, `name`, `status`, `role`, `memberCount`, `updatedAt`) that omit `members`. `canViewRoom()` called `room.members.some(...)`, and the visible room list is computed on every render, so the first listing threw `TypeError: Cannot read properties of undefined (reading 'some')` and unmounted the app. Fixed by treating a listing without a `members` array as viewable (the server already scoped it to the caller), while still rejecting blocked users and non-members of full rooms. An `AppErrorBoundary` and an "arena unavailable" fallback now replace a blank page.
2. **WebSocket handshake 404.** The client opened `/ws` without the required `?room=` query, so every upgrade returned 404 while HTTP polling hid the failure. Fixed with a tested `socketUrl()` helper that includes the room code.

Regression after both fixes: typecheck exit 0, 266 core tests in 19 files, build exit 0, and 20/20 local Chromium desktop/mobile cases.

## Staging data created

Verification created disposable rooms on staging under the synthetic identities, for example `EC2363`, `5DDD44`, `BD5F69`, `A42AD2` and `72CB81`. They are harmless staging data. No fixture `139DCB` or `19B480` room was touched on staging.

## Limits

- This proves a working staging deployment, not production readiness or capacity.
- Real hibernation eviction and alarm delivery under Cloudflare scheduling were not directly observed; the local workerd findings in [WP-G](../../plan/tasks/WP-G-WORKERS-RUNTIME.md) still apply.
- The Clerk instance is a development instance with strict usage limits; a production Clerk instance, its webhooks and its rotation behaviour are unverified.
- Multi-colo placement, cross-colo latency, Cloudflare rate limiting, quota and billing were not measured. The account's Workers plan was not read.
- No load test was run against staging. The local 100/250/500/1,000-user results are not Cloudflare capacity claims.
