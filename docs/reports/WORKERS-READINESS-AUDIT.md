# Worker readiness audit: security, operations and staging

This review covers the Cloudflare Worker target in `apps/api/src/worker/` and the browser client in `apps/web/src/room-connection.ts`. It combines static review with the local workerd runs recorded in [WP-G](../plan/tasks/WP-G-WORKERS-RUNTIME.md). It is a local readiness review, not a penetration test, a Cloudflare capacity result or a production approval.

## Authentication

| Control | Status |
| --- | --- |
| Clerk token verified server-side with signature, expiry, not-before, issuer and authorized parties | Implemented in `apps/api/src/clerk-auth.ts` via `@clerk/backend` `verifyToken` |
| Session must be active (`sid` present, `sts` active when supplied) | Implemented |
| Bearer token required on every `/api/*` path except `/api/health` and `/api/config` | Implemented |
| Subject pinning: a request carrying `X-Auction-Subject` must match the verified subject | Implemented, returns `409 ACCOUNT_CHANGED` |
| Missing configuration fails closed with `503 AUTH_NOT_CONFIGURED` | Implemented |
| Local load testing without Clerk network calls | RS256 keypair with `CLERK_JWT_KEY` and a local issuer; no Clerk account or user created |
| Account deletion revokes access | Directory projection plus `410 ACCOUNT_DELETED`; covered by core and browser tests |

Gaps: real Clerk token rotation, session revocation propagation, Clerk webhook delivery and Clerk latency are not exercised locally. The Worker verifies tokens per request with no local cache, so Clerk availability is on the request path; a JWKS cache is a production decision.

## Authorization

| Control | Status |
| --- | --- |
| Room membership checked in the Worker before a socket ticket is issued | Implemented |
| Room membership re-checked inside the Durable Object for every action and message | Implemented |
| Host-only actions (`start`, `pause`, `resume`, `next`, `end`, `update-settings`, invite renewal) | Implemented in the engine and covered by core tests |
| Blocked members rejected with `ROOM_BLOCKED`; blocked sockets closed with `1008` | Implemented |
| Private rooms answer `404 ROOM_NOT_FOUND` with a generic message for non-members | Implemented |
| Client-supplied internal headers stripped before forwarding to the object | Implemented in `internalHeaders` |
| Durable Objects reachable only through the Worker binding | Structural; no public route exists |

Gaps: object-level authorization is only as strong as the Worker binding; anyone with a Cloudflare account role that can reach the object namespace bypasses the Worker. Account-level Cloudflare access control is a deployment prerequisite.

## Input validation

| Control | Status |
| --- | --- |
| Request bodies limited to 4 KB | Implemented (`hono/body-limit`, `413 PAYLOAD_TOO_LARGE`) |
| Actions and settings validated with strict Zod schemas | Implemented |
| Room codes normalised and pattern-checked (`^[A-F0-9]{6}$`) before `idFromName` | Implemented |
| History cursor and page size validated (`1-100`, integer `before`) | Implemented |
| Replay cursor validated (`afterVersion` integer) | Implemented |
| Snapshot size budget (`128 KB` with 4 KB headroom) | Implemented; oversized snapshots fail closed |
| Socket message payloads parsed defensively; malformed messages ignored | Implemented |

Gaps: the object does not rate-limit WebSocket messages. A member can send heartbeats or pings as fast as the socket allows; each message is cheap, but a hostile client could still consume object CPU. A per-socket message budget is the next hardening step.

## Rate limiting

The Worker applies a best-effort per-isolate limit of 25 requests per second per verified user, with a 10,000-entry bucket map that is cleared when it grows too large. It is explicitly not a global quota: isolates do not share counters, and a user spread across isolates gets a multiple of the limit. The load tests rely on this limit being generous enough for setup traffic and did not hit `429`.

Gaps and next steps:

- A durable or edge-level limiter (Cloudflare Rate Limiting rules or a Durable Object counter) is required before production.
- No per-IP limit exists for unauthenticated paths. `/api/health` and `/api/config` are trivial, but they are still unauthenticated endpoints.
- No WebSocket message budget (see above).

## WebSocket security

| Control | Status |
| --- | --- |
| Short-lived HMAC-SHA-256 ticket, 30-second expiry, room-scoped | Implemented in `ticket.ts` |
| Ticket delivered in `Sec-WebSocket-Protocol`, not a URL query string | Implemented |
| Signature verified with `crypto.subtle.verify` before routing | Implemented |
| Ticket room must match the requested room | Implemented |
| Object re-checks membership and closes denied sockets with `1008` | Implemented |
| Slow consumers closed with `1013` above 256 KB buffered | Implemented |
| Hibernating sockets with serialized attachments | Implemented and locally exercised |
| Heartbeats refresh in-memory presence only; durable writes on change or a >10 s gap | Implemented |

