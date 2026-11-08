---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# Sessions waiting on subagents get their own group

In the context of the Sessions tab, facing live sessions whose subagents still run while the main agent only waits for them, we chose a **Waiting on subagents** group that holds a session whose main turn ended or sits only in `wait` or `task` calls while a subagent runs.
We chose it over catching only an ended main turn and over counting any running subagent, so **Idle** shows sessions that are done and **Running** sessions that work, accepting that the server must follow the main agent's tool calls and can miss one that started before it attached.

## Context

The sidebar split live sessions by the main agent's status alone: **Idle** for an ended turn, **Running** for a turn that runs or a question.
A main agent that hands work to subagents either ends its turn, so the session shows the blue dot and looks done, or calls `wait` or `task`, so it looks busy while it does nothing itself.
In the user's sessions of the last 3 days, main agents made 616 `wait` calls and 127 `task` calls, so most of that waiting happens inside a running turn, not after it.
A roster row already lists the subagents with their status, but nothing said which tool the main agent's turn sat in.

## Options considered

- A, only an ended main turn with a running subagent: it needs no new fact on the row, but it misses the `wait` calls, the common case, which stay under **Running**.
- B, A plus a main turn whose tool calls in flight are all `wait` or `task` while a subagent runs: it catches both shapes and needs one new row fact, `turnWaits`, that the server reads from the main agent's `tool_execution_start` and `tool_execution_end` events; chosen.
- C, any session with a running subagent, whatever the main agent does: the simplest rule, but a main agent that works beside background subagents would read as waiting, which is the confusion the group exists to remove.

## Consequences

**Idle** and **Running** now mean done and working, and the user sees at a glance which sessions only wait on their subagents.
One rule, `awaitsSubagents` in `web/attention.ts`, decides the group, the row's status, and whether the session needs you.
Every row it holds, in the group, pinned, or under **Bots**, drops the blue idle dot and its tooltip says waiting on subagents, since that dot is the cue that made such a session look done; other places that show a session's dot, such as chips and todo links, keep its plain status.
Such a session needs nothing from you, so a turn it ended unseen leaves the Sessions tab's count, the Dock badge, and the Bots' count, and raises its alert only once the subagent stops, unless its next turn reads it first.
`TurnWaits` in `src/server/turn-waits.ts` follows every live session's main-agent tool calls through `LiveSessions.heard`, which `Dashboard#onLiveUpdate` calls for each event as it does `turnStarted`, and pushes the roster when a turn starts or stops waiting.
Between two calls a turn keeps its answer until its next tool call or its end, because a smoke run showed a main agent calling `wait` four times with thinking between them, and the row would otherwise have jumped back to **Running** for each gap.
A main agent that writes a long reply after a `wait`, while a subagent still runs, so stays in the group until its turn ends.
A server that attaches in the middle of a `wait` never hears its start, so that session stays under **Running** until its main agent's next tool call.
A `wait` on a background job, not a subagent, counts as waiting while a subagent also runs.
The previous and next session keys walk the new group after **Running** and before **Bots**.

## Confirmation

`src/server/turn-waits.test.ts` covers which tool calls make a turn wait, and `web/sessions.test.ts` covers which group each session lands in and the waiting count.
`src/server/live-sessions.test.ts` covers the row's `turnWaits`, held after a `wait` ends, and `web/attention.test.ts` covers holding back the unread turn while a subagent runs.

## Revisit when

Confidence is moderate, since the rule leans on two tool names.
Reopen it when omp adds or renames a tool that waits on subagents, reports the tool a turn sits in on its own, or users find sessions under the group that work.
