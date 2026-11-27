---
status: accepted
date: 2026-11-27
decision-makers: Maxence Maisonnat, agent
---

# A private session ends at the idle hours after a notice

In the context of private sessions left idle for days, each holding an omp process and its memory, facing the rule that ending a private session deletes it with everything it wrote, we chose to end a private session after the same idle hours as any dashboard session, with a bell notice five minutes before, over leaving private sessions running until someone ends them, to stop forgotten private sessions from holding memory, accepting that a private session nobody returns to within the notice is gone for good.

## Context

[An idle session stops its omp and keeps its worktree](2026-11-16-an-idle-session-stops-its-omp-and-keeps-its-worktree.md) left private sessions out of the idle session stop, since their end deletes them.
A private session lives exactly as long as its omp process ([decision](2026-11-03-a-private-session-lives-in-its-own-directory-until-its-omp-stops.md)), so a forgotten one keeps its omp, its MCP servers, and their memory for good.
The memory policy that ends sessions under pressure needs every session it may end to have an end it can reach, private ones included.

## Options considered

- Keep private sessions out of every automatic stop: a forgotten private session holds its memory until the next reboot. Rejected.
- End a private session at the idle hours without a word: a user who meant to come back loses it with no warning. Rejected.
- End it at the idle hours, with a bell notice of kind `private-deleting` from five minutes before, which names the session and when it is deleted; any use of the session resets its settled clock and so the deletion. Chosen.
- A longer timer for private sessions than for the others: one more setting to explain, for sessions that are meant to be short. Rejected.

## Consequences

- `SessionProcessWatch` treats a private dashboard session as any dashboard session for the idle session stop; `decide` in `src/server/memory-policy.ts` names it in its warnings from five minutes before.
- The bell's `PRIVATE_KINDS` check lists those warnings, one notice per session and deletion time, under **Sessions**.
- Under critical memory pressure, the ladder may end a private session settled for an hour, after every other rung.

## Confirmation

`src/server/memory-policy.test.ts` and `src/server/session-processes.test.ts` end a private session at the setting's hours, with the warning from five minutes before and not earlier.

## Revisit when

Users ask to keep private sessions alive past the idle hours, or omp can suspend a session without ending it.
