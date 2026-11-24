# AuctionArena

**A real-time, multiplayer IPL-style cricket auction platform.** Friends create a private room, claim franchises, and bid live against each other for a squad of cricket players — with server-authoritative budgets, squads and lot progression.

> **Status:** Staging is deployed and healthy at
> <https://auctionarena-staging.palligopi1924.workers.dev>.
> **Beta preview.** Live authenticated multi-user auction flows have been verified locally against the
> real Worker runtime; see [Known limitations](#known-limitations).

Rooms are played with the **real 250-player IPL catalog** (224 supplied photographs) and the ten
original IPL franchises, including supplied logos for nine of them.

---

## Overview

AuctionArena runs a private, host-controlled cricket auction. A host creates a room, chooses an
auction **mode** (which fixes the purse, squad size, player pool and bid timer), invites friends,
everyone claims a team, and the host starts the auction. Players are offered one at a time; anyone
can bid while the clock runs; the highest accepted bid wins the lot and the player is marked
**sold** to that team, or **unsold** if nobody bids.

All auction state is settled on the server. Bids are never decided by the browser.

---

## Features

### Real-time auction bidding
- One lot at a time, with a countdown driven by a server-set deadline.
- Tiered bid increments (+10 / +20 / +25 lakh) based on the current bid.
- A bid is accepted only if valid for the current lot, room status, purse and composition rules.
- Optional late-bid timer extension and automatic advance to the next player, both host-configurable.
- Shared bids coalesce on the wire; countdown speech occurs only at thresholds.

### Team budgets
- Each team starts with the mode's purse, stored in lakhs.
- Purchases deduct from that team's purse; a team cannot bid beyond what it can afford.
- The server rejects a purchase that would leave insufficient funds for the team's remaining squad
  slots, or that would make the mode's required nationality composition impossible.

### Auction modes
| Mode | Players | Purse | Squad | Nationality rule | Timer |
|---|---|---|---|---|---|
| **Quick** | 80 | ₹60 Cr | 5 | exactly 3 Indian · exactly 2 overseas | 15 s |
| **Standard** *(default)* | 120 | ₹90 Cr | 11 | at least 7 Indian · at most 4 overseas | 15 s |
| **Mega** | 250 | ₹120 Cr | 11 | at least 7 Indian · at most 4 overseas | 15 s |

Purse is stored in lakhs (6000 / 9000 / 12000). Team count is 2–10. A mode is fixed once chosen.
Rooms created before modes existed keep their recorded custom settings.

### Sold and unsold players
- A winning bid marks the player **sold** to the claiming team and deducts the price.
- A lot with no bids is marked **unsold**.
- After the initial order, the host may run one **recall round** for eligible unsold players, then
  continue or finish with current results.
- Results include sold, unsold and unauctioned players, signings by team, squad counts and remaining
  budgets.

### Room management
- Private rooms with a short room code plus a longer invitation token (only its hash is persisted).
- Invitees join by room code **or** full invitation link — either one, not both.
- Host-only actions: approve the player plan, start, pause, resume, end/close, edit lobby rules,
  renew the invitation, remove or block members.
- Participants can leave a lobby before the start.
- A completed or closed room can be deleted **permanently** from *My Auctions* by its creator, after
  typing `DELETE`. Cleanup is idempotent, so a repeated request finishes safely.

### Auction plans
New rooms use a seeded 250-player catalog. The host previews every set, may regenerate, can download
a draft CSV, then approves and starts. Approval freezes the order, which stays immutable across
reconnect, refresh, restart and Durable Object recovery. Participants receive only the current lot,
set name/index and remaining counts — never the upcoming order.

### Authentication
- **Clerk** provides sign-in (email/password and Google OAuth) in Clerk-enabled environments.
- An explicit **local development identity** mode exists for offline work and automated tests only;
  it is never used on staging or production.
- WebSocket connections use short-lived, HMAC-signed, room-bound tickets.

### WebSocket synchronization
- Room state is pushed to every participant over WebSockets.
- Durable Objects hibernate idle sockets; alarms drive lot deadlines, results and host absence.
- Clients reconnect automatically and recover authoritative state.
- If the host is absent for over 10 seconds the room pauses; returning does not auto-resume.
- Snapshots are versioned and bounded; missed replay falls back to current state.

### Durable Object storage
- One SQLite-backed Durable Object per room holds financial state, recent events and action receipts,
  committed together in a single transaction. Accepted state is durably written before broadcast.
- Actions carry an expected room version; retained versioned receipts deduplicate retries.
- A separate directory Durable Object maintains a privacy-minimised cross-room index fed by a durable
  outbox, so directory failures never block bidding.

---

## Architecture

```
apps/web                  React SPA (Vite) — Overview, My Auctions, auction room
apps/api/src/index.ts     Local Node boundary (Hono) for development
apps/api/src/worker/      Cloudflare Worker entry, room + directory Durable Objects
apps/realtime             Local file-backed realtime store for development
packages/engine           Pure, framework-free auction rule engine
packages/shared           Shared contracts: domain types, bid rules, settings rules
packages/room-runtime     Recovery and deletion logic for a room
packages/storage          Storage ports + memory/SQLite implementations
packages/directory        Cross-room projection helpers
packages/catalog          Player catalog and seeded auction planner
tests/core                Vitest unit/contract tests
tests/local               Node integration tests against the real engine and store
tests/e2e                 Playwright browser tests (desktop + mobile)
```

The auction **rules** live in `packages/engine` as pure functions. The Worker and the local Node
server both call the same engine, so behaviour does not diverge between environments. The browser
submits intents; the engine decides every rule using injected server time.

**Correctness invariants enforced server-side:** ownership, next valid price, deadline, squad size,
overseas cap, minimum-squad budget reserve, and nationality feasibility. A bid that would make the
required composition impossible is rejected even if the client sends it.

---

## Technology stack

- **Frontend:** React 19, Vite 6, TypeScript 5
- **Backend:** Cloudflare Workers, Hono 4
- **State:** Durable Objects with SQLite storage, WebSocket hibernation, alarms
- **Auth:** Clerk (`@clerk/backend`, `@clerk/react`)
- **Validation:** Zod
- **Testing:** Vitest (core), Node test scripts (local), Playwright (browser)
- **Tooling:** Wrangler 4.162.0, Node ≥ 22.15, npm 10.9.8

---

## Local setup

Requires **Node 22.15 or later** (verified on 22.23.2) and internet access for the first install.

```powershell
npm ci
```

Then copy the example environment file and fill in only what you need:

```powershell
Copy-Item .env.example .env.local
```

### Environment variables

**Names only — never commit values.**

| Name | Purpose |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Browser publishable key (`pk_test_…` / `pk_live_…`) |
| `CLERK_SECRET_KEY` | Server secret (`sk_test_…` / `sk_live_…`) — never in `VITE_*` |
| `CLERK_JWT_KEY` | Optional PEM public key for networkless session verification |
| `CLERK_ISSUER` | Clerk issuer origin |
| `WS_TICKET_SECRET` | HMAC key for WebSocket tickets (32+ characters) |
| `WEB_PORT` | Dev web port |
| `API_PORT` | Dev API port |
| `LOCAL_DEV_AUTH` | Enables the local development identity mode |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |
| `DATA_FILE` | Local persistence file path |

For the deployed Worker the three secrets — `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`,
`WS_TICKET_SECRET` — are set with `wrangler secret put` and never appear in `wrangler.jsonc`.

---

## Development commands

| Command | What it does |
|---|---|
| `npm run dev` | Clerk-enabled local development: API on `:3001`, app on `http://127.0.0.1:5173` |
| `npm run dev:local` | Offline local mode with local identities, no Clerk |
| `npm run dev:vite` | Vite only (no API) — static frontend work only |
| `npm run dev:api` | Local Node API only |
| `npm run typecheck` | TypeScript project check |
| `npm run build` | Typecheck then production build into `dist/` |

Use `dev` to exercise real Clerk sign-in; use `dev:local` for offline work and automated tests. The
API binds to loopback only.

---

## Testing commands

| Command | Scope |
|---|---|
| `npm run test` | Core engine/contract tests (Vitest) |
| `npm run test:local` | Local integration tests against the real engine/store |
| `npm run test:e2e` | Full Playwright browser suite (desktop + mobile) |
| `npm run test:a11y` | Accessibility subset only |
| `npm run test:load` | Local load harness (never against production) |
| `npm run check:staging` | Read-only staging configuration preflight |

Add `-- --remote` to `check:staging` to also verify that the three Worker secrets exist on Cloudflare:

```powershell
npm run check:staging -- --remote
```

Last verified locally before the current staging release: typecheck and build pass; **334 core**
tests, **78 local** integration tests, **57 browser** tests (1 intentional skip across desktop and
mobile), **4 accessibility** tests, **2 responsive** tests and **20 auction** tests all passing, with
all screenshot baselines unchanged.

---

## Environments

| Environment | Worker | URL |
|---|---|---|
| Local | — | `http://127.0.0.1:5173` |
| Staging | `auctionarena-staging` | <https://auctionarena-staging.palligopi1924.workers.dev> |
| Production | *not deployed* | — |

Wrangler does not inherit `durable_objects` or `vars` into named environments, so `env.staging`
declares `ROOM`, `DIRECTORY`, `CLERK_ISSUER` and `ALLOWED_ORIGINS` explicitly; the `v1`/`v2`
migrations are inherited from the top level.

Frontend assets deploy as static assets bound to `ASSETS` with single-page-application fallback, so
client routes resolve.

---

## Deployment

Staging:

```powershell
npm run typecheck
npm run build
npm run check:staging -- --remote
npx wrangler deploy --env staging
```

Rollback:

```powershell
npx wrangler rollback --env staging
```

Keep `WS_TICKET_SECRET` unchanged across a rollback so recently issued tickets stay valid. Rolling
back Worker code does **not** restore Durable Object SQLite data.

Production is not authorised and `wrangler.jsonc` has no `production` environment yet. A production
release requires a separate approved procedure with isolated Durable Objects, production Clerk
credentials and its own secrets. Never point production at staging Durable Object namespaces.

---

## Known limitations

- **Live authenticated multi-user flows are unverified on staging.** Auction creation, two-user
  bidding, sold/unsold synchronisation and reconnection have not been exercised end-to-end against
  the deployed staging Worker with real signed-in users.
- **Google OAuth is verified only up to the redirect.** The Clerk widget renders "Continue with
  Google" and redirects to `accounts.google.com` with real OIDC parameters; completing the round trip
  needs an interactive Google account.
- **Clerk runs on a development instance** on staging, which has strict usage limits. Production
  token rotation, webhooks and account-deletion flows against a production instance are unverified.
- **Capacity for ~1,000 concurrent users is a design target, not a proven result.** Load was measured
  only locally in `wrangler dev`/workerd (1,000 users / 50 rooms with zero errors, bid-ack p95
  1,549 ms) and never on Cloudflare at scale. Rooms cap at 20 members.
- **Hibernation eviction and alarm delivery** have not been directly observed under real Cloudflare
  scheduling, though both run in local workerd.
- **Player photos have no license manifest** and are recorded as owner-supplied / `UNRECORDED`.
- **WebSocket tickets are short-lived and room-bound but not single-use**; a captured ticket is
  replayable within its 30-second window, mitigated by TLS, room binding and a membership recheck.
- **Automated accessibility scans are not a WCAG conformance claim**; human and device checks remain
  open.
- The `infra/` AWS CDK foundation and related scripts are retained from an earlier direction and are
  **not** part of the current Cloudflare deployment path.
- The frontend is currently a single large app module rather than fully decomposed components.

---

## License and attribution

Player names and photographs are used for a private, non-commercial demonstration. Team names and
crests are original fictional creations. Virtual money only — no real transactions occur.
