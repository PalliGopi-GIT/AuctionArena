# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

---
id: WP1-CDK-BUNDLE-FIX
title: Verify a supported replacement for the flagged bundled minimatch chain
owner: conductor
phase: 1
depends_on: [WP1-DEPENDENCY-HARDENING]
paths: [scripts, package.json, package-lock.json, tests, docs]
acceptance:
  - Test actual npm bundle resolution in isolation before changing main dependencies
  - Verify glob semantics and the amplification fix against the resolved package
  - Require CDK integration verification before adopting a major bundle replacement
  - Fresh main-project audit establishes the final advisory count
status: in_progress
---

The latest observed CDK release still bundles the affected version. scripts/test-cdk-bundle.mjs is a host-only isolated probe: it tests a scoped npm override, inspects the copy actually resolved by CDK, checks representative glob semantics and the patched compilation bound, then audits the probe. It never edits main dependencies, invokes CDK or calls AWS. Run npm.cmd run test:cdk:bundle for the plan, or append -- --install-probe on the host for the actual download/probe.

No successful override or resolution of the two moderate entries is claimed yet. Even a successful isolated probe requires CDK integration evidence and a fresh main-project audit before adoption. Required AWS guidance/tooling is still being connected.

2026-11-12: Sandbox installation attempts failed before resolution/glob/audit checks. The diagnostic retry recorded npm EACCES; using a workspace-local npm cache also failed with EACCES. The probe now uses bounded fetch timeouts/no retries, hides raw npm output, records safe exit/error codes and hashes the root manifest/lock before/after. Both root hashes are unchanged. [Latest probe](../../reports/evidence/WP1-CDK-BUNDLE-FIX/probe.json); first/second attempts are preserved beside it. No override was adopted, no root installation/audit ran, and the last successful host audit's two moderate entries remain open. Stop retrying the same sandbox path; run the prepared probe on the unrestricted host before selecting a supported fix. Script syntax and plan mode pass; CDK integration remains pending.
