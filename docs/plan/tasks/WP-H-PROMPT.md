# WP-H — Player Catalog, Asset Integration, Auction Pools and Hybrid Ordering

FULLY AUTONOMOUS OVERNIGHT RUN. The owner is asleep and unreachable until morning.
Do not ask questions. Do not pause for approval. Do not end your turn until the run is complete
(all phases done, or context is nearly exhausted and you have saved a clean resume state).

=====================================================================
0. PROJECT, INPUTS, AND SELF-MANAGEMENT
=====================================================================
Project folder: C:\Users\palli\OneDrive\Desktop\IPL-AUCTION
Assets folder (INPUT ONLY): C:\Users\palli\OneDrive\Desktop\IPL-AUCTION\Assets
  Scan it recursively. Expect: ipl_player_pool_250.csv, player photos (named <player ID>.webp, or other
  names you can match by ID or normalized name), team logos, and manifest.csv with source/license/attribution.
  Never modify, move, rename, delete or directly serve this folder. Copy only what the app needs into the
  app's static asset location. Photos may still be arriving, so ingestion must be re-runnable and idempotent.
  If several copies of the CSV exist, use the one inside Assets and record the choice.

FIRST ACTIONS (do these before anything else):
  1. Save this ENTIRE prompt verbatim to docs/plan/tasks/WP-H-PROMPT.md.
  2. Create docs/plan/tasks/WP-H-PROGRESS.md: current phase, checklist of phases, what is done, what is not,
     blockers, and exact resume instructions. Update it after every phase and every significant step.
  3. Create docs/plan/tasks/WP-H-DECISIONS.md: every judgment call (what, why, alternative rejected).
  4. Whenever you have a doubt, after any context compaction, and before starting each phase:
     re-read WP-H-PROMPT.md and WP-H-PROGRESS.md, then continue. The prompt is the authority.

WORK LOOP (repeat for every step):
  implement -> run the relevant tests -> fix root causes -> log in PROGRESS.md -> move on.
Do not polish early. Get a correct end-to-end vertical slice first, then widen it.

PRIORITY TIERS (if context or time runs short, finish higher tiers first):
  MUST:   Phases 0-3 and the persistence/immutability tests, plus all existing suites staying green.
  SHOULD: Phases 4-5 (host UI, live UI) and the live browser tests of Phase 6.
  COULD:  Workers-runtime live test, load rerun, screenshots, extra polish within scope.
Never start a lower tier while a higher tier has unfinished work, unless it is blocked.

=====================================================================
1. AUTHORIZATION AND DECISION PROTOCOL
=====================================================================
The owner authorizes WP-H end to end, LOCAL ONLY, with no approval pauses.
No keys or secrets are needed. Never read, print or log any secret or .env value. For auth in tests use the
existing local development identities and the existing ephemeral-key test harness only.

When something is ambiguous: choose the safest, most reversible option consistent with this prompt,
record it in WP-H-DECISIONS.md, and continue. Never stop to ask.
Hard blockers (anything on the NEVER list, a destructive or incompatible migration, a security-sensitive
change): do NOT do it. Record it in PROGRESS.md and the final report, skip that item, and continue with
everything else.
Failing tests: fix the root cause. Never delete, skip, weaken or special-case an existing test.
After 3 failed attempts on one issue, record it with details, implement a safe workaround or leave the item
documented as open, and move on.
Environment trouble (port in use, missing browser, tool not offline): try a reasonable alternative
(different port, existing project scripts, the isolated-copy approach used in earlier packages), record it,
and continue. Kill any server or process you start; leave no orphan processes. Give long commands sensible
timeouts so a hung command cannot stall the run.
Low context or tokens: finish the current step, run its tests, update PROGRESS.md, NEXT_AGENT_HANDOFF.md and
docs/reports/BUILD-STATUS.md, then stop cleanly. Another session must be able to resume from PROGRESS.md alone.
Never claim a result you did not verify. If something was not tested, say so.

=====================================================================
2. OBJECTIVE
=====================================================================
New rooms use the real 250-player catalog. The host chooses Quick (80), Standard (120, the default) or
Mega (250), previews a generated seeded auction order, can regenerate it, then approves and starts.
The existing live auction runs exactly that approved order, showing each player's photo and the relevant
team logos. Participants see authoritative server state.
Do NOT change bidding, budget, settlement, squad or overseas rules. Do NOT rewrite working features.
Reuse existing code, naming and conventions (packages WP-A..G, evidence folders, storage port).

READ FIRST: AGENTS.md, NEXT_AGENT_HANDOFF.md, PROJECT_STATUS.md, README.md, docs/reports/BUILD-STATUS.md,
the relevant task records under docs/plan/tasks/, then the code for: player data and types, room creation and
setup, engine lot sequencing and unsold handling, the storage port and both implementations (local file store
and room Durable Object), snapshots and messages, host setup UI, live bidding UI, and the Package G Workers
runtime test setup. Identify what already exists before changing anything.

