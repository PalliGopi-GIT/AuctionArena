# Human accessibility verification

Status: awaiting human results. Automated Chromium/axe passes do not establish screen-reader, browser/OS zoom or real-device support. User has Windows + Android; Safari is still unavailable.

Use an isolated local test profile, not an account containing personal auctions. Run npm.cmd run dev:local from the project folder and use its printed frontend address. This performs no cloud deployment. For Android, forward the printed localhost frontend port through Chrome DevTools USB port forwarding; the same-origin API/socket proxy remains on the laptop. Do not expose the API to the public internet for this check.

Record each outcome as pass, fail (with exact step) or not run. Do not mark a skipped or unavailable device as passed.

1. Windows keyboard: Tab reaches Skip to main content first; Enter focuses main. Open create/profile dialogs, Tab and Shift+Tab through them, then Escape. Focus stays in the dialog and returns to the opener.
2. Windows NVDA: headings, navigation and field labels are understandable. Errors and confirmation messages are announced. Background content is unavailable while a dialog is open.
3. Live auction speech: bidding updates coalesce rather than interrupting continuously; pause/disconnection and 10/5-second warnings are understandable. Leaving the room or signing out stops private queued speech.
4. Windows browser zoom at 200% and 400%, plus OS text scaling: create/review, profile, lobby, live auction and results remain usable; text/controls do not overlap or require horizontal scrolling for ordinary content.
5. Android Chrome + TalkBack: swipe through navigation and dialogs, activate buttons, edit a display name, read validation errors and return to the room. Controls have understandable names and logical reading order.
6. Android touch/reflow: check portrait and landscape, large system text, software keyboard opening and scrolling to the confirmation controls. The bid button must not cover critical information when disabled.
7. Contrast review: inspect the retained axe incomplete targets, especially gradient/overlapping preview text, badges and the profile deletion description. Record observed foreground/background contrast or a concrete visual failure. Decorative aria-hidden art is not spoken text.

Do not delete a personal Clerk account while testing. The destructive-control keyboard check can stop before confirmation, or use an explicitly disposable local test profile.

Sources: [Chrome remote debugging and USB port forwarding](https://developer.chrome.com/docs/devtools/remote-debugging/local-server/), [W3C resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
