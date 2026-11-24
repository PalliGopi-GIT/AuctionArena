# WP-H — Player Catalog, Assets, Auction Pools and Hybrid Ordering: Final Report

Date: 2026-11-19
Status: implementation complete. All automated suites are green and the browser,
local, axe, plan-flow, screenshot and load-smoke evidence is saved. Phase 6 still
has documented gaps: Quick 80 was previewed and regenerated but not
approved/started for a full browser set, the WP-H plan path was not run in
workerd, the load harness was not rerun at 100 users/5 rooms, and a completed
catalog-auction results page was not exercised. See §6 and §10.
Authority: `docs/plan/tasks/WP-H-PROMPT.md`
Working tree: uncommitted, based on `53967a2`

## 1. Outcome

WP-H is implemented end to end in the working tree. New rooms can use the real
250-player catalog, a host previews a seeded Quick (80), Standard (120) or Mega
(250) pool, regenerates it, downloads the draft order, approves it and starts the
auction. The live auction follows the approved order, shows bundled player photos
and generated team crests, and participants never receive the upcoming order.

The legacy local runtime remains the working development runtime. No deployment,
commit, account, Clerk user, cloud resource, paid service or production migration
was created. `Assets/` was read only; its files were not modified, moved, renamed
or served directly.

## 2. What was delivered

### Phase 1 — Assets and catalog

- Re-runnable, idempotent `npm.cmd run assets:ingest`.
- `npm.cmd run catalog:build` validates the CSV and writes a typed, versioned
  catalog.
- `npm.cmd run plan:export` writes the three review CSV files with a documented
  fixed seed.
- Photos are copied into the Vite static directory as
  `public/assets/players/<ID>.webp`; the source `Assets/` folder is untouched.
- No logo matched the app's fictional team IDs or exact names, so every team
  uses a generated crest; the 9 supplied SVGs are reported as unmatched and are
  not bundled.
- The lobby has an Image credits view driven by the asset manifest. It records
  `license: UNRECORDED` and `provenance: owner-supplied` because no manifest was
  supplied.

### Phase 2 — Pure planner

`packages/catalog/src/planner.ts` implements:

```ts
planAuction({ catalog, mode, seed, rules })
  -> { poolIds, sets: [{ name, playerIds }], adjustments }
```

- Seeded PRNG only; no `Math.random`, `Date`, environment or I/O access.
- Default quotas:
  - Quick 80: A20 B25 C20 D10 E5
  - Standard 120: A26 B35 C35 D16 E8 (default)
  - Mega 250: all players
- Deterministic quota adjustment when a quota cannot be met, surfaced in the
  preview; a mode that cannot satisfy the rules is blocked with a reason.
- Role-balanced selection, domestic/overseas guard, mixed-role marquee opening,
  role-wise sets when fillable, tier spreading, a three-consecutive-same-role
  cap with same-tier roster repair, numbered set names, and a seeded shuffle
  within sets.
- `tests/core/planner.test.ts` checks uniqueness, quotas, domestic balance,
  opening size/role mix, set sizes, marquee spread, role-run cap, tail tiers,
  determinism and purity across all modes and many seeds.

### Phase 3 — Persistence, API and security

- Per-room persisted plan fields: `catalogVersion`, `mode`, `seed`,
  `planVersion`, `approvedAt`, `approvedBy`, `orderedPlayerIds`,
  `setBoundaries`. IDs only, never full player objects.
- The plan is additive JSON on `Room`; no SQLite table migration was needed.
  The local file store and SQLite-backed room Durable Object both round-trip it.
- The server generates the seed. Approval freezes the plan; reconnect, refresh,
  local restart and Durable Object wake do not regenerate it.
- Host-only endpoints for preview, regenerate, approve-and-start and CSV export.
  Non-hosts, wrong rooms, already-started rooms and stale versions are rejected.
- `roomSnapshot()` strips `plan`, `planDraft`, `planPosition` and the full order,
  and exposes only a derived `planSummary` (mode, total, position, set name/index,
  remaining counts). Snapshots stay below the existing 128 KB budget, including
  a 250-player Mega room.
- `Room.players` stays in catalog order; `planPosition` tracks the approved
  order, so the player array does not leak the upcoming sequence.

### Phase 4 — Host setup UI

`apps/web/src/components/AuctionPlanPanel.tsx` provides the mode selector
(Standard preselected), pool counts, tier/role/overseas breakdown, quota
adjustments, set-by-set review, regenerate, draft CSV download, approve-and-start,
and pending/error/blocked states. The host lobby auto-previews Standard; the
legacy `Start auction` control is disabled until a preview is ready. An approved
plan remains exportable from the live arena toolbar.

