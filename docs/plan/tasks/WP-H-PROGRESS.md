# WP-H Progress

**Current phase:** complete (required local verification green; documented Phase 6 gaps)
**Started:** 2026-11-19
**Last updated:** 2026-11-19
**Authority:** docs/plan/tasks/WP-H-PROMPT.md

## Phase checklist

- [x] Phase 0 — Inspect and plan
- [x] Phase 1 — Assets and catalog
- [x] Phase 2 — Pure planner
- [x] Phase 3 — Persistence, API and security
- [x] Phase 4 — Host setup UI
- [x] Phase 5 — Live bidding UI
- [x] Phase 6 — Verification (documented gaps; see Definition of done)
- [x] Final report

## Done

### Phase 0 — Inspect and plan
- Inspected the CSV, roles, tiers, base prices, team identities, engine sequencing and storage adapters.
- Wrote `docs/plan/tasks/WP-H-PLAYER-POOLS.md` with findings, data model, files to change and risks.

### Phase 1 — Assets and catalog
- `scripts/assets-ingest.mjs`, `scripts/lib/csv.mjs`, `scripts/build-catalog.mjs`; npm scripts `assets:ingest`, `catalog:build`, `plan:export`.
- 224 photos bundled as 640 px WebP (10.47 MB), 21 SVG placeholders marked `unconverted`, 5 missing photos (`P086`, `P161`, `P214`, `P216`, `P227`), 0 ambiguous, 0 unmatched image files, 0 logos matched / 9 unmatched.
- Catalog `real-v1-3fb107eb`: 250 players; tiers A26/B45/C62/D71/E46; roles WK27/BAT61/AR56/BOWL106; 83 overseas / 167 domestic.
- Ingestion is idempotent: a second run converted 0 files.
- `public/assets/players/<ID>.webp` is the static location; `Assets/` remains input-only.
- Image credits UI records `license: UNRECORDED`, `provenance: owner-supplied`; placeholders/missing use initials avatars; team crests are generated because no logo matched.
- `exports/` is gitignored; `plan:export` generated `exports/auction-order-80.csv` (80 players, 10 sets), `auction-order-120.csv` (120, 15), `auction-order-250.csv` (250, 32) with 0 adjustments.

### Phase 2 — Pure planner
- `packages/catalog/src/planner.ts`: seeded PRNG (no `Math.random`, `Date`, `process`, `window`), tier quotas, deterministic quota adjustment, role-balanced selection, domestic/overseas guard, mixed-role marquee opening, role-wise sets when fillable, tier spreading, numbered set names, three-run cap with roster repair.
- `tests/core/planner.test.ts` covers all three modes across 30 seeds: uniqueness, quotas, domestic balance, opening marquee, set sizes, marquee spread, role-run cap, tail tiers, determinism and purity.

### Phase 3 — Persistence, API and security
- Shared domain: `AuctionMode`, mode labels/sizes, role/tier types, optional catalog fields, `RoomPlan`, `PlanDraft`, `PlanSummary`, `planSummaryFor`, room plan fields.
- `packages/catalog/src/room-plan.ts`: `toRoomPlayers`, `setBoundaries`, `approvePlan` (players stay in catalog order), `buildPlanPreview`, `planCsv` (draft and approved), `withPlanSeed`.
- Engine: `plannedNext`, `approveRoomPlan`, plan-aware `openNext`, auto-approve in `start`, `plan-preview` / `plan-regenerate` / `plan-approve` actions.
- Local store and API: server seed injection after fingerprinting; host-only `GET /api/rooms/:code/plan` and `/plan/export`.
- Durable Object: plan handlers, host-only routes, seed injection, `plan-approve` directory flush, hibernation recovery preserves plan.
- `room-sync.ts` strips `plan`, `planDraft`, `planPosition`, `planSummary` and adds the derived `planSummary`; snapshots stay below 128 KB, including a Mega room.
- Tests: `tests/core/planner.test.ts` (13), `tests/core/room-plan.test.ts` (11), DO plan hibernation test (1). Full core suite: **22 files / 307 tests passing**.
- Typecheck passes; production build succeeds (501.84 kB JS, chunk-size warning only).

### Phase 4 — Host setup UI
- `apps/web/src/components/AuctionPlanPanel.tsx`: mode selector (Standard default), counts, tier/role breakdown, adjustments, set review, regenerate, draft/approved CSV download, approve & start, pending/blocked/error states.
- `main.tsx`: host lobby auto-previews Standard; mode switching regenerates; approve starts; CSV download uses the host-only endpoint; the live toolbar exposes `Export order` for an approved plan.
- CSS in `apps/web/src/room-management.css`.

