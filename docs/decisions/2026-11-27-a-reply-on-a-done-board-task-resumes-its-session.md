---
status: accepted
date: 2026-11-27
decision-makers: Maxence Maisonnat
---

# A reply on a done Board task resumes its session

In the context of a Board thread that runs over several rounds, facing each round's new session rebuilding what the last one knew from the thread alone, we chose to resume the session that marked the Board task done, over starting a new session per round and over keeping sessions running for some minutes after they finish.
We gain one conversation per Board task with its whole context, accepting a transcript that grows across rounds and leans on omp's compaction.

## Context

[Board sessions end on suggestions, and a reply starts a new session](2026-11-25-board-sessions-end-on-suggestions-and-a-reply-starts-a-new-session.md) rejected resuming because `end_session` removed the session's worktree.
Since [Board tasks belong to their session](2026-11-26-board-tasks-belong-to-their-session.md), every round works in the Board task's own `board/<id>` worktree, which the server keeps when it ends the session, so that reason no longer holds.

## Decision

- When the user's reply or a failed merge reopens a done Board task, the runner resumes the session that marked it done, through the same `wake` a reply on an open Board task uses, with the thread since its done.
- It records that session as the round's `start`, so it holds the Board task and the sweep ends it again after its next done turn.
- A new session starts instead when the last round did not end in that session's own done: its start failed, it exited, the user closed the Board task, or another session marked it done; and when the session no longer resumes.

## Options considered

- **A new session per round.** Each round starts clean, but re-reads the thread and sometimes earlier transcripts.
- **Keep the session running for some minutes after done.** Saves only the few seconds a resume takes, and holds one process per idle Board task under a second end rule.

## Revisit when

Resumed sessions often compact away what they need, or carry an earlier round's plan into the next.
