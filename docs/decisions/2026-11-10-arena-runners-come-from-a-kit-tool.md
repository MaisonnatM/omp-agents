---
status: accepted
date: 2026-11-10
decision-makers: Maxence Maisonnat, agent
---

# Arena runners come from a kit tool

In the context of a session that gives two or more subagents the same task and keeps the best attempt, facing a Subagents section that lists those runners as plain rows with no sign of which one won, we chose an `arena` tool in the starter kit that the session calls with its runners, its judge, and its pick, and a Subagents section that shows the recorded runners as cards side by side.
We chose it over reading the arena from the `task` calls or from the agent's reply, to show only what the agent says it ran, accepting that a session without the updated kit, or an agent that skips the call, shows plain rows.

## Context

The page knows each subagent's id, parent, status, and activity, but no path carries the `task` call that spawned it or the assignment it shares with its siblings.
Two subagents of one `task` call can be an arena or two halves of one job, so grouping by call would guess.
The pick lives only in the judge's and the agent's prose.
The starter kit's `ship` tool already records a session's state in a custom entry that `src/session-facts.ts` folds.

## Options considered

- Group the subagents of one `task` call: needs a new path for the call id, and calls a split job an arena.
- Parse the winner from the agent's or the judge's reply: free text, so a rewording breaks it.
- An `arena` tool that appends an `omp-arena.state` entry with the whole record on each call: explicit, reuses the custom-entry path, and works in terminal sessions too.

## Consequences

The arena's tool description tells the agent to call it after the fan-out, after spawning a judge, and after the pick.
The Subagents section draws an Arena box once two of an arena's runners are among its rows, with seats A, B, C in the recorded order, and the Base, Graft, or Not used badge after the pick.
A subagent cannot call the tool, and its schema stays out of subagent requests.
A later call naming the same runners replaces that arena, so one session can hold several.

## Revisit when

omp's `task` tool reports which calls are competing attempts, or agents often forget to call `arena`.