### Phase 5 — Live bidding UI
- `PlayerIcon` renders bundled WebP photos with an initials fallback on missing/error images; the current lot loads eagerly.
- The host preloads the next lot's photo from the approved preview order; participants never receive the upcoming ID, so only the current lot is eager for them.
- `TeamCrest` renders generated crests in the lobby and the live leading-team display.
- Lobby Image credits note the UNRECORDED license, owner-supplied provenance, placeholder/missing fallback and generated crests.
- Catalog players show "Career statistics unavailable" instead of invented numbers.

### Phase 6 — Verification
- Core: **22 files / 307 tests passing**.
- Local Node suite: **78 passed, 0 failed**.
- Browser E2E: **23/23 desktop** and **23/23 mobile**, including the Standard plan flow and the new Mega plan flow.
- Plan-specific browser flow: desktop + mobile pass; covers preview, Quick and Mega regeneration, draft and approved CSV, approve/start, participant privacy, photos/crests, live order matching, reload immutability and Mega opening set.
- Local restart/immutability: `tests/local/plan-persistence.test.mjs` passes.
- Load smoke: 20 users / 1 room, 0 errors, ping p95 1.78 ms, state p95 25.27 ms, broadcast p95 39.62 ms.
- Evidence under `docs/reports/evidence/WP-H-PLAYER-POOLS/`: `full-desktop/`, `full-mobile/`, `plan-flow/`, `local-tests/`, `load-local.json`.
- Screenshots: desktop/mobile plan preview, live bidding and participant live view.
- Final report: `docs/plan/tasks/WP-H-REPORT.md`.
- Status docs updated: `README.md`, `PROJECT_STATUS.md`, `NEXT_AGENT_HANDOFF.md`, `docs/reports/BUILD-STATUS.md`.

## Not done

- Workers-runtime live test of the WP-H plan path (COULD tier). Package G verified the Worker earlier, but not these endpoints.
- Full 100-user / 5-room load rerun with planned pools (COULD tier); only a 20-user smoke was run.
- Quick 80 approve/start and a full Quick opening set: the browser covers Quick preview and regeneration, but the full approval/live-set flow was run for Standard and Mega only.
- Core test output was not saved as a separate WP-H evidence artifact; the 22-file / 307-test result is recorded in the report and `BUILD-STATUS.md`.
- Unsold recall: the current engine has no recall feature; unsold lots remain terminal. Not added (scope guard).
- Results page for a completed catalog auction (would require exhausting a 120/250 pool); existing results flow remains legacy-tested.
- Real-device, Safari, human accessibility and screen-reader verification.

## Blockers

- None.

## Open issues

- Photo license/provenance is unrecorded; no manifest was supplied.
- 21 supplied SVG placeholders are marked unconverted; 5 photos are missing; `P123` is the only tier-A placeholder.
- All 9 team logos are unmatched; generated crests are used.
- The WP-H plan path is unverified in workerd.
- Quick 80 cannot fill eight maximum-size squads; the auction ends by pool exhaustion (existing behavior).
- The legacy `minSquad * teamCount <= 24` guard remains (squad rules out of scope).

## Definition of done

MUST tier: met. Phases 0–3, persistence/immutability and all existing suites are
green (typecheck/build, 307 core, 78 local, 23 desktop + 23 mobile browser
executions, axe 0 violations).

SHOULD tier: met for the host/live UI and the Standard and Mega live browser
flows; Quick is previewed/regenerated but not approved/started for a full set.

COULD tier: screenshots are saved. The Workers-runtime plan flow and the
100-user/5-room load rerun were not run.

Literal Phase 6 is therefore not 100% complete: Quick approval/full-set, the
catalog results page, workerd, the full load rerun and a separate core evidence
artifact remain open. No production, Cloudflare, capacity or WCAG-conformance
claim is made. `WP-H-REPORT.md` §10 records the item-by-item assessment.

## Resume instructions

1. Re-read `docs/plan/tasks/WP-H-PROMPT.md`, `WP-H-REPORT.md` and this file.
2. Run `npm.cmd run build`, `npx.cmd vitest run tests/core` and `node scripts/test-local.mjs` (expect 307 core, 78 local).
3. Browser evidence is in `docs/reports/evidence/WP-H-PLAYER-POOLS/`; use a fresh `AA_EVIDENCE_DIR` and the isolated copy for any rerun.
4. Optional next work: run the plan flow in `wrangler dev`/workerd, rerun load at 100/250 users with planned pools, obtain a photo/license manifest, and add a catalog results-page case.
5. All changes are uncommitted. Do not commit, push, deploy or create cloud resources without explicit owner approval.
