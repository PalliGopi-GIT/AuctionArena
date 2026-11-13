# Cloudflare transition plan

The selected target is Workers/Hono, React/Vite, server-verified Clerk, and a SQLite-backed Durable Object per room with WebSocket hibernation and alarms. R2 is optional and inactive. The root master records the Cloudflare restoration and remaining gaps. The owner authorized package A (Phase 2 local hardening) on 13 November 2026; its implementation and limits are in [WP2-LOCAL-BOUNDS](tasks/WP2-LOCAL-BOUNDS.md). Report its results and stop before package B pending the owner's next instruction.

After audit review, implement in order: A. bounded heartbeat writes, history, receipts, replay and paging in the local runtime; B. storage ports and SQLite parity tests; C. Workers/Hono entry, Clerk and room-code routing under local Wrangler/Miniflare; D. room Durable Object, hibernation, alarms, recovery and settlement; E. cross-room index, archive, deletion and export; F. measured multi-room 100/500/1,000-concurrent-user tests.

The per-room object is the proposed single writer. It does not by itself solve authorization, cross-room queries, exports, global user deletion or exactly-once settlement. Idempotency and settlement must be transactional and proven with restart, retry and recovery tests. idFromName routing must not make non-existent rooms publicly discoverable or create rooms on unauthorized access. Retain the local runtime until a replacement passes parity tests.

No deployment, account or setting creation, credit card, R2, production migrations or cost without explicit owner approval; budget $0 out of pocket. Preserve existing evidence, fixtures, scripts, migrations and infrastructure. Historical records are in ../archive/aws-v2/; physical deletion is a separate later approval after Cloudflare tests pass.
