# Local auction experience

Quick 80, Standard 120 and Mega 250 use the existing host preview, regenerate and approve-and-start flow. The initial order is locked on approval. The room displays the current player and server-confirmed bid or settlement. The host can end early and settle the current accepted bid. Final results read persisted room state and show sold, unsold and unauctioned players, each team’s purchases, remaining budget and squad size.

## Player portraits

All 250 catalog entries have artwork. The 224 supplied WebPs have unique paths, decode successfully and match their manifest player IDs and source filenames. The other 26 use the shared demo artwork, with initials in compact lists and an illustrated cricketer on the live card. The same artwork component appears in plan previews, the player pool, live lots, squads and results. It renders the fallback while a photo loads or if its request fails. The live photo loads eagerly and list photos load lazily.

The catalog and [asset manifest](../../packages/catalog/src/data/assets.json) retain the per-player mapping and distinguish bundled photos, supplied placeholder files and missing sources. Existing photos and source files were preserved. Photo licenses and attribution are still unrecorded and need review before public release.

| Catalog ID | Player | Source status |
| --- | --- | --- |
| P013 | Narayan Jagadeesan | Supplied placeholder |
| P016 | KS Bharat | Supplied placeholder |
| P023 | Jonny Bairstow | Supplied placeholder |
| P086 | Joe Root | Missing |
| P123 | Andre Russell | Supplied placeholder |
| P124 | Moeen Ali | Supplied placeholder |
| P125 | Sam Curran | Supplied placeholder |
| P137 | Ben Stokes | Supplied placeholder |
| P138 | Mohammad Nabi | Supplied placeholder |
| P152 | Harshit Rana | Supplied placeholder |
| P155 | Umesh Yadav | Supplied placeholder |
| P161 | Akash Deep | Missing |
| P176 | Mohit Sharma | Supplied placeholder |
| P183 | Siddharth Kaul | Supplied placeholder |
| P185 | Chetan Sakariya | Supplied placeholder |
| P192 | Sandeep Warrier | Supplied placeholder |
| P201 | Piyush Chawla | Supplied placeholder |
| P214 | Rahul Sharma | Missing |
| P216 | Parvez Rasool | Missing |
| P227 | Mustafizur Rahman | Missing |
| P233 | Mark Wood | Supplied placeholder |
| P234 | Alzarri Joseph | Supplied placeholder |
| P243 | Mujeeb Ur Rahman | Supplied placeholder |
| P246 | Adam Zampa | Supplied placeholder |
| P248 | Keshav Maharaj | Supplied placeholder |
| P250 | Adil Rashid | Supplied placeholder |

## Unsold recall

Newly approved catalog plans offer one recall round if their full initial order settles and at least one unsold player can still receive an opening bid under the existing rules. Even with automatic advancement, the auction waits for the host to start recall or finish. Early completion for affordability, full squads, or a host decision follows the original flow. Previously approved plans and legacy sample rooms keep their original behavior.

Only a connected host can start recall. The server selects unsold players in original approved order, excludes anyone already owned, and applies the same opening price, budget reserve, squad and overseas limits. The server checks eligibility again before opening each recall lot and skips any player who can no longer be bought. A player can be recalled at most once. Recall state and its cursor are durable, while participants receive only recall progress and the current lot. Recall bids require the current room version, so an old initial-round bid cannot be applied to the same player during recall. Receipts still deduplicate retries. Completing the auction clears the active queue and preserves the settlement history and final player states.

## Verification

Tests used an isolated checkout copy with fresh temporary data and local test identities. The protected Clerk fixtures, source assets, bundled photos and earlier evidence match the recovery baseline. The active `.data/auctionarena.json` was updated between sessions after the full browser run. The test runners use their own data paths and the existing local database was left as found.

| Mode | SQLite room actor with controlled clock | Chromium desktop and mobile viewport |
| --- | --- | --- |
| Quick 80 | All 80 initial lots and 79 recall lots settled. Two players sold and 78 finished unsold. | Complete opening set in approved order, a sale and unsold lots, host completion, sold and unsold lists, squads and results after refresh. |
| Standard 120 | All 120 initial lots and 119 recall lots settled. Two players sold and 118 finished unsold. | Complete opening set in approved order, live sales, host-only CSV, refresh with the approved lot and host-ended results. |
| Mega 250 | All 250 initial lots and 249 recall lots settled. Two players sold and 248 finished unsold. | Full 250-player preview, complete opening set in approved order, live sales, host completion and participant results after refresh. |

The SQLite actor tests use the application Durable Object implementation, in-memory SQLite, socket doubles and a controlled alarm clock. They verify host authorization, replayed receipts, stale versions, recovery during an active recall bid, fresh state after restart, unique ownership and budget reconciliation. A separate file-backed local API test completes the Quick initial order and verifies that the skip-recall decision survives a restart. Browser coverage uses the local Node API and real WebSockets; complete pools and recall are exercised in the SQLite actor tests.

| Check | Result |
| --- | --- |
| TypeScript and local production build | Passed. Build emitted existing dependency annotation warnings. |
| Core | 311 passed across 22 files, including the local Hono API and SQLite room actor tests. |
| Local Node suite | 78 passed. |
| Full browser regression | 50 passed, 25 desktop and 25 mobile viewport, with zero failed, skipped or flaky before the final artwork and loading refinements. |
| Focused browser follow-up | 8 passed, 4 desktop and 4 mobile viewport, on the final artwork, loading and empty-state changes. Covered photo layering, failed-image fallback, Quick live opening and results, keyboard navigation and narrow reflow. |
| Automated accessibility | Full run had 34 axe scans and the final follow-up had 32, both with zero violations. The final follow-up had 26 incomplete rule entries requiring human assessment. |
| Image coverage | 224/224 distinct WebPs decoded and mapped to the supplied filenames. All 26 demo portraits and one deliberately failed photo request were exercised in the browser. |

## Review limits

The defined auction flow is functionally complete for local use. Remaining production review covers photo rights, human accessibility and real mobile browsers, production Clerk lifecycle and webhooks, Cloudflare alarm scheduling and hibernation behavior, and production load and operational limits. The full 250-player completion used controlled time in the SQLite actor test. Browser runs covered opening sets and host-ended results. The previous 1,000-user load result remains a separate historical measurement.
