# WP-C Workers entry, Clerk and room routing

Scope: transition package C, continuing the owner's authorized sequence on 13 November 2026. It adds a Cloudflare Workers entry with Hono, Clerk session verification and deterministic room routing. It does not implement the room Durable Object, hibernation, alarms, cross-room discovery, a deployment or any cloud resource.

## Implemented

- `apps/api/src/worker/index.ts` exports the Worker `fetch` handler. `app.ts` composes Hono middleware and routes; `types.ts` uses structural Durable Object and asset bindings so the entry does not require `@cloudflare/workers-types`.
- Protected `/api/*` routes require `Authorization: Bearer <Clerk session JWT>`. The default verifier is the existing `verifyClerkIdentity` from `apps/api/src/clerk-auth.ts`, which requires an active session (`sid`, and `sts` absent or `active`). Tests inject a verifier; production does not accept a client-supplied identity.
- `room.ts` normalizes a room code to six uppercase hex characters before `ROOM.idFromName(code)`. Malformed, nonexistent and unauthorized room responses all use the same `404 ROOM_NOT_FOUND` body and message, and malformed codes never reach an object.
- Client-supplied identity and internal routing headers are stripped before forwarding. The Worker sets the verified user ID, encoded name, room code and request ID itself.
- `POST /api/rooms` validates settings with the shared schema and retries a code collision up to five times. Room creation, join, state, history, sync, actions and invite are forwarded to the room object with method, query and body preserved.
- `POST /api/rooms/:code/ws-ticket` first asks the room object to authorize the verified user, then issues a 30-second HMAC-SHA-256 ticket bound to the room and subject. `GET /ws?room=CODE` verifies the ticket from the `ticket.<token>` WebSocket subprotocol before forwarding the upgrade. The ticket is not a bearer header and the room object must recheck membership.
- `/api/health` and `/api/config` are public. `/api/config` reports only whether Clerk is configured and never returns a key. `/api/me` returns the verified user and an empty room list; discovery is package E. Unknown `/api/*` paths return JSON `404` rather than falling through to static assets. Non-API requests go to the `ASSETS` binding.
- Exact-origin CORS comes from `ALLOWED_ORIGINS`; an invalid allowlist fails closed with `503 CONFIGURATION_ERROR`. API bodies are limited to 4 KiB. A per-isolate, best-effort request bucket returns `429`; it is not a global quota.
- Errors map `RuleError` authorization codes to `403`, missing rooms to `404`, schema failures to `400 INVALID_INPUT`, and unexpected failures to `500 SERVICE_ERROR` with a request ID.

## Tests

`tests/core/worker-entry.test.ts` has 15 cases:

- Public health/config output, no secret disclosure, and protected-route refusal when Clerk is unconfigured.
- Bearer-only authentication, invalid-session rejection, subject-change conflict, and identity not accepted from request JSON or client headers.
- Code normalization before `idFromName`, client header stripping, and malformed/unknown/private room equivalence without touching an object.
- Room creation validation, collision retry, normalized defaults and exhausted code allocation.
- Method/query/body forwarding for history, actions, join and invite.
- Ticket issuance only after an authorized object check; missing ticket configuration.
- Socket routing by room, ticket identity, wrong-room rejection, tampering rejection and missing configuration.
- Static-asset fallback, API-miss isolation, exact-origin CORS, invalid allowlist refusal, body limit and per-user burst limit.
- A real RS256 Clerk-shaped JWT signed with an ephemeral key is accepted with the configured issuer/authorized party; a token signed by a different key is rejected.

## Verification

The final isolated run used a temporary source copy with a dependency junction, no private environment file and empty temporary data. Results and evidence are in `docs/reports/evidence/WP-C-WORKERS-ENTRY/` and [build status](../../reports/BUILD-STATUS.md). TypeScript passed, the core suite passed 214 tests (15 new) and the local suite passed 76. Browser and accessibility regression runs are recorded separately; they exercise the unchanged local Node runtime, not the Worker.

## Limits and next gate

- `wrangler` and Miniflare were unavailable offline, so no actual Workers runtime, Durable Object binding or WebSocket hibernation was exercised. `wrangler.jsonc`, the DO binding and the object implementation belong to package D.
- Socket tickets are replayable within their 30-second lifetime; the object must still enforce membership and connection rules. A durable revocation list is not implemented.
- Rate limiting is per isolate and best effort. Global quotas, abuse controls and observability are not implemented.
- Clerk profile projection, account deletion, webhooks and live provider challenge flows remain open; `/api/me` intentionally returns no rooms until package E provides an index.
- No deployment, account or setting change, R2 activation, cost or production migration is authorized. No capacity claim is made.
