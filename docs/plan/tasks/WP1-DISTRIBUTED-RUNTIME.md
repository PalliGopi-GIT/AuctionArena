---
id: WP1-DISTRIBUTED-RUNTIME
title: Implement and prove the architecture's distributed runtime
owner: conductor
phase: 1
paths: [apps, packages, infra, db, tests, docs]
acceptance:
  - Load the required AWS service skills before service-specific implementation
  - Use selected Region ap-south-1 and user-selected AuctionArena profile (supersedes AUCTION-FIELD)
  - Durable writes, ownership/fencing, timers and archive delivery satisfy the root architecture
  - Recovery and multi-writer safety have integration evidence
  - No billable resource deployment without explicit user approval
status: in_progress
---

The user explicitly superseded the former Sydney Region/profile with Mumbai/AuctionArena. Host verification confirms STS identity, default ap-south-1, FREE/ACTIVE plan and 100 USD remaining credits. User policy: $0 out-of-pocket; $10/month staging budget from credits; no resource deployment without explicit approval. Billing/spend restrictions still need review in AWS Settings > Billing.

The official toolkit installed 25 skills. Its Windows wizard stopped before Codex configuration; the reviewed generated proxy entry was subsequently imported and its AuctionArena profile merged successfully. Catalog retrieval initially failed on Windows charmap output encoding; the helper now sets process-local UTF-8, and host setup:aws:check passes remote catalog retrieval. The current agent has no AWS documentation/skill tools exposed yet. Reconnect and perform the required agent_skills search/retrieval and STS identity verification before service-specific implementation. No resource has been deployed. Existing foundation Region bookkeeping targets Mumbai; no service construct or distributed runtime adapter was implemented in this slice.

Historical check, superseded by Phase 0: the connection check confirmed the saved entry/profile but found zero exposed AWS MCP tools. The installed uvx launcher cannot execute in the sandbox (PowerShell Access Denied; Node EPERM), so no transport, documentation/skill call or MCP identity verification succeeded. [Machine check](../../reports/evidence/WP1-AWS-SETUP/mcp-check.json). Do not repeat login/install/import; refresh the Codex host connection and verify actual tools first. Existing host identity/plan evidence remains historical.

Work moved to in_progress for the bounded provider-independent [WP1-OWNERSHIP-CORE](WP1-OWNERSHIP-CORE.md) subtask: lease/fenced-write ports, acquisition/renewal/demotion and serialized write coordination, with 20 simulated failure cases including real-engine bid handover/single settlement. Full validation passes 130 core and 76 local tests plus TypeScript/build. This code is not wired to LocalRoomStore/HTTP and supplies no real datastore adapters, timer registry, archive delivery, integration drill or capacity evidence. Cloud service implementation remains gated on required skill retrieval. Corrected stale Sydney/profile instructions in infra/README.md; no infrastructure construct changed.

2026-11-12 Phase 0: absolute uvx launcher saved, private backup and unrelated config verified. Earlier EPERM is obsolete. Requested wizard exited 255/WinError 2; independent catalog retrieval passed (122 skills). No restart or live MCP verification occurred. Follow PROJECT_STATUS.md: wait for restart approval, then Phase 1 correctness and Phase 2 bounds before this Phase 3 service implementation. Costed staging design requires approval before choosing a cheaper architecture.