### Phase 5 — Live bidding UI

- `PlayerIcon` renders bundled WebP photos with an initials fallback for missing,
  unconverted or failed images.
- `TeamCrest` renders generated crests in the lobby and the live leading-team
  display.
- Catalog players show "Career statistics unavailable" rather than invented
  statistics.
- Photos use contained, undistorted layout; the current lot loads eagerly and,
  where the host knows the approved order, the next lot is preloaded. Participants
  do not receive the upcoming player ID, so their preload is limited to the
  current lot.
- Accessibility names, focus handling and reduced-motion styles follow the
  existing app conventions.

## 3. Catalog and asset counts

Catalog version: `real-v1-3fb107eb`

| Measure | Count |
|---|---|
| Players | 250 (`P001`–`P250`) |
| Tiers | A 26, B 45, C 62, D 71, E 46 |
| Roles | Wicketkeeper 27, Batter 61, All-rounder 56, Bowler 106 |
| Nationality | Overseas 83, domestic 167 |
| Base prices (lakh) | A 200, B 150, C 100, D 50, E 30 |

Asset ingestion result:

| Status | Count |
|---|---|
| Bundled WebP photos | 224 |
| Unconverted placeholders | 21 |
| Missing photos | 5 |
| Ambiguous matches | 0 |
| Unmatched image files | 0 |
| Matched team logos | 0 |
| Unmatched team logos | 9 |

- Bundled photo size: **10,983,648 bytes (10.47 MB)**, 640 px WebP.
- Missing photos: `P086`, `P161`, `P214`, `P216`, `P227`.
- The 21 unconverted files are byte-identical SVG placeholders mislabeled `.png`
  (`P013`, `P016`, `P023`, `P123`, `P124`, `P125`, `P137`, `P138`, `P152`,
  `P155`, `P176`, `P183`, `P185`, `P192`, `P201`, `P233`, `P234`, `P243`,
  `P246`, `P248`, `P250`). `P123` is the only tier-A placeholder. They use the
  initials avatar.
- A second ingestion run converted 0 files, proving idempotence.
- License/provenance gap: no `manifest.csv` was supplied. All bundled photos are
  recorded as `license: UNRECORDED`, `provenance: owner-supplied`; the Image
  credits view and this report state the gap. No license was invented.

## 4. Quota adjustments and blocked modes

- Quick, Standard and Mega all satisfy the real catalog with **0 quota
  adjustments**.
- No mode was blocked.
- The legacy creation guard `minSquad * teamCount <= 24` was not changed (squad
  rules are out of scope). Quick 80 cannot fill eight teams to `maxSquad` 12;
  the auction ends by pool exhaustion, which is existing engine behaviour.

## 5. Generated CSV paths

Fixed review seed: `wp-h-review-2026-11-19`; rules
`{teamCount: 8, minSquad: 3, maxSquad: 12, maxOverseas: 4}`.

| Path | Players | Sets |
|---|---|---|
| `exports/auction-order-80.csv` | 80 | 10 |
| `exports/auction-order-120.csv` | 120 | 15 |
| `exports/auction-order-250.csv` | 250 | 32 |

Columns: `position,set name,player ID,name,role,tier,marquee flag,base price,image reference`.
`exports/` is gitignored. These are generated review exports, not hardcoded
permanent sequences.

## 6. Verification results

All commands were run with `npm.cmd`/`npx.cmd` in PowerShell. Browser, restart,
load and data-writing checks ran in an isolated copy at
`C:\Users\palli\AppData\Local\Temp\opencode\wp-h-verify` with a fresh
`AA_EVIDENCE_DIR`; the owner's private `.data` and fixtures were not touched.

| Check | Result | Evidence |
|---|---|---|
| Typecheck (`npx tsc --noEmit`) | PASS, exit 0 | — |
| Production build (`npm run build`) | PASS, 501.84 kB JS / 47.78 kB CSS; chunk-size warning only | — |
| Core (`npx vitest run tests/core`) | PASS, 22 files / 307 tests | Run log only; not separately archived as a WP-H artifact |
| Local Node suite (`node scripts/test-local.mjs`) | PASS, 78 passed / 0 failed | `docs/reports/evidence/WP-H-PLAYER-POOLS/local-tests/` |
| Browser E2E desktop | PASS, 23/23 (including the new plan flow and Mega flow) | `docs/reports/evidence/WP-H-PLAYER-POOLS/full-desktop/results.json` |
| Browser E2E mobile viewport | PASS, 23/23 | `docs/reports/evidence/WP-H-PLAYER-POOLS/full-mobile/results.json` |
| Plan-specific browser flow | PASS on desktop and mobile | `docs/reports/evidence/WP-H-PLAYER-POOLS/plan-flow/` |
| Local load smoke | 20 users / 1 room, 0 errors, ping p95 1.78 ms, state p95 25.27 ms, broadcast p95 39.62 ms | `docs/reports/evidence/WP-H-PLAYER-POOLS/load-local.json` |
| Screenshots | Desktop/mobile plan preview, live bidding and participant live view | `docs/reports/evidence/WP-H-PLAYER-POOLS/full-desktop/` and `full-mobile/` |

