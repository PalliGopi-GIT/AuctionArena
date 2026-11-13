# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

# AuctionArena project status

## Project Region confirmation

The owner confirms AWS Settings assigns project "Array of Sunshine" to **ap-southeast-2 (Sydney)**. The earlier Mumbai plan is superseded pending the owner's decision. The aws-mcp environment and setup helper now use Sydney; the local AWS profile has not been changed and was last verified as ap-south-1. This note supersedes earlier Region statements below. No resource creation or deployment is authorized.

## Latest read-only MCP audit — 12 November 2026

AWS MCP connectivity is verified: 8 exposed tools, successful agent_skills documentation search, retrieval of signing-in-to-aws, and STS GetCallerIdentity. The returned ARN exactly matches the login_session saved under AuctionArena (project ID ending 2955; AccountFullAccessRole). The local profile and plan use ap-south-1 (Mumbai). The owner reports that the sign-in page assigns project "Array of Sunshine" to ap-southeast-2 (Sydney). This discrepancy is unresolved: the assigned project Region/name were not independently verified, no connected browser was available, and STS does not establish assigned Region. No AWS resources, configuration, deployment, Clerk data or migrations changed. Phase 2 has not started.

Evidence: [connected verification](docs/reports/evidence/WP1-AWS-SETUP/connected-verification.json). This audit supersedes the older connection/restart statements below and in the earlier status.json/mcp-check.json snapshots. Earlier Mumbai selection describes the plan/profile, not a verified project assignment. Phase 1 remains committed as 03b98b2; application tests and billing/credits were not rerun. No Region correction or Phase 2 work is authorized by this audit.

## Prior checkpoint record

Updated: 12 November 2026 (Asia/Calcutta).

## Current Phase 1 result

Phase 1 rule fixes are complete for their local scope: TypeScript and production build pass; 164 core tests, 76 local tests and all 32 Chromium desktop/mobile-viewport browser cases pass with zero failures/skips/flaky cases. All 34 axe scans report zero violations; human accessibility remains unverified. The owner confirmed +10 below 200, +20 from 200 through 500 inclusive, +25 above 500 for new rooms only. Existing rooms retain flat rules and accepted prices. Evidence: WP1-RULE-FIXES/validation.json. The owner says this Codex session predates the config repair and will restart Codex after the Phase 1 commit; defer interactive /mcp verification to that fresh session. The current tool list remains empty, which does not prove the saved launcher is broken. The debug wizard failure is identified as bare codex (Windows CMD-shim subprocess resolution), exit 255; all three MCP config files stayed unchanged. Do not blindly rerun registration or edit config. No AWS resources, Clerk users/settings or SQL migrations were created or changed. Phase 2 has not started.

The Phase 0 checkpoint below is historical. Git baseline **2ce72bb** is saved on main; Phase 1 is saved in the checkpoint commit titled fix: complete Phase 1 auction correctness. See [task](docs/plan/tasks/WP1-RULE-FIXES.md), [rule evidence](docs/reports/evidence/WP1-RULE-FIXES/) and [AWS diagnosis](docs/reports/evidence/WP1-AWS-SETUP/reconnect-diagnosis.md).

## Phase 0 results

| Check | Result |
| --- | --- |
| Original inherited PATH | Bare uvx was not found (ENOENT); the earlier EPERM restriction is obsolete |
| Installed launcher | uvx 0.13.7 executes successfully using its absolute path |
| Codex configuration | Only the aws-mcp launcher/project env changed; private original backup verified; proxy arguments and unrelated config preserved |
| Saved launcher | C:\Users\palli\AppData\Local\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uvx.exe |
| Project env | AWS_MCP_PROXY_PROFILES includes AuctionArena; AWS_PROFILE=AuctionArena; AWS_REGION=ap-south-1 |
| Requested Toolkit/VerifyToolkit command | Overall exit 1; vendor wizard exit 255: `[WinError 2] The system cannot find the file specified` |
| Independent catalog verification | Passed: 122 skills; existing Codex config and unrelated entries in two other detected agent configs preserved |
| PowerShell syntax / TypeScript | Passed |
| Focused Windows bootstrap tests | 14 passed, 0 failed/skipped |
| Full core suite | 136 passed, 0 failed/skipped |
| Current session AWS MCP tools / identity | No tools exposed; transport, skill calls and identity not yet verified |

The command used was `powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-aws.ps1 -Toolkit -VerifyToolkit`. The later approved debug rerun identifies bare codex in the vendor registration subprocess; see the reconnect diagnosis. The installed proxy launcher itself works. Catalog access is not proof of a working MCP connection.

The Git repository is initialized on main. This Phase 0 snapshot is included in the initial baseline commit; obtain its identifier with `git log -1`. Runtime data, environment files, installed dependencies, test artifacts and private tool configuration are excluded. The staged credential/exclusion check is recorded with the [Phase 0 evidence](docs/reports/evidence/WP1-AWS-MCP-REPAIR/validation.json).

## Application state

The application remains a working single-process local adapter. Prior evidence: 76 local tests, one clean 28-case browser run and 34 axe scans with zero reported violations. Those suites and the frontend build were not rerun for this bootstrap-only change. The ownership coordinator has 20 model cases and is not wired to real datastore adapters. Live provider challenges/webhook/deletion, human accessibility, distributed recovery and measured cloud capacity remain unverified. Two moderate CDK/minimatch package entries remain open.

Selected resource Region: ap-south-1. Profile: AuctionArena. Toolkit endpoint Region: us-east-1. The FREE/ACTIVE plan and 100 USD credits are historical host checks, not newly verified billing state. Policy remains $0 out of pocket and $10/month staging from credits. No resource creation is authorized.

## Approved sequence and gates

0. Restart approval received. Current tool inventory remains empty after observed host-server recovery. When the host exposes AWS tools, verify skill retrieval/identity. No config change or wizard rerun is planned.
1. Phase 1 rule/timing/privacy/deleted-account fixes complete: TypeScript/build/core164/local76/browser32/axe34 pass. Save/commit and report before Phase 2; the owner will restart Codex afterward.
2. Bound heartbeat writes, history, receipts and messages; add replay/history paging and large-history tests. Not started.
3. After working MCP guidance/identity checks, present a costed staging design and wait for approval before choosing a cheaper architecture. Then implement and prove real adapters/recovery/routing/archive, obtain independent ownership review, and complete database/account lifecycle work. No cloud resource or migration execution is approved here.
4. Obtain approval for concrete Clerk test fixtures before creation/settings changes; perform the authorized host CDK probe and guided human Windows/Android accessibility checks.
5. CI, boundaries, coverage, dependency resolution, frontend decomposition and operations; present a costed deployment plan and await explicit approval.
6. PWA, expanded content, sound, bots, chat, quick mode, watchlists, discovery, leaderboards, transfer and moderation.

One phase at a time, with exact results after each. Preserve completed Clerk fixtures 139DCB/19B480. Do not infer approval to restart, create resources or create/change Clerk accounts/settings from these plans.
