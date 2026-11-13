---
id: WP1-DEPENDENCY-HARDENING
title: Resolve dependency advisory matches with compatibility-tested upgrades
owner: conductor
depends_on: [WP1-ACCESSIBILITY]
phase: 1
paths: [package.json, package-lock.json, packages/shared, apps/api, tests, docs]
acceptance:
  - Inspect exact installed/advisory versions and select supported fixes before installation
  - Resolve or explicitly document remaining audit findings without blind force upgrades
  - Preserve validation defaults, rejection contracts, verified-subject ownership and auction invariants
  - TypeScript, core/local/browser regressions and a fresh audit verify the final dependency set
  - No deployment, live-fixture replay or private-key disclosure
evidence_required: [dependency-audit, typecheck, core-tests, local-tests, browser-regression]
status: done
---

The user's host npm audit reported seven affected package entries after adding the accessibility test tool: two critical, one high and four moderate. The report is saved, sanitized with installed versions and advisory links, at docs/reports/evidence/WP1-ACCESSIBILITY/dependency-audit.json. Critical entries include Vitest 3.2.7 and its Tinypool 1.1.1 chain; Zod 3.25.76 is high. Other entries are @hono/node-server 1.19.18, @vitest/mocker 3.2.7, superseded infrastructure library 2.276.0 and minimatch 10.2.6. Counts reflect npm's affected package entries, not independent exploit paths or verified runtime exploitation.

Installed Zod 4.6.7, Vitest 5.1.0 and @hono/node-server 2.1.3; raised the manifest Vite minimum to the already installed 6.4.6 and declared Node >=22.15. Clerk SDKs are unchanged and Tinypool is absent from the updated graph. Adapted the Zod pipeline's input type while preserving the complete-settings guard. Fixed oversized bodies returning generic 500 errors by adding an explicit JSON 413/PAYLOAD_TOO_LARGE handler.

Six new contract/real-HTTP checks, TypeScript, production build, all 84 core tests and all 76 local tests pass. The complete browser suite passes all 24 cases in one clean run (0 failures/flaky/skipped, 9.4 minutes). Both 16-state axe matrices report zero violations; incomplete/human checks remain open. Both owned test ports are stopped. Evidence is in docs/reports/evidence/WP1-DEPENDENCY-HARDENING/validation.json and its adjacent logs/reports.

Completed 2026-11-11 for the supported upgrade/regression and explicit-residual-documentation scope. Agent npm network access is restricted, so the user ran installation and saved a fresh host audit. That report resolves five baseline package entries and now reports zero critical/high findings and two open moderate entries: superseded infrastructure library 2.276.0 and its bundled minimatch 10.2.6. The latest reviewed infrastructure package still bundles the affected version; no force override, downgrade or suppression was applied. dependency-audit.json preserves the fresh counts/advisory, and review.md explains the residual and source references. The remaining entries are open, not waived; this task does not establish a clean audit or production-security pass.

Production-mode refusal, local file ownership and the existing linked Clerk setup are preserved. No deployment, cloud service operation or live-fixture replay occurred. Track a supported infrastructure dependency bundle fix or a separately verified patch as follow-up; review whether the superseded dependency can be removed only after the new runtime passes and the owner approves.
