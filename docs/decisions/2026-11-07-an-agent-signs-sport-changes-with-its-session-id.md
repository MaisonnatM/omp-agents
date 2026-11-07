---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# An agent signs Sport changes with its session id

In the context of a personal session's `sport` tool writing logs and measurements the user also writes on the Sport page, facing the need to tell an agent's entries from the user's and to keep the user's own data safe, we chose to sign every request an agent leaves with the id omp's `ctx.sessionManager.getSessionId()` gives, to stamp each entry it adds with that id, and to let a session edit only the entries it wrote and never remove or restore one, over trusting a name the agent passes and over letting any agent edit any agent's entry.
An edit request carried no session id at first, so the server could refuse only an edit that changed `addedBy`, and a tool in one session edited a log another session wrote.
The request now names its session, and the server refuses an edit of an entry whose `addedBy` is another session with `an agent may edit only a workout log its own session wrote`, and a request with no session id outright.
This keeps the author a fact omp reports rather than a claim, accepting that a later personal session cannot fix what an earlier one logged; the user fixes it on the Sport page.
The user's entries, those whose `addedBy` is `null`, stay the page's alone, and only the page removes or restores anything.
`agentSportChanges` in `src/sport-agent.ts` holds the rule, which the tool checks before it leaves a file and `SportInbox` checks again before the server applies one, and `src/server/sport-inbox.test.ts` covers the refusals.
