# AWS toolkit and connection status

Saved: 12 November 2026. Profile: **AuctionArena**. The owner confirmed the project is assigned to **ap-southeast-2 (Sydney)** in AWS Settings; the previous Mumbai plan is superseded pending the owner's decision. The setup helper defaults to Sydney. The local AWS profile was not changed by this update. Toolkit endpoint: `https://aws-mcp.us-east-1.api.aws/mcp`. The endpoint Region does not change the resource Region.

The owner approved restart and an explicit debug wizard rerun. No agent-controlled restart was performed; a later host-server restart was observed. No AWS resource creation/deployment or CDK bootstrap is authorized. The $0 out-of-pocket and $10/month staging-from-credits limits remain in force.

## Current repair

The inherited Codex process could not resolve bare `uvx` (ENOENT). The earlier EPERM execution restriction is gone. The installed uvx 0.13.7 executable runs successfully. Only the existing Codex aws-mcp launcher and requested project env were edited, after creating a private original backup. Generated proxy arguments/metadata, other env variables and unrelated entries are preserved.

The saved launcher is:

```text
C:\Users\palli\AppData\Local\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uvx.exe
```

The AWS entry retains `AWS_MCP_PROXY_PROFILES=AuctionArena`, the proxy's named-profile setting. At the user's explicit request it also contains `AWS_PROFILE=AuctionArena` and `AWS_REGION=ap-southeast-2`. Existing conflicting project values cause the helper to stop instead of overwriting them.

`scripts/setup-aws.ps1` now resolves installed Windows executables even with stale inherited PATH, verifies uvx execution, narrowly merges the absolute command and env, and uses a private pre-write backup plus stale-read checks. Its PATH additions affect only that process and its children. `-ImportGeneratedMcp` still refuses an existing AWS entry; it was not invoked for this repair.

The idempotent repair-only command is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-aws.ps1 -ConfigureMcpProfile
```

Do not replace the full config with a template, delete existing settings or print its opaque proxy arguments. Private global-config backups stay outside the repository.

## Requested toolkit rerun

The owner explicitly authorized this command:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-aws.ps1 -Toolkit -VerifyToolkit
```

Actual result: **wrapper exit 1; toolkit wizard exit 255**:

```text
aws: [ERROR]: [WinError 2] The system cannot find the file specified
```

The wizard had reported Claude Code already configured. The approved debug rerun identified bare `codex` as the failing registration subprocess: Windows finds the npm `codex.cmd` shim, but the vendor passes the unresolved bare name to `subprocess.run`. The absolute CMD shim and native EXE both run. In the wizard child, aws/uv/uvx resolve and run; npx has a similar shim issue but is not this failing call. The Codex file remained unchanged during the wizard; unrelated config in both other detected agent files was preserved. The helper backs up detected MCP config before the requested wizard and stops on an unexpected Codex-file change.

Independent catalog verification **passed: 122 skills**. The repaired launcher remains saved. Fourteen focused Windows bootstrap tests, all 136 core tests, TypeScript and PowerShell syntax pass. No application/UI change or fresh browser/local/build run is claimed. See [machine validation](reports/evidence/WP1-AWS-MCP-REPAIR/validation.json), [toolkit result](reports/evidence/WP1-AWS-MCP-REPAIR/toolkit.json), [repair verification](reports/evidence/WP1-AWS-MCP-REPAIR/repair.json) and [project checkpoint](../PROJECT_STATUS.md).

Do not repeat login, installation, generated-entry import or the vendor wizard without a new reason. The original setup already installed the CLI/uv/default skills and verified CLI identity, FREE/ACTIVE plan and 100 USD credits on the host. Those identity/billing facts are historical and were not refreshed here.

## Next connection gate

The previous connection gate passed: eight AWS MCP tools were exposed, documentation search and skill retrieval passed, and STS identity matched profile AuctionArena. See [connected verification](reports/evidence/WP1-AWS-SETUP/connected-verification.md). The owner subsequently confirmed the project's assigned Region is Sydney and requested the config change; a restart has not been performed for that change.

The [official Codex MCP instructions](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) distinguish configured servers from active connections. The [AWS toolkit reference](https://docs.aws.amazon.com/cli/latest/reference/configure/agent-toolkit.html) documents the vendor wizard and its `--yes` behavior. No service-specific backend implementation is claimed before the required AWS guidance is available.

Confirm the selected Region in AWS Settings > View all projects > Overview > Additional Info > Region. Review current plan/spending restrictions in AWS Settings > Billing before a deployment proposal. A budget/cap is not certified by the CLI identity or catalog checks.

The debug rerun exited **255** and preserved all three detected MCP configuration files byte-for-byte. Raw debug logs remain private. Do not rerun vendor registration just by fixing its Codex PATH: `codex mcp add` could replace the already repaired AWS entry. See [reconnect diagnosis](reports/evidence/WP1-AWS-SETUP/reconnect-diagnosis.md) and [launcher reproduction](reports/evidence/WP1-AWS-SETUP/launcher-checks.json).

## Infrastructure boundary

`infra/` remains an undeployed foundation; the SQL migration remains unexecuted. The application still refuses production mode and has no real distributed datastore/timer/archive adapters. The ownership coordinator is a separate model-tested core, not a cloud runtime. The current infrastructure has no approved estimate establishing compliance with the staging budget. Phase 3 requires a costed design and the owner's approval before selecting a cheaper architecture. No resource deployment is authorized.

Historical owner clarification (12 November): the earlier session predated the launcher repair. Subsequent MCP calls verified connectivity, as recorded above. Do not repeat registration or restart for this Region update without the owner's instruction.
