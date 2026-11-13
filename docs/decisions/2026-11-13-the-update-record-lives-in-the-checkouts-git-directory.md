---
status: accepted
date: 2026-11-13
decision-makers: agent
---

# The update record lives in the checkout's git directory

In the context of the update record that the server writes around a move and the desktop shell reads after a stop, facing several servers on other ports and worktrees beside the desktop app's own, we chose one file per port under `git rev-parse --git-path omp-agents`, over the data directory under `~/.local/share/omp-agents` and over a file in the working tree.
Each worktree's server keeps its own record that git neither tracks nor cleans, accepting that a checkout without a git directory keeps no record and offers no update.

## Options considered

- The data directory: shared by every checkout on the machine, so it would need the checkout's path in its key, and a smoke server's data directory is often a scratch one.
- A file in the working tree: shows in `git status`, which then blocks the next update, and `git clean` removes it.
- `<git-dir>/omp-agents/update-<port>.json`: per worktree, since `--git-path` resolves to the worktree's own git directory, and per port, so a smoke server never touches the app's record; chosen.

## Consequences

The source-control auto-pull reads every port's record in a checkout and skips one held back by a rollback.
Removing a worktree removes its records with it.

## Confirmation

`src/server/update-journal.test.ts` writes and reads records in scratch checkouts; `src/source-control.test.ts` checks the auto-pull skips a checkout a record holds back.
