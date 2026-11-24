# WP-C Worker entry verification

This is new evidence for the working tree based on commit `53967a2`, collected on 13 November 2026 local time. Earlier evidence remains unchanged. [validation.json](validation.json) summarizes exact outcomes and [tested-source.json](tested-source.json) records SHA-256 hashes of the six WP-C files from the isolated verification copy. No commit was made during this task.

The isolated workspace was `C:\Users\palli\AppData\Local\Temp\auctionarena-wpc-31de3eb5a444487d80c53cf5cbee0d07\work`: committed files plus current application/test changes, a dependency junction, no private environment file, and empty temporary data. Package D later changed `apps/api/src/worker/index.ts`, so its hash in this manifest is the WP-C version that was tested, not the current working-tree file.

- `core.json`: final 214-test Vitest result in 38 suites, including the 15 new Worker-entry tests.
- `local/`: final 76-test local result and TAP output. The unchanged runner's historical task label is retained.
- `browser/`: 34-case regression result, production build/server log and 34 axe scans. No retries or failures.
- `a11y/`: separate four-case accessibility result, server/build log and 32 axe scans. No retries or failures.
- `typecheck.log` is empty because TypeScript passed; `typecheck-exit.txt` records exit 0.

The Worker tests exercise Hono routing, Clerk-shaped JWT verification with an ephemeral key, code normalization, client-header stripping, private-room equivalence, creation retry, forwarding, HMAC socket tickets, CORS, body limits and per-isolate rate limiting. They do not run in the actual Workers runtime.

`wrangler` and Miniflare were unavailable offline, so bindings, bundling, WebSocket upgrade and Durable Object behavior were not executed here. The browser and accessibility runs exercise the unchanged local Node runtime, not the Worker. Socket tickets are replayable within their 30-second lifetime, and `/api/me` returns no rooms until Package E. No deployment, account setting, cloud resource or production migration was created.
