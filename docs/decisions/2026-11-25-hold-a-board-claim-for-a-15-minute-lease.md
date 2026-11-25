---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Hold a Board claim for a 15-minute lease

In the context of Board tasks that sessions claim, facing a session that stops or dies while holding one, we chose a 15-minute lease that the session renews, with a sweep every 30 seconds that returns a lapsed claim to ready with a note in the Board thread, over claims that last until done or a lease tied to the session's process.
We gain Board tasks that never stay stuck on a dead session, accepting that a long silent turn must renew its lease or lose the Board task to a new session.

## Decision

- `claim` and `renew` set the lease to 15 minutes from now; `done` ends it.
- Only the owner server sweeps, and a lapsed lease starts a new session on the Board task.
