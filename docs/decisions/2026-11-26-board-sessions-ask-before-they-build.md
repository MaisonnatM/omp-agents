---
status: accepted
date: 2026-11-26
decision-makers: Maxence Maisonnat
---

# Board sessions ask before they build

In the context of Board threads, facing sessions that built their own reading of a request and offered "Merge on main" three rounds in a row while missing the point (Board task #32), we chose to have a session reply first with what it understood, the change it would make, and its open questions, and build only once the user answers, over building first and letting the user correct the result.
We gain a thread that reads as a conversation and no work built on a wrong guess, accepting one more round, and one more session start, before work on a request that was already clear.

## Options considered

- **Ask first unless the step is named (chosen first).** `converse` in `src/server/board-runner.ts` joins `startPrompt` and `wakePrompt`. The question round reuses the existing path: mark done with Suggestions, `end_session`, and the user's reply starts the next session.
- **Ask first only when the request is unclear (chosen since, by the user on Board task #32).** Same `converse` path, but a plainly stated change also runs right away; the session asks when the message could mean changes that differ in what the user gets, leaves out something the code and thread do not answer, or follows a "you missed the point" reply.
- **Ask only what the session cannot settle, as before.** Sessions almost never judged anything unsettled, so the thread stayed a work order.
- **Ask, then keep the session waiting for the reply.** Keeps context, but an idle session's 15-minute lease lapses and the sweep starts another one.

## Consequences

- A clear message, one that names the exact step, such as "Merge on main" or a picked suggestion, or plainly says what to change, runs right away.
- A reply saying the session missed the point gets a restatement and a question, not another build.

## Revisit when

Sessions build clear-looking requests that the user then says missed the point, which means the bar for "clear" is too low.
