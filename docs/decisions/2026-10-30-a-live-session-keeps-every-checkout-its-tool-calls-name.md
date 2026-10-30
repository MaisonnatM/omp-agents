---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# A live session keeps every checkout its tool calls name

In the context of removing worktrees from **Settings → Worktrees** and at a session's end, facing two yampa sessions whose omp-agents worktrees **Remove merged** deleted while they still ran commands there, we chose to protect every checkout that a live session's own transcript names in a tool call, for as long as the session runs, over a recency window and over widening the work directories that pick the checkout a session's end removes.
A session's own directory says nothing about the other repositories it works in, and its tool calls are the only record of them, so reading all of them is the one source that cannot miss a checkout it used.
We accept that a long-lived session or Bot that once named many worktrees keeps every one of them until it ends.

## Context

`WorktreeOccupants` protected a live session's default directory and the linked worktree of that directory's own repository, and read transcripts only for subagents.
The two sessions ran in `~/code/yampa` and worked in `~/code/omp-agents-wt/…`, one through a bash `cwd`, the other through `cd <worktree> && …`, so nothing tied them to those checkouts.
One of them came back to its worktree after fifteen quiet minutes.
The cleanup routine's `protection.ts` already treats every path a live session's tool calls name as in use, with no time limit.

## Options considered

- Every path the live session's tool calls name, for as long as it runs: chosen; it matches `protection.ts`, so both cleanups refuse the same checkouts.
- Only the paths named in a recent window: frees idle worktrees sooner, but the session that returned after fifteen minutes would have lost its worktree with any short window.
- Add the named paths to `SessionFactsScan.workDirs`: one scan instead of two, but those directories pick the worktree `endSession` removes, so a path a session only read could become the checkout its end deletes.

## Consequences

Removal refuses a checkout with an `occupied` blocker naming the session while it runs, even from another repository.
A worktree a session named only in passing, such as one it listed or read, stays until that session ends.
Each live session's own transcript is now read and fingerprinted on each snapshot, which costs about 25 ms of path checks for 2,000 named paths, and a cold read of 68 MB of transcripts in about 230 ms.

## Confirmation

`protects every checkout a live session's own tool calls name, in any repository` in `src/server/worktree-occupants.test.ts` covers a bash `cwd`, a `cd`, a `read` path, and an `edit` header in another repository, and a missing transcript that protects nothing extra.

## Revisit when

Long-running sessions keep worktrees they named only in passing from cleanups often enough to annoy, or omp records the directory each tool call ran in, which would replace reading the calls' arguments.
