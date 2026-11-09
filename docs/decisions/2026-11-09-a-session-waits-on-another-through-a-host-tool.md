---
status: accepted
date: 2026-11-09
decision-makers: agent
---

# A session waits on another through a host tool

In the context of a session that should act once another one finishes, such as a reviewer that reviews a builder's branch, facing an agent that can only poll or ask the user, we chose a `wait_for_session` host tool that the server holds open until the other live session stops for the user, decided from the roster row the sidebar shows, over a polling loop in the agent and over a kit extension that watches the registry.
The server already knows every live session's status, questions, and subagents, so the tool reuses `awaitsSubagents` and answers on the same moment the sidebar does, accepting that the call holds the waiting session's turn open until then, and that only dashboard-started sessions can wait, though they can wait on a session in a terminal.

## Options considered

- The agent polls with `sleep` and reads the other session's file: costs a model call per poll and needs its own rule for idle and waiting on subagents.
- A kit extension that watches omp's registry: works from a terminal session, but cannot see a dashboard session's questions or its subagents' status as the server does.
- A host tool answered from the roster rows: chosen; it ends at the other session's idle turn end with no running subagent, its question, its end, the time limit, or an interrupt, and refuses the waiting session itself, which it learns from the call's `tool_execution_start`, since a tool cannot know its caller.

## Revisit when

A session in a terminal needs to wait on another, or omp gains its own way for one session to wait on another.
