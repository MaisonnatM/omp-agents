---
status: accepted
date: 2026-11-26
decision-makers: Maxence Maisonnat
---

# Board sessions ask before they build

In the context of Board threads, facing sessions that built their own reading of a request and offered "Merge on main" three rounds in a row while missing the point (Board task #32), we chose to have a session reply first with what it understood, the change it would make, and its open questions, and build only once the user answers, over building first and letting the user correct the result.
We gain a thread that reads as a conversation and no work built on a wrong guess, accepting one more round, and one more session start, before work on a request that was already clear.

## Options considered

- **Ask first unless the step is named (chosen).** `converse` in `src/server/board-runner.ts` joins `startPrompt` and `wakePrompt`. The question round reuses the existing path: mark done with Suggestions, `end_session`, and the user's reply starts the next session.
- **Ask only what the session cannot settle, as before.** Sessions almost never judged anything unsettled, so the thread stayed a work order.
- **Ask, then keep the session waiting for the reply.** Keeps context, but an idle session's 15-minute lease lapses and the sweep starts another one.

## Consequences

- A message that names the exact step, such as "Merge on main" or a picked suggestion, still runs right away.
- A reply saying the session missed the point gets a restatement and a question, not another build.

## Revisit when

The user answers most question rounds with "yes, build that" alone, which means the requests were clear and the round only slows them.
