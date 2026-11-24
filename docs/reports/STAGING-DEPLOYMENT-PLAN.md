# Staging configuration audit and deployment plan

Status: **executed for staging on 15 November 2026**. The `auctionarena-staging` Worker is deployed at https://auctionarena-staging.palligopi1924.workers.dev (version `cc191a81-279a-4d85-bf4e-28145a002d16`, 100%). Production `auctionarena` remains undeployed. Sections 1–12 preserve the pre-deployment audit and approval request as a record; section 0 records the executed result and the defects found during verification.

Date: 14 November 2026. Target: the `auctionarena-staging` Worker only. The production Worker `auctionarena` is out of scope.

Related records: [Worker readiness audit](WORKERS-READINESS-AUDIT.md), [Package G scope and results](../plan/tasks/WP-G-WORKERS-RUNTIME.md), [build status](BUILD-STATUS.md), and the uncommitted working tree based on `53967a2`.

## 0. Staging result (15 November 2026)

The owner approved staging only. Wrangler 4.162.0 authenticated against account `64058e40ad01fc3841a8c6493a63bbdd` (subdomain `palligopi1924`) and deployed the staging Worker.

| Item | Result |
| --- | --- |
| Worker | `auctionarena-staging` only |
| Version | `cc191a81-279a-4d85-bf4e-28145a002d16`, 100% of traffic, created 2026-11-15T15:50:35Z |
| URL | https://auctionarena-staging.palligopi1924.workers.dev |
| Bindings | 8: `ROOM`, `DIRECTORY`, `ASSETS`, `CLERK_ISSUER`, `ALLOWED_ORIGINS`, `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `WS_TICKET_SECRET` |
| Migrations | `v1`/`v2` applied; both SQLite Durable Object classes are bound and served real rooms |
| Production | `auctionarena` does not exist; its deployments return 404 |
| Other resources | R2, D1, KV, Queues and Pages all remain at 0 |
| Clerk | Existing development application; FAPI allows the staging origin |

Verified live: `/api/health` 200 with `mode: cloudflare-worker`; `/api/config` reports `clerkConfigured: true`; CORS echoes the staging origin and omits the header for a foreign origin; unauthenticated and bogus-token requests return 401; the served bundle hashes equal to the local `dist` build (491,165 bytes) with the publishable key and no secret pattern; signed-in create, reload and reconnect work; and a two-user flow reached a live host-visible bid of `₹1.00 Cr` with a connected socket and zero page errors. Worker logs recorded 133 successful requests and 0 errors. Regression: typecheck 0, 266 core tests, build 0, 20/20 local Chromium cases. Captured output and the full record are in [evidence/STAGING-DEPLOYMENT](evidence/STAGING-DEPLOYMENT/README.md).

Two defects were found and fixed during verification:

1. **Blank page after sign-in.** `GET /api/me` returns privacy-preserving `RoomListing` summaries without `members`, but `canViewRoom()` called `room.members.some(...)` on every render. The first listing threw `TypeError: Cannot read properties of undefined (reading 'some')` and unmounted the app. Listings are now treated as viewable (the server already scoped them), blocked users are still rejected, and an `AppErrorBoundary` with an "arena unavailable" fallback replaces a blank page.
2. **WebSocket handshake 404.** The client opened `/ws` without the required `?room=` query, so every upgrade failed while polling hid it. A tested `socketUrl()` helper now includes the room code.

Verification created disposable staging rooms under the two existing synthetic identities (for example `EC2363`, `5DDD44`, `BD5F69`, `A42AD2`, `72CB81`). No Clerk user, setting or application was created, and no secret value was printed, logged or committed.

## 1. What would run in staging

The existing target is unchanged: a Hono Worker serving the React/Vite build, one SQLite-backed `RoomDurableObject` per room code with hibernating WebSockets and alarms, and one global SQLite-backed `DirectoryDurableObject` fed by a durable room outbox. Room SQLite remains authoritative; the directory is an eventually consistent projection.

Staging would use the same code and the same Clerk application. It would not use R2, D1, KV, Queues or a new database. It would start with empty room data.

## 2. Configuration audit

This section records the audit as of 14 November 2026, before deployment. Every "missing" or "not confirmed" item below was subsequently supplied for staging; section 0 records the executed result.

### 2.1 Worker bindings and migrations

| Name | Kind | Required | Current state |
| --- | --- | --- | --- |
| `ROOM` | Durable Object binding to `RoomDurableObject` | Yes | Top-level configured; now explicitly repeated under `env.staging`; local dry-run resolves it |
| `DIRECTORY` | Durable Object binding to `DirectoryDurableObject` | Yes | Top-level configured; now explicitly repeated under `env.staging`; local dry-run resolves it |
| `ASSETS` | Static assets binding to `./dist` | Yes | Configured; inherited by staging; local dry-run resolves it |
| migration `v1` | `new_sqlite_classes: ["RoomDurableObject"]` | Yes | Configured at top level; inherited by `env.staging`; not applied to Cloudflare |
| migration `v2` | `new_sqlite_classes: ["DirectoryDurableObject"]` | Yes | Configured at top level; inherited by `env.staging`; not applied to Cloudflare |

Wrangler does **not** inherit `durable_objects` or `vars` into named environments, but it does inherit `migrations`. The first `wrangler deploy --dry-run --env staging` listed only `ASSETS` and warned that `durable_objects` was absent from `env.staging`. That would have deployed a staging Worker with no room or directory binding. `env.staging` now declares the two bindings explicitly and uses the top-level `v1`/`v2` migrations. A second dry-run lists `ROOM`, `DIRECTORY` and `ASSETS`; no R2 binding appears. Captured output: [staging-dry-run.txt](evidence/WP-G-WORKERS-RUNTIME/staging-dry-run.txt) and [staging-preflight.txt](evidence/WP-G-WORKERS-RUNTIME/staging-preflight.txt).

### 2.2 Worker variables and secrets

| Name | Kind | Purpose | Local presence | Staging state |
| --- | --- | --- | --- | --- |
| `CLERK_SECRET_KEY` | Secret | Clerk Backend API for display-name updates and account deletion; also available to the verifier | Name present in `.env.local`; value not inspected | Missing |
| `CLERK_JWT_KEY` | Secret | Networkless Clerk session-signature verification (PEM public key) | Name present only in the temporary local `.dev.vars`; value not inspected | Missing |
| `CLERK_ISSUER` | Public variable | Expected Clerk token issuer | Name present only in the temporary local `.dev.vars` | Missing |
| `ALLOWED_ORIGINS` | Public variable | Exact CORS origins and Clerk authorized parties (`azp`) | Name present only in the temporary local `.dev.vars` | Missing |
| `WS_TICKET_SECRET` | Secret | HMAC-SHA-256 key for 30-second WebSocket tickets | Name present only in the temporary local `.dev.vars` | Missing |
| `VITE_CLERK_PUBLISHABLE_KEY` | Build-time public value | Browser Clerk client | Name present in `.env.local`; the production build succeeds | Not a Worker binding; must be present at build time |

`CLERK_ISSUER` and `ALLOWED_ORIGINS` are not confidential. The preferred staging setup is to commit their confirmed values under `env.staging.vars`, because Wrangler does not inherit `vars` either. The three sensitive values must be set with `wrangler secret put` and must never appear in `wrangler.jsonc`, `.env.example`, logs, documentation or the frontend.

Configuration behaviour worth noting:

- The Clerk SDK can verify a session with `CLERK_SECRET_KEY` alone by fetching JWKS, but that puts a Clerk network dependency on the request path. Staging should use `CLERK_JWT_KEY` for networkless verification, and the preflight requires it.
- If `ALLOWED_ORIGINS` is absent, the Worker falls back to localhost origins rather than failing closed. That is convenient for local development but wrong for staging; the preflight makes a missing value a hard failure. Do not deploy staging on the fallback.
- If `WS_TICKET_SECRET` is absent, socket-ticket routes return `503 SOCKET_NOT_CONFIGURED`; HTTP room state can still load but realtime does not work. The preflight catches this before deploy.

The temporary local `.dev.vars` is synthetic test configuration for the local workerd runs. It is not a staging secret store and must not be copied to Cloudflare.

### 2.3 Account and provider state

State at preparation time (14 November 2026). Section 0 records what is true after deployment.

| Item | State |
| --- | --- |
| Cloudflare account | Owner reports it is set up; no account ID or authenticated session is available to this agent |
| Wrangler authentication | Not authenticated (`wrangler whoami` reports not logged in); no `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` in the environment |
| Wrangler version | 4.162.0, isolated in `C:\Users\palli\AppData\Local\Temp\opencode\wrangler-runtime`; not a project dependency |
| Workers plan | Unknown. SQLite-backed Durable Objects are available on both Free and Paid plans; Paid is not technically mandatory for a small smoke test |
| `workers.dev` subdomain | Unknown/not confirmed. No route or custom domain is configured |
| Clerk application | Existing application; publishable and secret key names are in `.env.local`; no new Clerk app or user is proposed |
| Clerk staging origin | Not confirmed. The staging origin may need to be allowed in Clerk if the existing instance restricts origins |
| R2 | No bucket, binding, SDK call or credential in application code; existing R2/S3 credentials are unused |
| D1, KV, Queues, Vectorize, Hyperdrive | Not configured and not needed |

### 2.4 Configured versus missing

Configured locally:

- `wrangler.jsonc`: production Worker, assets, object bindings, SQLite migrations, observability and the new staging environment.
- `.env.local`: the public Clerk publishable key and the Clerk secret key name (values not inspected).
- Temporary local `.dev.vars`: names for the four values used by the synthetic local verifier.
- `scripts/staging-preflight.mjs` and `npm run check:staging`: fail-closed checks for the staging target, bindings, migrations, missing/placeholder values and secret patterns in `dist`.
- Local build and the full regression suite.

As of 15 November 2026, `npm run check:staging -- --config-only` passes all 13 configuration checks, and the staging dry-run resolves `ROOM`, `DIRECTORY` and `ASSETS` with no R2 binding. The full preflight fails only on the five absent staging values (`CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, `WS_TICKET_SECRET`, `CLERK_ISSUER`, `ALLOWED_ORIGINS`), so it blocks deployment as intended.

