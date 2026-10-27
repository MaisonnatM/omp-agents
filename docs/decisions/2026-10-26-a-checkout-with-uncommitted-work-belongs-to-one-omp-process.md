---
status: accepted
date: 2026-10-26
decision-makers: Maxence Maisonnat
---

# A checkout with uncommitted work belongs to one omp process

The starter kit's worktree guard records the omp process that last changed a checkout in `omp-checkout-owner.json`, in that checkout's git dir, and blocks other sessions' changes there while that process runs and the checkout holds uncommitted changes to tracked files or an unfinished merge or rebase.
Two sessions that shared a checkout lost work when one switched its branch and the other's uncommitted edits went with it, so a session has to learn that a checkout is taken before it changes it.
The owner is the OS process, by pid and start time, rather than the session: omp runs a session's subagents in the same process, and a process that dies frees its claims with no cleanup step.
The claim is a plain JSON file so that the user can free one with `rm`.
A clean checkout passes to the next session that changes it, so an idle session or a finished merge on `main` locks nothing.
The claim is written whole by rename and read without a lock, so two sessions that take the same clean or abandoned checkout at the same moment can both pass, which the guard accepts.
Each process also remembers the HEAD it left in each checkout and blocks its own changes there once another process moved it, until a switch of its own succeeds, since a commit after a switch it never saw lands on the wrong branch.
See the worktree guard in the [starter kit README](../../templates/omp/README.md).
