# Dependency hardening review

Status: upgrade/regression scope verified; two moderate development-tooling advisory entries remain open.

The baseline host audit has seven affected package entries: two critical, one high and four moderate. Counts include transitive chains, not seven independent exploit paths. The original report remains under WP1-ACCESSIBILITY; before-versions.json records the installed baseline and Clerk SDK versions.

## Selected updates

| Package | Before | Selected | Compatibility boundary |
| --- | --- | --- | --- |
| zod | 3.25.76 | 4.6.7 | Default application, strict objects, refinements, integer bids, custom/pipe update validation and ZodError handling |
| vitest | 3.2.7 | 5.1.0 | Mock history defaults, fake timers, configuration loading and worker implementation |
| @hono/node-server | 1.19.18 | 2.1.3 | Node HTTP server, response streaming/body limits, native server upgrades and shutdown |
| vite | 6.4.6 installed; manifest allowed 6.3 | manifest minimum 6.4.6 | Vitest 5 requires Vite >=6.4 and Node >=22.12 |

The application already requires Node 22.15 for its TypeScript loader; package.json now declares that minimum. This machine has Node 22.23.2. Existing schema defaults are valid output values and do not rely on a transform of an undefined default. Zod 4 rejects unsafe integer bids at the HTTP schema boundary, aligning with the existing engine's safe-integer money constraints. API rejection codes and custom refinement messages are preserved; upstream generic validation wording may differ.

Six added contract/real-HTTP tests exercise defaults, explicit false/zero values, trimmed names, strict settings/actions, squad/pool refinements, complete settings updates, safe bids, JSON INVALID_INPUT errors, auth/CORS, unchanged state on rejection and a streamed request exceeding the 4KB cap. These additions complement the complete existing core/local/browser regressions.

Installation is now observed in the lockfile: Zod 4.6.7, Vitest/Mocker 5.1.0 and adapter 2.1.3. No Tinypool copy remains in the dependency graph. Both Clerk SDKs and Hono/Vite retain their previous installed versions. The first post-install check exposed Zod 4's stricter pipe input compatibility; the update-settings guard now explicitly uses the downstream input type while still requiring every setting at runtime. A real HTTP test also exposed the existing generic error handler converting body-limit exceptions into 500 responses. An explicit body-limit handler now returns JSON PAYLOAD_TOO_LARGE with status 413 and a request ID for both fixed-length and streamed bodies. Invalid action tests still return INVALID_INPUT and leave the room unchanged. TypeScript, all six new tests, all 84 core tests and all 76 local tests pass.

The production bundle builds and all 24 browser cases pass in one clean run (zero failed/flaky/skipped, 9.4 minutes). The browser run covers actual HTTP/WebSocket create/join/claim, strict admission and identity isolation, live bids/sales/results, heartbeat expiry/resume, clipboard fallbacks, late spectator policies and purse-depletion completion on desktop/mobile viewports. Both 16-state axe matrices still report zero violations, with incomplete findings in 27 states retained for human review. Human screen-reader/device/Safari and full WCAG conformance remain unverified. Both owned test-server ports are stopped. validation.json ties these results to the installed lockfile hash.

The fresh host audit now reports zero critical, zero high and two moderate entries. All five targeted entries are absent: Zod, Vitest, Mocker, Tinypool and the Node adapter. The remaining two entries are the CDK/minimatch chain described below. dependency-audit.json records the fresh counts, exact remaining versions, advisory and lockfile SHA-256; no old report is presented as a post-fix audit. npm ls --all also exits zero. The remaining findings are open, not waived or suppressed.

## Bundled CDK finding

The installed aws-cdk-lib 2.276.0 is also the latest published release observed on 2026-11-11. Its published source declares and bundles minimatch ^10.2.6. The minimatch advisory affects >=7.0.0 <11.0.1, and the audit traces the copy to node_modules/aws-cdk-lib/node_modules/minimatch. A root direct dependency would not replace that bundled copy. No untested major override, package repack, downgrade or audit suppression is applied.

The local web/API/engine/realtime sources do not import CDK. Both remaining entries are marked development-only in the lockfile; the undeployed infra foundation is separate developer tooling. CDK's asset ignore strategy does use minimatch, so the package is not declared harmless: avoid untrusted glob inputs and resolve the remaining advisory through a verified supported release or separately tested patch. npm's generic fixAvailable flag is retained; it does not establish compatibility of a changed bundled major or older CDK. This dependency task does not alter or deploy infrastructure, and does not establish production security. The fresh host audit confirms these two moderate entries remain.

## Sources inspected

- [Zod advisory and patched version](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Zod 4 migration: defaults, integers, issue formats](https://zod.dev/v4/changelog)
- [Vitest 5 migration and prerequisites](https://vitest.dev/guide/migration/)
- [Vitest 5.1.0 manifest](https://github.com/vitest-dev/vitest/blob/v5.1.0/packages/vitest/package.json)
- [Mocker traversal advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- [Mock registration advisory](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
- [Tinypool worker-option advisory](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) and [run-option advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)
- [Node adapter 2.1.3 security release](https://github.com/honojs/node-server/releases/tag/v2.1.3)
- [Minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [CDK latest release](https://github.com/aws/aws-cdk/releases/latest) and [2.276.0 manifest](https://github.com/aws/aws-cdk/blob/v2.276.0/packages/aws-cdk-lib/package.json)

Agent npm access failed with EACCES before any installation. The user ran npm install and saved a new audit from the host. No secret environment values were printed, no Clerk fixture was replayed and no AWS service operation was performed.