=====================================================================
3. PHASE 0 — INSPECT AND PLAN (then continue immediately)
=====================================================================
- Inspect the CSV schema. Needed per player: ID, name, role, tier, overseas/nationality, base price, marquee.
  If a field is missing, do not invent data: define a deterministic derivation rule or an explicit config
  file (for example a small marquee-ID list), and record it.
- Map CSV roles to the engine's existing role taxonomy; record the mapping.
- Read the maximum participating teams and squad min/max/overseas rules. Compute whether 80/120/250 pools can
  satisfy them for the maximum number of teams, and record any limits you find.
- Check how many teams exist and whether the logo set matches the app's current team identities. Do not rename
  existing teams. Match logos only by stable team ID or exact name; anything unmatched uses a generated crest.
- Validate the catalog: unique IDs, known roles and tiers, positive base prices, no duplicate names. Report
  problems; do not silently fix data.
- Write docs/plan/tasks/WP-H-PLAYER-POOLS.md (findings, files to change, data model, risks), then continue.

=====================================================================
4. PHASE 1 — ASSETS AND CATALOG (copy only, no downloads)
=====================================================================
- Create a re-runnable, idempotent script: npm.cmd run assets:ingest.
  It copies photos into the static assets location as <playerID>.webp, copies logos by team ID, and
  regenerates an asset manifest JSON (ID, path, credit, license, source, status). It prints counts of
  matched / missing / ambiguous and exits cleanly when files are missing. It never guesses a match and never
  uses another player's image. It must be safe to run again as more photos arrive.
- Create a catalog build/validation step that turns the CSV into the typed catalog the app uses.
- Missing photo or logo: deterministic fallback (the existing CSS illustration or an initials avatar for
  players; a generated crest for teams). Bundle only assets with a recorded license/provenance; list every
  other asset as unresolved and use the fallback for it.
- Add an "Image credits" view driven by the manifest (CC BY and CC BY-SA require visible attribution).
- Everything must work in the production-style Vite build served by Workers Assets, with no R2 and no
  external hosting. Report the total asset size and file count.
- Version the catalog (catalogVersion). Existing rooms, including fixtures 139DCB and 19B480, keep their
  existing player data and sequencing untouched. New rooms use the new catalog. Avoid ID collisions with the
  old data.
- Code must use path.join and forward-slash public URLs. Never hardcode Windows paths in application code.
- If .gitignore needs entries (for example exports/), add them and record it. Do not commit.

=====================================================================
5. PHASE 2 — PURE PLANNER (no I/O, fully unit-tested)
=====================================================================
Implement in the engine/shared package:
  planAuction({ catalog, mode, seed, rules }) -> { poolIds, sets: [{ name, playerIds }], adjustments[] }
- Seeded PRNG only. No Math.random, no Date, no environment access. Same inputs always give the same output.
- Modes and default tier quotas:
    Quick 80:     A20  B25  C20  D10  E5
    Standard 120: A26  B35  C35  D16  E8   (default)
    Mega 250:     all players
  Validate against the real catalog. If a quota cannot be met, adjust deterministically, record it in
  adjustments[], and surface it in the preview. If a mode is still infeasible for the rules, block that mode
  with a clear reason instead of generating a broken pool.
- Pool selection: respect tier quotas and role balance, and keep enough overseas and domestic players for the
  maximum number of participating teams under the existing squad rules. Prefer curated marquee eligibility.
- Order invariants (write them as property tests over many seeds and all three modes):
    1. Every selected player appears exactly once; no extra and no missing players.
    2. Opening set: 6-8 mixed-role marquee players.
    3. Role-wise sets of about 5-8 players; no more than 3 consecutive same-role players in any mixed set.
    4. Marquee players appear in at least three separate sets (opening, middle, late). No tier is
       clustered entirely at the start. Do not place every superstar first.
    5. Established and emerging players are spread across rounds; remaining squad-building sets come last.
    6. Players are shuffled within sets using the seed; the same seed reproduces the same order.
- Unsold-player recall stays separate from the initial order and keeps its existing behavior.
- Add npm.cmd run plan:export to write exports/auction-order-80.csv, exports/auction-order-120.csv and
  exports/auction-order-250.csv using a documented fixed seed. Columns: position, set name, player ID, name,
  role, tier, marquee flag, base price, image reference. These are generated review exports, not hardcoded
  permanent sequences.

=====================================================================
6. PHASE 3 — PERSISTENCE, API AND SECURITY
=====================================================================
- Per room persist only: catalogVersion, mode, seed, planVersion, approvedAt, approvedBy, orderedPlayerIds,
  setBoundaries. Store IDs only, never full player objects.
- Implement through the storage port for BOTH the local file store and the SQLite-backed room Durable Object,
  using an additive migration. Add storage parity tests (same behavior on both). Rooms without a plan keep
  their legacy behavior and keep working.
- The server generates the seed. Once approved, the plan is immutable and is NEVER regenerated on reconnect,
  page refresh, server restart, Durable Object recovery or hibernation wake. Write a test for each case.
