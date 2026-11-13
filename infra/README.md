# SUPERSEDED by Cloudflare architecture v3.0

Historical undeployed foundation; do not deploy. Retained until owner-approved later cleanup.

# AWS foundation — not deployed

The selected Region is **ap-south-1 (Mumbai)** and the named profile is **AuctionArena**, as updated by the user on 11 November 2026. These supersede the earlier Sydney/profile instructions. Confirm the selected Region in **AWS Settings → View all projects → Overview → Additional Info → Region**. The `us-east-1` toolkit endpoint does not change the resource Region.

No AWS resource deployment, including CDK bootstrap, is authorized without explicit approval. The user requires $0 out-of-pocket spending and a $10/month staging budget from credits. The existing foundation has no validated estimate showing it fits that budget.

This template defines a two-AZ VPC, Aurora PostgreSQL, encrypted Redis, a DynamoDB table with PITR and a deadline index, an archive queue/DLQ, private S3 assets, an empty ECS cluster and CloudWatch alarms. It has no application service, public listener, DNS, CDN or WAF. Data uses retention/deletion protection. Alarm actions need an operations destination. Two NAT gateways, Redis nodes and Aurora instances have ongoing costs even while auctions are idle; the foundation is not approved for deployment.

## Connection status

The host previously verified AWS CLI identity, the profile's Mumbai default, FREE/ACTIVE plan, 100 USD remaining credits and remote skill-catalog retrieval. The generated Codex proxy entry is saved with `AWS_MCP_PROXY_PROFILES=AuctionArena`. Do not repeat login, installation or entry import. See [setup details](../docs/AWS-TOOLKIT-SETUP.md) and [handoff](../NEXT_AGENT_HANDOFF.md).

The latest Phase 0 repair saved an absolute installed uvx launcher with a verified private backup, preserved args/unrelated config and requested project env. The executable runs; earlier EPERM/ENOENT diagnostics are historical. The requested vendor wizard exited 255 with WinError 2, while independent catalog verification passed with 122 skills. The approved debug rerun traced WinError 2 to bare codex in the vendor registration subprocess, with all three MCP configs unchanged. No AWS tools are exposed in this pre-repair session; the owner will restart Codex after the Phase 1 commit, then verify actual tools/identity. See [current project status](../PROJECT_STATUS.md).

Review the current plan and spending restrictions in **AWS Settings → Billing** before a deployment proposal. No claim is made that a billing cap was configured. Regional service/engine availability and the supported-service list for the current plan still need checking through the connected toolkit.

## Local implementation and synthesis

The application still uses `LocalRoomStore`, which supports one development process only and must never be shared by ECS tasks. `apps/realtime/src/ownership.ts` is a separate, provider-independent ownership coordinator with simulated failure tests. It is not wired to the application and has no Redis/DynamoDB adapter.

Local synthesis creates a template, not resources:

```powershell
node node_modules/typescript/bin/tsc -p infra/tsconfig.json
node node_modules/tsx/dist/cli.mjs infra/app.ts
```

Synthesis does not verify deployability, IAM, service access, runtime reliability or cost. The two moderate CDK/bundled-minimatch entries remain open; the isolated download probe failed before resolution checks. Root dependencies remain unchanged.

## Required before staging

1. Retrieve the required AWS service skills through the connected MCP. Implement item-per-entity durable transactions with epoch/version conditions, idempotency, timers and an archive outbox.
2. Connect atomic Redis lease operations, renewal scheduling, recovery/invariant validation, intent routing, pub/sub, elected sweeping, socket tickets and backpressure. The test simulator must never become a production fallback.
3. Implement Aurora account/projection/archive adapters with monotonic updates and immutable completion records. The migration remains unexecuted.
4. Prepare images, least-privilege service roles, secrets, private networking and HTTPS/edge configuration. Review the exact resources and dated costs before requesting deployment approval.
5. Prove real provider authentication, webhooks and deletion without changing Clerk settings or creating test accounts before approval.
6. Run real datastore integration and owner-kill, stale-owner, Redis failover, database outage, reconnect storm and budget/sale drills. Record measured capacity separately from architecture estimates.

No cloud reliability or capacity claim is made.