Missing or blocked:

- Wrangler authentication or a scoped Cloudflare API token.
- Cloudflare account ID and confirmation that the account can create Workers and Durable Objects.
- The exact staging hostname/origin.
- `CLERK_ISSUER`, `ALLOWED_ORIGINS` and the three Worker secrets in staging.
- Confirmation that the existing Clerk instance accepts the staging origin.
- A plan decision (Free smoke test versus Paid headroom).
- Explicit owner approval to create the staging Worker, Durable Object namespaces and secrets.

## 3. R2 and S3-compatible credentials

R2 is not required for any current feature. Live bids, timers, presence, room state, history, receipts and the directory projection all live in SQLite-backed Durable Objects. Exports and archives are produced from the directory projection, not from object storage. There is no bucket binding, no S3 client, no access key in the frontend and no upload/download path.

The existing R2 and S3-compatible credentials should remain unused for this staging deployment. If a future feature genuinely needs object storage, the safe seam is the directory export/archive path: add a storage port and a Worker binding to the **existing** bucket, keep credentials server-side, and obtain separate approval before enabling it. Do not create a duplicate bucket and do not expose S3 keys to the browser.

## 4. Required account permissions

### Cloudflare

- Dashboard role: **Workers Admin** on the account (or an equivalent custom role) to create/edit the Worker, apply Durable Object migrations and manage Worker secrets.
- Least-privilege API token, if a token is used instead of `wrangler login`:
  - Account → **Workers Scripts:Edit** (deploy, secrets, versions).
  - Account → **Account Settings:Read** (resolve the account).
  - Account → **Workers Scripts:Read** and, for logs, **Workers Tail:Read** or the observability read permission.
  - Zone → **Workers Routes:Edit** and **Zone:Read** only if a custom domain/route is used.
  - No R2, D1, KV, Queues or billing permissions.
