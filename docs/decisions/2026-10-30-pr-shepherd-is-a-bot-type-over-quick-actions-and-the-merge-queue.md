---
status: accepted
date: 2026-10-30
decision-makers: user, agent
---

# A PR shepherd is a Bot type over quick actions and the merge queue

In the context of approved pull requests that stall on conflicts, failing checks, or review comments, facing the choice between a long-running babysit session per pull request, a repair step inside the merge queue, a GitHub Action, and a Bot, we chose a Bot with a type, `pr-shepherd`, whose own tools start the Pull requests page's quick actions and queue the merge, so one teammate with a memory decides what to do while sessions and the queue do the work.
The user asked for Bot types, with only `routines` and `pr-shepherd` for now.
A type is picked when the Bot is made and `applyBot` keeps it through every save, so a Bot never gains or loses tools mid-conversation.
The shepherd's tools live in their own extension, `src/omp/shepherd-extension.ts`, which only a shepherd's session loads, because omp registers an extension's tools before it sets its flags, so one extension cannot hide them from other Bots.
Each fix runs in its own session on the pull request's branch rather than in the Bot's conversation, so parallel pull requests do not share one context.
We accept that the tools only leave requests, as the other Bot tools do, so the Bot learns of a refusal from a message the server posts into its conversation, and that the per-pull-request fix limit lives in memory and resets when the server restarts.