- Host-only endpoints, authorizing before any action: preview, regenerate (new seed), approve-and-start,
  export CSV (generated on demand from the room's plan). Reject non-hosts, wrong room, already-started rooms,
  and stale versions. Reuse the existing expectedVersion/receipt mechanisms where they apply.
- Participants do not receive the upcoming order by default. They get the current lot, current set name/index,
  and remaining counts. The host sees the full preview.
- Snapshots must stay within the existing size bounds. Never include the full order in every snapshot.
- Do not weaken existing validation, bounds, receipts, deduplication or authorization.

=====================================================================
7. PHASE 4 — HOST SETUP UI
=====================================================================
Extend the existing host setup screen: mode selector (Standard preselected), pool preview with tier, role and
overseas counts and any quota adjustments, order preview grouped by set, regenerate, approve-and-start, and a
CSV download. Include pending, error and blocked-mode states with clear text. Keep keyboard access, focus
handling and accessible names consistent with the rest of the app.

=====================================================================
8. PHASE 5 — LIVE BIDDING UI
=====================================================================
Show the current player's photo and the relevant team logos on the live screen. Player photos must not be
distorted; logos use object-fit: contain. Provide meaningful alt text, graceful image-error fallbacks, eager
loading for the current lot and preloading for the next. Layout must work on desktop and mobile with the
current bid, timer, leading team and bid controls staying prominent. All live information comes from
authoritative server state. No keyboard or screen-reader regressions; axe must stay at zero violations.

=====================================================================
9. PHASE 6 — VERIFICATION (all local, evidence saved)
=====================================================================
1. Automated: typecheck, build, core, local, browser and accessibility suites. Zero new failures, skips or
   flaky cases. Use npm.cmd in PowerShell. Existing tests must keep passing.
2. Live multi-user browser tests (real browser, two or more profiles, local development identities):
   create a room, join, claim teams, run each mode (80, 120, 250): preview, regenerate, approve and start,
   bid through at least one full set, confirm the live lot sequence equals the approved order, exercise unsold
   recall, view the results page, and confirm host-only authorization and participant order privacy.
3. Persistence: browser refresh, reconnect, local server restart and Durable Object recovery all continue the
   SAME approved sequence.
4. Workers runtime: run the real Worker and room Durable Object in local wrangler dev/workerd (as in
   Package G) and repeat the core flow plus hibernation/alarm behavior. If auth is required, use the existing
   ephemeral-key harness. No real keys, no new Clerk users. If wrangler is unavailable, record that and skip.
5. Load: rerun the existing harness (100 users across 5 rooms; 250 users if time allows) using plans from
   the new planner. Compare with the Package G figures and report any regression.
6. Save desktop and mobile screenshots of the setup preview and the live bidding screen.
7. Run browser, load and any data-writing tests in an isolated copy of the project with a fresh
   AA_EVIDENCE_DIR; never against the original private data or fixtures. Save evidence under
   docs/reports/evidence/WP-H-PLAYER-POOLS/ without overwriting any earlier evidence.
8. Update README.md, PROJECT_STATUS.md, NEXT_AGENT_HANDOFF.md and docs/reports/BUILD-STATUS.md accurately,
   including replacing the old "fictional data" statements. State clearly what was and was not verified.

=====================================================================
10. NEVER (even if tempted)
=====================================================================
- Deploy or redeploy staging or production; run any wrangler deploy.
- Commit or push to git.
- Create accounts, Clerk users, settings, paid services or new infrastructure (R2, D1, KV, Queues, Pages).
- Read, print or log secrets or .env values.
- Delete or overwrite original assets, evidence, fixtures 139DCB/19B480, or retained superseded infrastructure.
- Change bidding, financial, settlement or squad rules.
- Run destructive or incompatible migrations.
- Download anything from the internet, or fetch images or logos from the web.
- Touch the owner's private runtime data directly; use the isolated copy for tests.

=====================================================================
11. SCOPE GUARD
=====================================================================
No new features beyond this prompt: no drag-and-drop reordering, custom auction sizes, animations, advanced
image optimization or new budget rules. Record such ideas in WP-H-REPORT.md instead of building them.
If time remains after all phases pass: add loading skeletons and image-error handling, tidy documentation,
and re-run the full suites once more.

=====================================================================
12. DEFINITION OF DONE AND FINAL REPORT
=====================================================================
Done means: all phases complete, all suites green, every claim backed by saved evidence, no stray processes,
no secrets exposed, no commits made.
Write docs/plan/tasks/WP-H-REPORT.md, then summarize in the final message:
  - changed and added files;
  - asset counts (matched / missing / fallback) and unresolved licenses or logo provenance gaps;
  - quota adjustments and any blocked modes;
  - generated CSV paths;
  - every test result (automated, live browser, persistence, Workers runtime, load) with evidence paths;
  - decisions made (summary of WP-H-DECISIONS.md);
  - skipped or blocked items and why;
  - open issues and risks;
  - the exact command to re-run asset ingestion when more photos arrive (npm.cmd run assets:ingest);
  - recommended next steps.
