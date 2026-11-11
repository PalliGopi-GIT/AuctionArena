# Local browser verification review

The tests use two independent browser contexts and real HTTP/WebSocket connections. All mutations in the lifecycle are driven through React controls. Read-only HTTP checks independently inspect the confirmed sale, budget, preserved team and denied member response.

The two scenarios run on Chromium at 1440×1000 and 390×844. They cover sign-in continuation into create, review/create, claim, invite join, readiness, pause/resume, bid, refresh, timed settlement, participant offline/reconnect, removal/block, browser access-loss cleanup, host end, completed-result refresh, invite renewal/rejection, leave and team release, and pre-start close. Lifecycle screenshots also check results-page horizontal overflow. Runtime page errors fail the lifecycle test.

The initial pass exposed a review gap: server revocation worked, but the UI ignored access-loss notifications and discarded HTTP error codes. The UI now retains those codes and clears room state on lost access; the final suite checks the behavior.

Data is created in an OS temporary directory using a unique path. Test API/frontend ports are 3101/5273. Setup refuses to reuse a responding server, never opens `.data/auctionarena.json`, and sends IPC shutdown to its own child processes. API exit cleans its temporary directory. Production mode remains prohibited by the local adapter.

Evidence: `results.json` contains machine-generated test counts/timings; `servers.log` includes the Vite bundle build; `desktop-results.png` and `mobile-results.png` show the completed room. Failed-run traces/screenshots remain in ignored `test-results/` when a test fails.

Limits: mobile is a Chromium viewport/touch emulation, not a real device or Safari. Clipboard operations, host-offline heartbeat recovery, spectator-after-start, accessibility audits and real Clerk credentials remain outside this suite. This provides no cloud reliability or capacity evidence.