- Permission to view the account's Workers plan and usage (read-only) so cost and limits can be confirmed.

### Clerk

- Access to the existing Clerk application, including the API keys page and the JWT public key/JWKS.
- Permission to add the staging origin to the application's allowed origins if the current instance requires it.
- No new Clerk application, production instance or test user is required for this plan. The smoke test should use existing accounts; creating users requires separate approval.

### Local

- Wrangler authenticated in this session, or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` present in the environment. Secrets must be entered through a prompt or a local secret store, never pasted into the chat.

## 5. Expected costs

Cloudflare pricing checked on 14 November 2026:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

| Item | Preparation | Staging smoke, Free plan | Staging, Workers Paid |
| --- | --- | --- | --- |
| Workers | $0 | $0 within 100,000 requests/day and 10 ms CPU per invocation | $5/month account minimum; includes 10M requests and 30M CPU ms |
| Durable Objects (SQLite) | $0 | $0 within 100,000 requests/day, 13,000 GB-s/day, 5M rows read/day, 100,000 rows written/day and 5 GB total storage | Included in the $5 minimum: 1M requests, 400,000 GB-s, 25B rows read, 50M rows written and 5 GB-month; overage rates apply |
| R2 | $0 | $0, unused | $0, unused |
| D1/KV/Queues | $0 | $0, unused | $0, unused |
| Clerk | $0 to prepare | Existing plan; staging sessions may count toward the plan's usage | Same |
| Domain/DNS | $0 | `workers.dev` hostname, or an existing zone | Same |
| **Expected total** | **$0** | **$0, subject to free daily limits** | **About $5/month minimum, plus any overage** |

Notes:

- A small functional smoke test is expected to fit the Free plan. A repeated 1,000-user load test is not guaranteed to fit the Free daily limits or the 10 ms per-invocation CPU allowance. The local workerd results are not a Cloudflare capacity or billing measurement.
- On Paid, a single staging smoke test is expected to remain within the included allocations, so the likely charge is the $5 monthly minimum. Repeated large tests or public traffic can add request, CPU, duration or row charges.
- R2 has no charge because it is not used. No credit card, plan upgrade or spend is authorized by this document.
- Prices exclude taxes and any separate Clerk or domain-registration charges. Confirm the actual plan and currency in the Cloudflare dashboard before approving.

## 6. Change list

Status: the staging changes below were executed on 15 November 2026. No production configuration, R2 binding, D1/KV/queue or project dependency change occurred.

Already changed in the uncommitted working tree (no account effect):

1. `wrangler.jsonc`: added `env.staging` with `name: "auctionarena-staging"` and explicit `ROOM`/`DIRECTORY` bindings; the `v1`/`v2` SQLite migrations are inherited from the top level.
2. `.env.example`: documented `WS_TICKET_SECRET`.
3. `scripts/staging-preflight.mjs` and `package.json` (`check:staging`): read-only staging gate.
4. Profile integration: Worker `PATCH /api/me`, Clerk rename, room label fan-out through an internal Durable Object route, `profile_updated` event, and stripping of client-supplied `X-Auction-Operation`.
5. `.gitignore`: ignores `.wrangler/`.
6. Documentation and evidence updates.
7. No production configuration, R2 binding, D1/KV/queue or project dependency change.

Changes that would occur only after approval:

1. Create the `auctionarena-staging` Worker and upload the existing `dist` assets.
2. Apply migrations `v1` and `v2`, creating the staging `RoomDurableObject` and `DirectoryDurableObject` SQLite namespaces.
3. Add the confirmed public `CLERK_ISSUER` and `ALLOWED_ORIGINS` values under `env.staging.vars`.
4. Set `CLERK_SECRET_KEY`, `CLERK_JWT_KEY` and `WS_TICKET_SECRET` as staging Worker secrets.
5. Optionally add the staging origin to the existing Clerk application's allowed origins.
6. No production Worker deployment, no production data migration, no R2/D1/KV/queue, no DNS purchase, no Clerk user creation.

## 7. Deployment procedure (after approval)

Status: executed for staging on 15 November 2026. The steps are preserved as the reproducible procedure.

1. Rebuild and run the local gate:
   - `npm run build`
   - `npm run check:staging -- --config-only`
   - With the five values present in the shell, `npm run check:staging` must pass. The script prints names and shapes only, never values.
2. Authenticate Wrangler with `wrangler login` or a scoped token in the environment, then confirm the account with `wrangler whoami`.
3. Confirm there is no unexpected existing `auctionarena-staging` Worker. If one exists, stop and report before changing it.
4. Add the confirmed public `CLERK_ISSUER` and `ALLOWED_ORIGINS` to `env.staging.vars` and re-run the dry-run:
   - `wrangler deploy --dry-run --env staging`
   - Expected bindings: `ROOM`, `DIRECTORY`, `ASSETS`; no R2.
5. Deploy the staging Worker:
   - `wrangler deploy --env staging`
   - This creates the Worker and applies the two SQLite Durable Object migrations. The first version is not usable until secrets exist; do not share the URL yet.
6. Set the three secrets through prompts, never on the command line or in chat:
   - `wrangler secret put CLERK_SECRET_KEY --env staging`
   - `wrangler secret put CLERK_JWT_KEY --env staging`
   - `wrangler secret put WS_TICKET_SECRET --env staging`
7. Re-deploy so the current staging version carries the public vars and the secrets:
   - `wrangler deploy --env staging`
   - `wrangler deployments list --env staging`
8. Record the staging version ID and the staging URL. Confirm the production Worker `auctionarena` was not deployed or modified.

If `wrangler secret put` refuses because the Worker does not exist yet, keep the order above: deploy first, set secrets, deploy again. Do not put secret values in `wrangler.jsonc` to work around it.

## 8. Verification checklist

- `GET /api/health` returns 200; `GET /api/config` returns the expected public configuration and no secret.
- Sign in with an existing Clerk account; create a room; join with a second existing account if one is available; claim teams; start the auction.
- Place simultaneous bids, retry a duplicate idempotently, reject a stale version, settle a sold lot and an unsold lot, and verify auto-advance.
- Disconnect the host, confirm the pause, reconnect and resume.
- Confirm WebSocket connect/reconnect and the browser `online` resume path.
- Change a display name; confirm Clerk and the existing room label update, and that the `profile_updated` event appears.
- Wait for a timer/alarm to fire; confirm the object wakes and advances or settles without a manual request.
- Inspect `wrangler tail --env staging` or the dashboard logs for `5xx`, `SERVICE_ERROR`, `CONFIGURATION_ERROR`, alarm errors and outbox failures.
- Confirm the dashboard shows no R2 bucket, D1 database, KV namespace or queue created for this work.
- Confirm the production Worker and its deployments are unchanged.
- Do not delete a real fixture account to test deletion. Account deletion needs a disposable account and separate approval.

## 9. Rollback

1. Record the staging version ID before and after deployment.
2. Prefer `wrangler rollback --env staging` to the previous known-good version, or redeploy the previous commit with `wrangler deploy --env staging`.
3. Durable Object SQLite schema version is additive (`v1`, `v2`); do not run an older binary against a newer schema if a future migration changes it. Staging starts empty, so there is no production data to migrate back.
4. Keep `WS_TICKET_SECRET` stable across a rollback so tickets issued in the previous 30 seconds remain valid.
5. If the first staging deploy is unusable, leave it idle and report. Deleting the Worker or its Durable Object namespaces is a destructive account change and needs separate approval.
6. Production is unaffected because it is a separate Worker name and a separate deployment target. Verify that the production Worker's version is unchanged.

## 10. Security and secret handling

- No secret values have been printed, logged, committed or written to documentation. This audit records names and presence only.
- Secrets are set through `wrangler secret put` prompts or a local secret store. They are never passed as command-line arguments, which can leak into shell history or process listings.
- `wrangler.jsonc` contains no secret-looking `vars`; the preflight fails if one appears.
- The preflight scans `dist` for private keys, Clerk secret keys, AWS secret access keys and Worker secret names, and fails on matches or placeholder values.
- `ALLOWED_ORIGINS` must contain exact HTTPS origins, never `*`. CORS and Clerk `azp` use the same list.
- The Worker strips client-supplied internal headers, including `X-Auction-Operation`, before forwarding to a room object. The profile fan-out route is reachable only through the Worker binding.
- Staging uses the real Clerk verifier; no authentication bypass or synthetic-token mode would be deployed.
- The staging URL is public by default. The API requires Clerk authentication, but `/api/health`, `/api/config` and the static assets are public. If the owner wants an additional access gate (Cloudflare Access or an IP rule), that is a separate configuration and product decision and is not included here.
- No R2/S3 credential is used or exposed. No S3-compatible key may be placed in the frontend.

## 11. What remains unverified until staging runs

Staging has since run; section 0 records what was exercised. Migration application, the Clerk allowed origin, real browser behaviour and realtime bidding are now confirmed. Hibernation eviction, alarm delivery under Cloudflare scheduling, multi-colo placement, rate limiting, quota, billing and any capacity claim remain open. The list below preserves the pre-deployment assessment.

- Real Durable Object migration application, namespace creation and SQLite behavior on Cloudflare.
- Real hibernation eviction/wake, alarm delivery and alarm retry under Cloudflare scheduling.
- Real Clerk token issuance, latency, rotation, revocation and webhook delivery.
- Multi-colo placement, cross-colo latency and real network behaviour.
- Cloudflare rate limiting, DDoS behaviour, quota and billing.
- Real browser/mobile behaviour over the public network.
- Production capacity. The local 100/250/500/1,000-user workerd results are not a Cloudflare capacity claim, and a 1,000-user staging load test is not part of this plan because it would require many real Clerk sessions or an auth bypass.

## 12. Approval required

Status: items 1–7 were approved and executed for staging on 15 November 2026. Item 8 (Cloudflare Access or an IP restriction) was not requested and is not configured. No production deployment was authorized. The request below is preserved as the approval record.

Please confirm all of the following before any account change:

1. **Approve staging only** — deploy `auctionarena-staging`; do not deploy or modify production `auctionarena`.
2. **Hostname** — use the account's existing `workers.dev` subdomain, or provide an existing staging hostname/route. The exact HTTPS origin is needed for `ALLOWED_ORIGINS` and Clerk.
3. **Plan** — Free-plan smoke test ($0, subject to daily limits) or Workers Paid ($5/month minimum). Confirm the budget.
4. **Clerk** — reuse the existing Clerk application; confirm the staging origin is allowed, and provide `CLERK_ISSUER`/`CLERK_JWT_KEY` through a secure local channel, not chat.
5. **Authentication** — authenticate Wrangler in this session or place a scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.
6. **Users** — confirm the smoke test may use existing Clerk accounts only. Creating new Clerk users or a separate staging instance needs separate approval.
7. **Resources** — approve creation of the staging Worker, the two SQLite Durable Object namespaces and the three Worker secrets. No R2, D1, KV, queue or domain resource is requested.
8. **Optional access gate** — state whether Cloudflare Access or an IP restriction is wanted; it is not included by default.
9. **Explicit go-ahead** — reply with approval to deploy staging. Until then, no deployment, secret creation, plan change, account setting or charge will occur.
