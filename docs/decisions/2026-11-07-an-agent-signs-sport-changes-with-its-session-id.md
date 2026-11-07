---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# An agent signs Sport changes with its session id

In the context of a personal session's `sport` tool writing logs and measurements the user also writes on the Sport page, facing the need to tell an agent's entries from the user's and to keep the user's own data safe, we chose to stamp each entry an agent adds with the id omp's `ctx.sessionManager.getSessionId()` gives, and to let an agent edit only entries some agent wrote and never remove or restore one, over trusting a name the agent passes and over limiting an agent to the entries of its own session.
This keeps the author a fact omp reports rather than a claim, and lets the next personal session fix what an earlier one logged, since every personal session shares one persona and one memory, accepting that one personal session may change another's entry.
The user's entries, those whose `addedBy` is `null`, stay the page's alone, and only the page removes or restores anything.
`agentSportChanges` in `src/sport-agent.ts` holds the rule, which the tool checks before it leaves a file and `SportInbox` checks again before the server applies one, and `src/server/sport-inbox.test.ts` covers the refusals.
