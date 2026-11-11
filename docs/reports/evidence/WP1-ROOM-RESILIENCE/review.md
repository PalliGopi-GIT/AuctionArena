# Room sharing and connection resilience

Story: a host shares a private room, friends join and bid, the room preserves an accepted bid during host connection loss, and invited spectators watch only when the host permits them.

| Boundary | Evidence |
| --- | --- |
| UI and browser capability | Actual Chrome Clipboard API output is used for invitation admission; denied access opens a labelled, selectable fallback |
| Client to API | UI create/join/claim/start/bid/resume/end; deliberate spectator claim/bid requests verify server rejection |
| API to room state | Authenticated HTTP snapshots reconcile membership, fixed paused time, accepted leader/price, budgets and one purchase |
| State to delivery | Late spectator receives a real WebSocket COMPLETED snapshot and renders matching results |
| Response to UI | Guest sees host-expiry pause and preserved bid; host reconnects into PAUSED and explicitly resumes; spectator reload preserves results |

Found and fixed two sharing gaps in main.tsx: the old clipboard error provided no selectable link, and the results button reused an invitation URL/required cached credentials. The fallback now supports labelled manual selection and explanatory help. Results URLs carry only the room code and use existing member authorization. Pending copy callbacks check current identity, room and membership before displaying a link. Identity/access loss clears the fallback dialog.

Dialog focus now follows input/review content while keeping the original opener for restoration on close. Keyboard tests cover initial selection, Select link, forward/backward focus wrapping, Escape, result-link fallback and delayed clipboard denial after sign-out. These checks do not establish a complete accessibility audit: assistive technology, contrast, axe and real-device verification remain separate.

The host-loss scenario uses real browser network offline/reconnect and the actual server clock. The guest stays connected past the original lot deadline. Paused state preserves the accepted bid without any sale; reconnection does not automatically resume. Explicit host resume keeps the remaining interval, then settles one exact purchase. No fake clock accelerates this browser scenario.

Late spectator scenarios explicitly enable/disable the existing setting. Enabled: no team is granted; client bidding is disabled with an explanation; direct claim/bid requests receive ALREADY_STARTED/NO_TEAM; two owners remain; live bid/results and WebSocket delivery/reload work. Disabled: joining reports the policy error, private reads return 403, and membership remains two.

The ten new desktop/mobile cases passed in targeted-browser-results.json. The final full browser run passed all 20 cases with zero failures/flaky cases in about 7.4 minutes. It additionally covers the original lifecycle, invitation rotation/leave/close, identity switching, signed-out reload and purse-depletion completion, with settings input/review focus assertions shared across creates. TypeScript and all 70 core tests passed. The production build and owned-process cleanup passed; both test ports were independently confirmed stopped. Aggregate evidence is in validation.json/full-browser-results.json; build and core logs are retained alongside six reviewed screenshots. Data and servers belong to the temporary local-profile harness; no Clerk users, completed development rooms or AWS resources were changed. Manual-copy screenshots mask the link field. Engine/API behavior required no changes.
