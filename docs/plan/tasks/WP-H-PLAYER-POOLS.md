# WP-H — Player Pools, Catalog and Hybrid Ordering: Phase 0 Findings

Date: 2026-11-19
Status: complete (inspection only; no application code changed yet)

## 1. Inputs found

| Input | Location | Notes |
|---|---|---|
| Player CSV | `Assets/ipl_player_pool_250_clean.csv` | The only CSV in `Assets`; 250 data rows + header. Chosen over any other copy. |
| Player photos | `Assets/player-images/` | 245 PNG files, named `<ID>_<Name>.png`. |
| Team logos | `Assets/team-logos/` | 9 SVG files: `csk`, `dc`, `gt`, `kkr`, `lsg`, `mi`, `pbks`, `rcb`, `srh`. |
| Manifest | **absent** | No `manifest.csv` or equivalent anywhere in the project. |

The `Assets` folder is treated as read-only. Ingestion copies into `apps/web/public/`.

## 2. CSV schema and data

Columns: `seed_id, name, country, overseas, role, batting_style, bowling_style, bowling_type, tier, base_price_lakh, is_sample, licensed_source, seed_version, data_confidence, image_team, image_season, image_file`.

- 250 players, unique IDs `P001`–`P250`, unique names (case-insensitive), no quoted fields.
- Roles: Wicketkeeper 27, Batter 61, All-rounder 56, Bowler 106.
- Tiers: A 26, B 45, C 62, D 71, E 46.
- Overseas 83 / domestic 167.
- Base prices (lakh): 30, 50, 100, 150, 200.
- `is_sample` is `false` for every row; `licensed_source` is `NONE_PUBLIC_NAMES_ONLY` for every row; `seed_version` is `real-v1`; `data_confidence` is H 188 / M 62.
- `image_file` is populated for 245 rows and empty for P086 (Joe Root), P161 (Akash Deep), P214 (Rahul Sharma), P216 (Parvez Rasool) and P227 (Mustafizur Rahman).

### Missing fields and derivation rules

| Missing | Rule | Why |
|---|---|---|
| `marquee` | `marquee = tier === 'A'` | Deterministic derivation from existing data; no invented list. The top tier is the catalog's own headline grouping. |
| Career `stats` | Omit for catalog players; UI shows "Career statistics unavailable" | The CSV has no stats. Zeros or fabricated numbers would be invented data. Legacy sample players keep their existing sample stats. |
| Image license | Recorded as `UNRECORDED`, provenance `owner-supplied` | No manifest exists. See decision D3. |

### Role mapping

CSV role → engine role (1:1, no translation needed):

`Wicketkeeper` → `Wicketkeeper`, `Batter` → `Batter`, `All-rounder` → `All-rounder`, `Bowler` → `Bowler`.

## 3. Team identities and logos

The engine creates teams `t1`–`t8` with fictional names (`Mumbai Meteors`, `Chennai Cyclones`, …). The supplied logo filenames are real IPL abbreviations and match neither the stable team IDs nor the exact team names. Per the prompt, teams are **not renamed** and logos are matched only by stable ID or exact name.

Result: **0 logos matched; every team uses a generated crest** (initials on the team colour). The 9 supplied SVGs are reported as unmatched and are not copied into the bundle.

## 4. Existing rules and capacity

- `teamCount` 2–8; `minSquad` 1–4; `maxSquad` 2–12; `maxOverseas` 0–12.
- Existing creation guard: `minSquad * teamCount <= 24` (a legacy artifact of the 24-player sample pool). It is **not changed** (squad rules are out of scope). It caps the minimum-squad demand at 24 players, well below every new pool.
- 8 teams × `maxSquad` 12 = 96 > Quick 80. Quick cannot fill every team to its maximum; the auction ends by pool exhaustion. This is existing engine behaviour, not a defect.
- Worst case domestic requirement under the existing guard: 8 teams × max(0, 3 − 0) = 24 domestic players. Every mode has far more.
- All three pools (80/120/250) are feasible for every settings combination the schema allows. The planner still implements deterministic quota adjustment and a blocked-mode result for synthetic/short catalogs.