The final full rerun recorded `expected: 23, skipped: 0, unexpected: 0,
flaky: 0` for each viewport and exit code 0 for both Playwright commands. The
plan-specific rerun recorded `expected: 4, skipped: 0, unexpected: 0, flaky: 0`.
The saved run start times (desktop `04:33:54Z`, mobile `04:40:48Z`, plan-flow
`04:26:54Z`) are after the last source/test edits (`main.tsx` `04:25:50Z`,
`plan.spec.ts` `04:26:25Z`), so the evidence corresponds to the final tree.

New WP-H tests:

- `tests/core/planner.test.ts` — 13 tests covering all planner invariants.
- `tests/core/room-plan.test.ts` — 11 tests covering approval, immutability,
  draft/approved CSV, host-only export, snapshot redaction and Mega size.
- `tests/core/room-durable-object.test.ts` — one added plan hibernation/recovery
  case.
- `tests/local/plan-persistence.test.mjs` — 2 tests covering local store restart,
  live immutability, order-blind snapshots and stale-preview rejection.
- `tests/e2e/plan.spec.ts` — host preview/regenerate/draft and approved CSV/
  approve-and-start, participant privacy, photos/crests, opening-set bidding in
  approved order, reload immutability, and a full Mega opening set.

The browser plan flow checks that every live lot in the opening set matches the
approved order, that Quick and Mega regeneration changes the seeded order, that
participants never receive `orderedPlayerIds` or the seed, that a participant's
host-only preview/export returns 403 `HOST_ONLY`, and that the draft and approved
CSV exports match the approved order.

### What was not verified

- **Workers-runtime live test (COULD tier): not run for WP-H.** Package G
  previously verified the Worker and room Durable Object in local
  `wrangler dev`/workerd, but the WP-H plan endpoints, seed injection,
  approval and hibernation path were not repeated in workerd. They are covered
  by in-process Durable Object tests only.
- **Quick mode live approval and full set: not exercised.** Quick 80 is
  previewed, regenerated and asserted for quotas and set shape in the browser,
  but approve/start and full opening-set bidding were run for Standard and Mega
  only. Phase 6 asks for each mode to be approved and started; this is a
  documented gap, not a hidden pass.
- **Core test output has no separate WP-H artifact.** The 22-file / 307-test
  result was observed from the final local run and is recorded in this report
  and `BUILD-STATUS.md`, but unlike the browser, local, axe and load runs it was
  not saved as a WP-H evidence file.
- **Full load rerun (COULD tier): not run at the prompt's 100-user / 5-room
  scale.** The saved load smoke is 20 users in one room. It is a regression
  check, not a capacity measurement and not comparable to Package G.
- **Unsold recall: not exercised at this checkpoint.** The engine at the time of
  this report had no recall feature and unsold lots remained terminal, so this
  scope guard added none. A host-controlled recall round for eligible unsold
  players was implemented afterwards and is present in the current engine
  (`recallRound`, the `start-recall` action and host controls); this report
  records the earlier checkpoint.
- **Results page for a completed catalog auction: not exercised.** Completing a
  120- or 250-player auction in a browser test is impractical; the existing
  legacy results flow remains covered by the existing browser suite. The
  catalog plan does not change settlement or results code.
- **Real devices, Safari, human accessibility and screen-reader behaviour: not
  verified.** Axe scans and keyboard checks pass, but this is not a WCAG
  conformance claim.

## 7. Changed and added files

Added:

- `packages/catalog/src/{types,planner,room-plan,index}.ts`
- `packages/catalog/src/data/{catalog,assets}.json`
- `scripts/lib/csv.mjs`, `scripts/assets-ingest.mjs`, `scripts/build-catalog.mjs`,
  `scripts/plan-export.mjs`
