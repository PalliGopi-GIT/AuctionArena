# WP1-RECOVERY source review

Reviewer: `review_core`, read-only review under Master Architecture Part B.

| Finding | Resolution | Native regression |
| --- | --- | --- |
| Sold player could be absent from all squads | Reconcile sales in both directions | recovery rejects a sold player missing from its squad |
| Saved leading bid could settle into negative budget | Check active-lot eligibility before recovery tick | recovery rejects an unaffordable saved leading bid before settlement |
| Delayed sweep could settle after earlier host timeout | Apply host expiry before later deadline; check before heartbeat/actions | delayed sweep pauses at host grace expiry before a later deadline |
| Offline resume could inflate timer | Connected-host guards for resume and manual next | offline host cannot resume and inflate paused time; offline host cannot manually advance to a new lot |

Reviewer reproduced the fourth issue against actual source; parent implemented its fix and both regressions passed in the final 31-test run. The reviewer found no other serious issue in the reviewed recovery and connection helper scope. This is a bounded source review, not a production security audit or full UI verification.
