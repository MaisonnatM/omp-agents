---
name: session-project
description: Move a session to the project its request targets. Use when the request targets a different project than the session's cwd, such as another repository's code, tickets, or paths.
---

# Session project

When you have the `move_session` tool, which the omp-agents dashboard gives the sessions it runs, call it with the project's path as your turn's last step and end the turn; the dashboard moves the session once the turn ends.
Otherwise you cannot move the session yourself; tell the user which command fits:
- `/move <path>` relocates this session to that project and reloads its context files and settings.
- `/wt [<branch>]` moves this session into a new worktree of its current repository, carrying uncommitted changes; it never switches repositories.
  When the work needs a fresh worktree of another repository, suggest `/move <path>` then `/wt <branch>`; suggest `/wt` alone when the repository is right but the session sits on `main` and must edit.