- `apps/web/src/components/AuctionPlanPanel.tsx`
- `tests/core/planner.test.ts`, `tests/core/room-plan.test.ts`
- `tests/local/plan-persistence.test.mjs`
- `tests/e2e/plan.spec.ts`
- `docs/plan/tasks/WP-H-{PROMPT,PROGRESS,DECISIONS,PLAYER-POOLS,REPORT}.md`
- `docs/reports/evidence/WP-H-PLAYER-POOLS/`
- `public/assets/players/*.webp` (224 files)

Modified:

- `package.json` (asset/catalog/export scripts), `.gitignore` (`exports/`)
- `packages/shared/src/{domain,index,room-sync}.ts`
- `packages/engine/src/index.ts`
- `packages/storage/src/{port,memory-room,sqlite-room}.ts`
- `packages/room-runtime/src/{record,recovery}.ts`
- `apps/realtime/src/store.ts`
- `apps/api/src/app.ts`
- `apps/api/src/worker/{app,room-do}.ts`
- `apps/web/src/main.tsx`, `apps/web/src/room-management.css`
- `scripts/register-typescript.mjs`, `scripts/test-local.mjs`
- `tests/e2e/{helpers,auction,rule-fixes,local-bounds}.spec.ts`
- `README.md`, `PROJECT_STATUS.md`, `NEXT_AGENT_HANDOFF.md`,
  `docs/reports/BUILD-STATUS.md`

All changes remain uncommitted. No file was deleted. The working tree also
contains earlier uncommitted WP-B–G, room-deletion and staging work; this list
covers the WP-H additions and the shared files WP-H touched.

## 8. Decisions

The full log is in `docs/plan/tasks/WP-H-DECISIONS.md` (D1–D31). The main
judgment calls:

- Use the only CSV in `Assets`; treat `Assets/` as input-only.
- Bundle owner-supplied photos with `license: UNRECORDED` and show the gap;
  fall back for missing/unconverted images.
- `marquee = tier === 'A'`.
- No team logo matches; generate crests and do not rename teams.
- No career stats in the CSV; show "Career statistics unavailable".
- Convert PNGs with locally installed Chrome via Playwright; no downloads.
- Keep `createRoom()` defaulting to `samplePlayers()`; only a previewed/approved
  plan swaps in catalog players. Legacy rooms and fixtures keep working.
- Persist the plan as additive JSON; no SQLite table migration.
- Keep `Room.players` in catalog order and track progress with `planPosition`
  to prevent snapshot order leakage.
- `start` auto-approves the pending previewed plan.
- Auto-preview Standard in the host lobby, but do not persist a plan at room
  creation.
- Draft CSV export is host-only and available before approval; approved export
  remains reachable from the live toolbar.
- Number repeated set names; opening set is always "Opening Marquee".
- Repair mixed rosters with same-tier swaps to satisfy the three-run cap.
- Add a Mega opening-set browser case and assert every opening lot against the
  approved order, rather than relying only on planner/unit tests for Mega.
- Do not add unsold recall or change squad/budget/settlement rules.

## 9. Open issues and risks

1. **Image license/provenance is unresolved.** No manifest was supplied; the
   owner should add one and re-run ingestion before any public or production use.
2. **21 placeholder images and 5 missing photos.** These players use initials
   avatars. `P123` is a tier-A placeholder in the opening pool.
3. **Team logo provenance is unresolved.** All 9 supplied logos are unmatched and
   unbundled; generated crests are used instead.
4. **Workers-runtime WP-H path is unverified.** The plan endpoints and
   hibernation behavior passed in-process tests, not workerd.
5. **Load evidence is a small smoke test.** No 100/250/1,000-user result was
   produced for this feature; no capacity claim is made.
6. **Quick 80 cannot fill eight maximum-size squads.** The auction ends by pool
   exhaustion; this is existing engine behavior, not a defect introduced here.
7. **Legacy `minSquad * teamCount <= 24` guard remains.** It is a legacy
   artifact and was deliberately not changed because squad rules are out of
   scope.
8. **No production, Cloudflare or multi-colo claim.** Everything here is local.
9. **Plan storage is additive JSON.** It is backward compatible and parity
   tested, but it is not a normalized schema; future schema work should account
   for it.
10. **Mega live browser flow was added late.** The full desktop/mobile evidence
    was rerun after the addition; see the results files for the final counts.

## 10. Definition of done assessment

The prompt's definition of done is: all phases complete, all suites green, every
claim backed by saved evidence, no stray processes, no secrets exposed and no
commits made. Assessed against the saved evidence:

