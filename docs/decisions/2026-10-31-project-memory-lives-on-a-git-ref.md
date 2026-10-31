---
status: accepted
date: 2026-10-31
decision-makers: agent
---

# Project memory lives on a git ref

In the context of the memory the omp sessions of one repository share, facing sessions in different worktrees that write it at the same moment and a user who wants to see who changed what, we chose one `memory.json` committed to `refs/omp/memory` in the common git dir and swapped in with `git update-ref`'s compare-and-swap over a JSON file under a lock, over omp's `memory.backend` stores, and over a file committed on the working branches.
It shares one memory across the main checkout and every linked worktree, keeps each batch's history and session in `git log refs/omp/memory`, and needs no lock, accepting that the memory stays on this computer until someone pushes the ref by hand and that a batch which loses twenty races in a row fails and must be sent again.

## Context

A repository's worktrees share its common git dir, and a ref such as `refs/omp/memory` lives there, not in one worktree.
Two sessions can finish a turn and write memory within the same second.
omp has a memory of its own and a Bot keeps its `memory.md`; project memory reads and writes neither.

## Options considered

- A JSON file in the common dir under a lock file: shares across worktrees, but a crashed writer leaves the lock, and there is no history.
- omp's `memory.backend` stores: built in, but the starter kit does not own their format, and writing to them would change what omp's own memory recalls.
- A file committed on the working branches: reviewed with the code, but every branch carries its own copy, and merges conflict on it.
- A ref holding a one-file tree, written by compare-and-swap: chosen.

## Consequences

- `planOps` checks a whole batch against the doc the batch leaves, so a refused batch writes nothing and a lost race plans again on the new tip.
- Commits on the ref carry a fixed identity and the `Omp-Session` trailer, so a repository without `user.name` still records memory and `git log` names the session.
- `git gc` never prunes the history, since the ref keeps it reachable.

## Confirmation

`templates/omp/project-memory.test.ts` runs two processes that write 15 batches each at once and finds all 30 memories in 30 commits, and reads from a linked worktree what the main checkout wrote.

## Revisit when

Sessions on several computers need the same memory, which would mean pushing and fetching the ref and merging two tips.
