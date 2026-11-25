---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
supersedes: 2026-11-25-board-sessions-land-and-end-themselves
---

# Board sessions end on suggestions, and a reply starts a new session

In the context of sessions the Board starts, facing work that reached `main` before the user looked at it, we chose to have each session commit on its branch (or open a draft PR), mark its Board task done with a message ending on suggested next steps, and call `end_session`, and to have the user's reply or picked suggestion reopen the Board task so a new session starts on its thread, over landing on its own and over resuming the session that finished.
We gain a user who decides what reaches `main`, and a fresh session per round with the thread as its context, accepting one more session start per round and an earlier session's transcript left out unless the new one reads it.

## Options considered

- **End on suggestions, a reply starts a new session (chosen).** `finish` in `src/server/board-runner.ts` tells the session to land only when the user's last reply asks; the fold in `templates/omp/agent/extensions/board/log.ts` reopens a done Board task on the user's reply, and `startPrompt` hands the new session the thread and the earlier sessions' ids.
- **Land and end, as before.** Nothing waited on the user, but nothing waited for the user's look either; see [Board sessions land and end themselves](2026-11-25-board-sessions-land-and-end-themselves.md).
- **Resume the finisher on a reply.** Keeps the full context, but grows one session across rounds and needs the worktree that `end_session` removed.

## Consequences

- The page shows the last done reply's `Suggestions:` block as buttons; a click sends it as the user's reply.
- A session's reply on a done Board task reopens nothing and wakes nobody.
- The new session finds the earlier work on the branch the thread names, and reads an earlier transcript through eval's `archive` only when the thread leaves something out.

## Revisit when

The thread alone often leaves a new session short of context, so it keeps reading earlier transcripts.
