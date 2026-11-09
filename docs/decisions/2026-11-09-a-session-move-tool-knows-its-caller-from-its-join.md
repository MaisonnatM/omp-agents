---
status: accepted
date: 2026-11-09
decision-makers: Maxence
supersedes: 2026-10-30-a-session-moves-itself-through-a-host-tool-at-turn-end
---

# A session's move tool knows its caller from its join

In the context of the `move_session` host tool, facing the earlier record's reason that a tool closure cannot know its session, which stopped being true once `joinFor` in `src/server/start.ts` started taking the session's instance id, we chose to build each session's own move tool around its instance id and to keep handing the move over at the call's `tool_execution_end` event, over learning the caller from the call's `tool_execution_start` event and over handing the move over from the tool's own `execute`.
The tool no longer tracks which session made each call, so `SessionMoves` and the `wait_for_session` tool share one way to know their caller, accepting that a move still waits for that end event, because a reattached session gets its tools before the registry lists it, and its events, held until then, are what reach it after.
The move is still sent as `/move <path>` once the turn ends idle, as the earlier record chose, and a session in a terminal still asks the user to type `/move`.

## Options considered

- Learn the caller from the call's `tool_execution_start` event: the earlier shape, which needed a map of callers by tool call id and a guard for that event arriving after the call, copied in each host tool.
- Hand the move over from `execute` itself: the caller is known there now, but a reattached session may not be listed yet, so the move could reach no session.
- Close over the instance id and hand over at `tool_execution_end`: chosen.

## Revisit when

omp gains an RPC command to move a session, terminal sessions need to move themselves, or a reattached session is listed before it gets its tools.