## 5. Existing code map

| Area | File(s) | Change needed |
|---|---|---|
| Player/Room types | `packages/shared/src/domain.ts` | Optional catalog fields on `Player`; optional `plan`, `planPosition`, `planSummary` on `Room`; `isSample` widened from literal `true`. |
| Room creation | `packages/engine/src/index.ts` | Accept an optional player list; keep `samplePlayers()` as the default. |
| Lot sequencing | `packages/engine/src/index.ts` (`openNext`) | Follow the approved plan when present; keep legacy index order otherwise. |
| Room plan logic | new `packages/catalog/src/room-plan.ts` | Preview/approve/summary/CSV helpers. |
| Storage port | `packages/storage/src/*` | No schema change: the plan is additive JSON on `Room`; add parity tests. |
| Local store | `apps/realtime/src/store.ts` | Preview/regenerate/approve/CSV; auto-approve on `start`; persist across restart. |
| Room Durable Object | `apps/api/src/worker/room-do.ts` | Same operations; survive hibernation; host-only. |
| Worker routes | `apps/api/src/worker/app.ts` | Forward plan endpoints. |
| Local routes | `apps/api/src/app.ts` | Plan endpoints. |
| Snapshots | `packages/shared/src/room-sync.ts` | Strip `orderedPlayerIds`/`setBoundaries`; add a derived summary. |
| Host UI | `apps/web/src/main.tsx` | Mode selector, preview, regenerate, approve-and-start, CSV, credits. |
| Live UI | `apps/web/src/main.tsx` | Player photo, team crests, preload, fallbacks. |

## 6. Data model

```ts
type AuctionMode = 'quick' | 'standard' | 'mega';
type Tier = 'A' | 'B' | 'C' | 'D' | 'E';

interface CatalogPlayer {
  id: string; name: string; country: string; overseas: boolean;
  role: 'Batter' | 'Bowler' | 'All-rounder' | 'Wicketkeeper';
  tier: Tier; basePrice: number; marquee: boolean;
  battingStyle: string; bowlingStyle: string;
  image: string | null; imageStatus: 'bundled' | 'missing' | 'unconverted';
}

interface RoomPlan {
  catalogVersion: string; mode: AuctionMode; seed: string; planVersion: number;
  createdAt: number; approvedAt?: number; approvedBy?: string;
  orderedPlayerIds: string[];
  setBoundaries: { name: string; start: number; count: number }[];
}
```

Persisted per room: `catalogVersion`, `mode`, `seed`, `planVersion`, `approvedAt`, `approvedBy`, `orderedPlayerIds`, `setBoundaries` — IDs only, never full player objects. `Room.players` remains the room's authoritative player records, as today.

## 7. Risks

1. **License provenance gap** — no manifest. Mitigation: record provenance, flag `UNRECORDED` in the credits view and final report; owner can add a manifest later and re-run ingestion.
2. **Snapshot size** — 250 players plus history. Mitigation: plan order is never in snapshots; measure the snapshot against the existing 124 KB budget in tests.
3. **Order privacy** — participants must not receive the plan. Mitigation: `roomSnapshot` strips order arrays; a host-only endpoint serves the preview.
4. **Existing test expectations** — E2E tests hardcode `p1`/₹100. Mitigation: make those assertions derive the current lot from server state; behavioural assertions stay.
5. **Image bundle size** — 245 PNGs are ~250 MB. Mitigation: convert to 640 px WebP (~12 MB total) with the locally installed Chrome; no downloads.
6. **Plan immutability** — any reconnect/restart path that regenerates the plan would be a defect. Mitigation: explicit tests for refresh, reconnect, local restart and DO wake.

## 8. Implementation order

1. Catalog package + ingest/build scripts + assets (Phase 1).
2. Pure planner + property tests + CSV exports (Phase 2).
3. Room plan persistence, API and security (Phase 3).
4. Host setup UI (Phase 4).
5. Live photo/crest UI (Phase 5).
6. Verification and evidence (Phase 6).
