# WP1-ROOM-COMPLETION manual browser check

Date: 2026-11-11
Environment: `npm.cmd run dev:local`; Vite `http://127.0.0.1:5173`; API `http://127.0.0.1:3001`; desktop Chromium controlled through wmux.
Room: `375DF8` ("Browser Test Arena", 2 teams, ₹20.00 Cr purse, 1–2 squad, 20s timer, ₹50 L step).

| Step | Result |
| --- | --- |
| Home page and title load | Passed (`AuctionArena — Your team. Your call.`) |
| Create while signed out opens local sign-in, then the pending create form | Passed |
| Create room with reviewed settings | Passed; room opened in WAITING |
| Claim Mumbai Meteors | Passed; lobby showed `1/2 claimed` |
| Edit rules (timer 10→20s, step ₹1 Cr→₹50 L) | Passed; lobby rules updated |
| Renew invite | Passed; token changed and old-link warning shown |
| Second user joins through the API with the current invite | Passed; Members tab updated over the socket to 2 connected |
| Second user claims Chennai and marks ready; host marks ready; start | Passed; status became LIVE |
| Second user bids ₹1.00 Cr on Arjun Rathore | Passed; sale recorded, Chennai budget 1900, squad `p1:100` |
| Host removes and blocks Second Player during the auction | Passed; member disappeared, removed-user request returned 403 `ROOM_BLOCKED`, Chennai owner/squad/budget preserved |
| Host ends the auction | Passed; status COMPLETED |
| `AuctionResults` renders | Passed; ₹1.00 Cr total spend, 1 signed, 4 unsold, 19 not auctioned, Chennai squad and preserved budget shown |

Not covered by this manual pass: copy-invite, leave, close-room, pause/resume, disconnect/reconnect, mobile layout, Clerk sign-in, automated E2E, real multi-process or cloud load.