| DoD item | Status | Basis |
|---|---|---|
| Phases 0–5 implemented | MET | Catalog, planner, persistence/API, host UI and live UI are in the working tree and covered by core/local/browser tests |
| Phase 6 automated suites | MET | Typecheck/build exit 0; 307 core (22 files), 78 local, 23 desktop + 23 mobile browser executions, 4 plan-flow executions, axe 16 scans per viewport with 0 violations |
| Persistence/immutability | MET | Core and local tests cover approval freeze, refresh/reconnect, local restart, Durable Object recovery/hibernation and stale-preview rejection |
| Live browser: each mode | PARTIAL | Standard and Mega are approved, started and bid through a full opening set; Quick is previewed/regenerated only |
| Unsold recall | IMPLEMENTED LATER | No recall existed at this WP-H checkpoint; a host-controlled recall round was added afterwards and is present in the current engine |
| Catalog results page | NOT EXERCISED | The legacy results page is covered by existing tests; a completed 120/250 catalog auction was not run |
| Workers runtime | NOT RUN (COULD) | Package G ran the Worker/DO, but not the WP-H plan endpoints or hibernation wake |
| Full load rerun | NOT RUN (COULD) | Only a 20-user/one-room smoke; no 100-user/5-room or 250-user result |
| Screenshots | MET | Desktop/mobile plan preview, live bidding and participant views saved |
| Isolated test copy / evidence | MET | Browser, restart and load runs used the isolated copy and fresh `AA_EVIDENCE_DIR`; owner data and fixtures were untouched |
| Every claim backed by saved evidence | PARTIAL | E2E, plan-flow, local, axe, screenshots and load have saved artifacts; the 307 core count is recorded from the run but not archived as a WP-H artifact |
| No stray processes | MET | No listeners on 3001/3101/5173/5273 and no Playwright processes remain; the only Chrome processes use the owner's normal profile |
| No secrets exposed | MET | No secret-like values found in WP-H source or evidence; no `.env` file was read or printed |
| No commits made | MET | HEAD remains `53967a2`; no staged changes; all work is uncommitted |

**Verdict:** WP-H meets the MUST tier (Phases 0–3, persistence/immutability and
all existing suites green) and the implemented SHOULD scope (host/live UI plus
Standard and Mega live browser flows). It does not literally satisfy every
Phase 6 item: Quick approval/full-set, the catalog results page, workerd, the
100/5 load rerun and a separate core evidence artifact remain open. The correct
claim is "implementation complete; required local verification green with
documented gaps", not "every Phase 6 item verified". No production, Cloudflare,
capacity or WCAG-conformance claim is made.

## 11. Re-run commands

Asset ingestion when more photos arrive:

```powershell
npm.cmd run assets:ingest
npm.cmd run catalog:build
```

Planner exports:

```powershell
npm.cmd run plan:export
```

Core and local suites:

```powershell
npx.cmd vitest run tests/core
node scripts/test-local.mjs
```

Browser suites (isolated copy, fresh evidence directory):

```powershell
$env:AA_EVIDENCE_DIR='C:\Users\palli\OneDrive\Desktop\IPL-AUCTION\docs\reports\evidence\WP-H-PLAYER-POOLS\full-desktop'
npx.cmd playwright test --project=desktop

$env:AA_EVIDENCE_DIR='C:\Users\palli\OneDrive\Desktop\IPL-AUCTION\docs\reports\evidence\WP-H-PLAYER-POOLS\full-mobile'
npx.cmd playwright test --project=mobile
```

Load smoke:

```powershell
node scripts/load-local.mjs --users=20 --duration=5000 --output="...\load-local.json"
```

## 12. Recommended next steps

1. Obtain a photo/license manifest from the owner and re-run `assets:ingest` and
   `catalog:build`; update the Image credits view.
2. Decide whether to source real photos for the 21 placeholders and 5 missing
   players, or accept initials avatars permanently.
3. Run the WP-H plan flow in local `wrangler dev`/workerd to close the optional
   Workers-runtime gap, including hibernation wake with an approved plan.
4. Re-run the load harness at 100 users / 5 rooms with planned pools, then at
   250 users if time allows, and compare with Package G.
5. Add a catalog-plan results-page browser case if a shorter auction mode or a
   test-only fast-forward is acceptable.
6. Add a Quick 80 approve/start and full opening-set browser case, and save the
   core test output as a WP-H evidence file; if either is added, rerun the plan
   and full browser suites and update the 23/23 counts.
7. Review the uncommitted diff and commit only after the owner approves; do not
   deploy or create cloud resources.
