---
id: WP1-LOCAL
title: Prepare AWS foundation and local deployment boundary
owner: platform
reviewers: [architect, security]
depends_on: []
phase: 1
slice: local-core
paths: [infra, db, docs]
acceptance:
  - Selected Region is ap-southeast-2
  - Private data services with encryption and persistent-data retention
  - No cloud deployment or unsupported capacity claim
  - Local adapter deviations documented
evidence_required: [typecheck, synthesis]
status: in_review
---

2026-11-11 platform: authored foundation, migration, and deployment boundary. Runtime deployment intentionally absent. Typechecking/synthesis evidence pending dependencies. SQL migration has not been applied to PostgreSQL.
