---
id: WP1-AWS-MCP-REPAIR
title: Repair the existing AWS MCP launcher and establish a safe Git baseline
owner: platform
reviewers: [architect, security]
phase: 0
paths: [scripts, tests/core/aws-setup-profile.test.ts, docs, AGENTS.md, NEXT_AGENT_HANDOFF.md, PROJECT_STATUS.md, .gitignore]
acceptance:
  - Resolve and execute the installed uvx without installing tools or logging in again
  - Back up Codex configuration before a narrow AWS-entry edit
  - Save the absolute launcher, preserve proxy arguments and unrelated configuration
  - Preserve requested AWS profile and Region environment values and merge the proxy profile list
  - Run the explicitly requested Toolkit/VerifyToolkit command and record exact outcomes
  - Update the bootstrap helper and stale connection records with actual evidence
  - Initialize Git and create a baseline commit after a staged secret/exclusion check
  - Do not restart Codex, deploy resources, or begin Phase 1 before reporting Phase 0
status: in_review
---

2026-11-12 connected audit (supersedes earlier connection observations): AWS MCP connectivity is verified: 8 exposed tools, successful agent_skills documentation search, retrieval of signing-in-to-aws, and STS GetCallerIdentity. The returned ARN exactly matches the login_session saved under AuctionArena (project ID ending 2955; AccountFullAccessRole). The local profile and plan use ap-south-1 (Mumbai). The owner reports that the sign-in page assigns project "Array of Sunshine" to ap-southeast-2 (Sydney). This discrepancy is unresolved: the assigned project Region/name were not independently verified, no connected browser was available, and STS does not establish assigned Region. No AWS resources, configuration, deployment, Clerk data or migrations changed. Phase 2 has not started. Evidence: docs/reports/evidence/WP1-AWS-SETUP/connected-verification.json. Earlier vendor wizard failure is historical; it was not rerun. Review status is retained.

2026-11-12: User authorized this narrow repair, a backed-up config edit, the toolkit rerun and Git initialization. Prior EPERM restrictions are gone. Bare uvx fails ENOENT in the inherited process PATH; the installed absolute executable runs. No AWS MCP tools are currently exposed. Profile AuctionArena and resource Region ap-south-1 remain selected; toolkit endpoint Region remains us-east-1.

The original config, generated proxy metadata and all other MCP entries must remain private and preserved. The current env contains AWS_MCP_PROXY_PROFILES=AuctionArena; add the user-requested AWS_PROFILE=AuctionArena and AWS_REGION=ap-south-1 without replacing any existing conflicting selection silently.

User-approved sequence after this checkpoint: Phase 1 rule/timing/privacy/deletion fixes with tests and full evidence; Phase 2 bounded storage/messages; Phase 3 real distributed backend after MCP guidance and an approved costed staging design; Phase 4 approved Clerk tests, host CDK probe and human accessibility; Phase 5 CI/refactoring/operations and deployment proposal; Phase 6 later features. One phase at a time. No resource creation or Clerk fixture/settings mutation is approved by this task.

2026-11-12: Saved for owner review/restart decision. Absolute launcher repair and backup/config preservation pass. Requested wrapper exit 1, vendor wizard 255 with WinError 2; catalog 122 passes. Fourteen focused helpers and 136 core cases pass, as do TypeScript and PowerShell syntax. Git initialized on main; baseline requires staged credential/exclusion check before commit. No restart, deployment or Phase 1 work. Evidence: docs/reports/evidence/WP1-AWS-MCP-REPAIR/. This status does not claim live MCP connectivity or a successful vendor wizard.

2026-11-12 follow-up: restart approval received; baseline commit is 2ce72bb. Explicit debug wizard rerun exited 255 at bare codex subprocess launch. Absolute codex.cmd/native codex.exe execute; the bare name fails WinError 2 despite which resolving the CMD shim. Child aws/uv/uvx execute with process-only PATH additions. All three MCP config files remain byte-identical. Current AWS tool list remains empty after an observed host-server restart. MCP guidance/STS remain unverified. Diagnosis/evidence: WP1-AWS-SETUP/reconnect-diagnosis.md. Phase 0 result reported and Phase 1 explicitly started; no resource or config mutation followed the diagnostic failure.