Gaps: the ticket is a bearer credential for its 30-second lifetime; anyone who can read the subprotocol header could replay it. TLS and header privacy are deployment requirements. Ticket replay within the TTL is not prevented, but the object still enforces membership.

## Observability and operations

Present: a per-request `requestId` returned in error bodies, `console.error` on unexpected failures, a durable directory outbox with retry and permanent-error handling, a single alarm slot per room, and recovery that pauses a live lot when the host socket did not survive.

Missing or thin:

- No structured logs (level, room code, user id, action type, duration) and no log sampling policy.
- No metrics or traces: object latency, alarm lag, outbox depth and socket counts are not exported.
- The local runtime logs `NOSENTRY SQLite alarm overdue` and `NOSENTRY SQLite alarm handler canceled with requestScheduledAlarm`; alarms still ran, but alarm health needs a production dashboard.
- No alerting on `5xx`, `SERVICE_ERROR`, outbox backlog or repeated `STALE_VERSION` spikes.
- The directory projection is eventually consistent with no freshness indicator in the UI.

## Staging deployment (executed)

The detailed audit, cost estimate, permissions and rollback are in [STAGING-DEPLOYMENT-PLAN.md](STAGING-DEPLOYMENT-PLAN.md), and captured output is in [evidence/STAGING-DEPLOYMENT](evidence/STAGING-DEPLOYMENT/README.md). Key findings as of 16 November 2026:

- Wrangler 4.162.0 is authenticated against account `64058e40ad01fc3841a8c6493a63bbdd` (subdomain `palligopi1924`). Only `auctionarena-staging` exists; production `auctionarena` returns 404.
- `auctionarena-staging` runs version `cc191a81-279a-4d85-bf4e-28145a002d16` at 100% with 8 bindings: `ROOM`, `DIRECTORY`, `ASSETS`, `CLERK_ISSUER`, `ALLOWED_ORIGINS`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY` and `WS_TICKET_SECRET`.
- Wrangler does not inherit `durable_objects` or `vars` into named environments, but `migrations` are inherited. `env.staging` declares the four non-inherited values explicitly and uses the top-level `v1`/`v2` migrations, which the deploy applied.
- The account's Workers plan was not read during this audit. No plan change or payment was made.
- The Clerk development instance allows the staging origin. The three secrets are set as Worker secrets; the two public values are in `wrangler.jsonc`. No secret pattern appears in the served bundle.
- `/api/health` and `/api/config` are public as intended; all room routes require a verified session. CORS allows only the staging origin.
- `scripts/staging-preflight.mjs` remains the read-only pre-deploy gate. It does not assert that the built `dist` contains a Clerk publishable key, nor that the publishable key's host matches `CLERK_ISSUER`; both gaps were checked manually during this audit.
- R2, D1, KV, Queues and Pages remain at 0. No bucket, database, namespace, queue or project exists.

Completed: owner approval, Cloudflare authentication, deploy, both SQLite migrations, the three secrets and two public variables, binding/health/lifecycle/reconnection verification, a small functional smoke test and Clerk sign-in with allowed-origin behavior.

Open:

1. Alarm delivery and hibernation eviction/wake under Cloudflare scheduling.
2. A production Clerk instance: the current instance is a development instance with strict usage limits, and webhooks, token rotation and deletion flows are unverified.
3. Rate limiting and alerting before public traffic; the current limiter is per-isolate and best-effort.
4. Multi-colo placement, latency, quota, billing and any capacity measurement. A 1,000-user staging load test needs many real Clerk sessions or an auth bypass and is not included.
5. Human accessibility, Clerk challenge/mobile flows and account deletion remain open from earlier phases.


## Rollback checklist

1. Keep the previous Worker version available and record its version ID before deploying.
2. Durable Object SQLite schema version is `1`; a rollback must not run an older binary against a newer schema. Stop writes before rolling back if the schema changed.
3. The directory projection is rebuildable from room outboxes; a rollback that loses the projection can be repaired by replaying outbox entries.
4. Keep `WS_TICKET_SECRET` stable across a rollback so in-flight tickets stay valid for their 30-second lifetime.
5. Re-verify `/api/health` and one full room lifecycle after rollback.

## R2 and optional storage

R2 is not used, not configured and not activated. No bucket, credential or binding exists. If result archives or exports later need object storage, the seam is the directory export/deletion path, and it should be added as an interface with a local filesystem adapter first. No R2 work is required for the current design.

## Production-only verification

The following cannot be established locally and need real cloud access:

- Cloudflare Durable Object SQLite behaviour under real eviction, migration and alarm scheduling.
- Multi-colo routing, placement and cross-colo latency.
- Real Clerk latency, JWKS caching, session revocation and webhook delivery.
- Cloudflare rate limiting and DDoS behaviour.
- Real network latency, mobile browsers and lossy connections.
- Billing, quota and CPU-time limits for the chosen plan.
