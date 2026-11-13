# SUPERSEDED by Cloudflare architecture v3.0

Historical record; not active guidance. Cloudflare v3.0 design is pending owner review.

---
id: WP1-AUTH-COVERAGE
title: Verify real provider challenge, active-account switching and mobile flows
owner: conductor
phase: 1
depends_on: [WP1-ACCOUNT-LIFECYCLE]
paths: [scripts, tests, docs]
acceptance:
  - Inventory enabled development-instance methods without exposing private configuration
  - Use only purpose-marked synthetic fixtures for password, email OTP and MFA changes
  - Record actual challenge completion separately from ticket sign-in and cryptographic checks
  - Verify active-account switching under the instance's supported session configuration
  - OAuth completion and human device checks have real evidence rather than a redirect-only pass
status: in_progress
---

The three existing successful live reports remain authoritative for their narrower scopes. No additional live challenge pass is claimed yet. The user authorized this expanded coverage and supplied Windows + Android availability. Host network/provider access is required. No personal account is to be deleted or have its MFA settings altered by an automated test.

The host ran test:clerk:readiness and saved 122 safe flags. Password and email-code sign-in, plus Google OAuth, are enabled. Multi-session is disabled, so direct active-session switching cannot be marked supported/passed without a separately approved configuration change. Authenticator/MFA availability still needs a precise configuration check. The user now explicitly forbids test-account creation or Clerk settings changes without approval. Prepare a concrete synthetic-fixture/challenge plan before requesting that approval; do not reuse/delete the completed auction fixtures.

The opt-in scripts/test-clerk-challenges.mjs harness is prepared. Plan mode and syntax checks passed. Its isolated preflight built and started a Clerk-only preview on API 3401/web 5573, then stopped both owned ports; no user or room was created. Evidence: WP1-AUTH-COVERAGE/challenge-preflight.json. It uses a separate bundle/database and is ready for review, but --create-test-users still requires explicit approval. The proposed scope is at most two purpose-tagged development users and one private room, password/email-code desktop/mobile-viewport challenges, name edit/reload and deletion of only the tagged guest. Retries reuse its own tagged fixtures and reset only their test passwords. Google OAuth, MFA, direct multi-session switching, real-device and webhook delivery remain separate unverified work.
