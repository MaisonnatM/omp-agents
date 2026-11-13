---
status: accepted
date: 2026-11-13
decision-makers: agent
---

# Ending a session remembers its removed worktree for resume

In the context of resuming a session whose end removed its linked worktree, facing a resumed agent whose commands name a directory that no longer exists, we chose to record the removed worktree's path, repository, and branch by session id when the session ends, in `ended-worktrees.json`, and to add it back before the resume, over guessing the branch from the worktree's directory name and over refusing the resume.
That restores exactly the worktree the dashboard removed, including one the session reached only through its bash calls while its own directory was the main checkout, accepting that a worktree removed some other way, such as by hand or from **Settings → Worktrees**, is not put back.

## Context

Session 01a1d448 ran in the main checkout and worked in `~/code/omp-agents-wt/central-icons` through bash's `cwd`; after **Archive session** removed that worktree, a resume started fine and its first command failed with `Working directory does not exist`.
Once a worktree is removed, git keeps its branch but nothing that ties the path to it: the worktree's admin directory and HEAD reflog go with it, and its directory name follows `<repo>-<branch>` only for worktrees the dashboard adds, not the `<repo>-wt/<topic>` ones agents add.

## Options considered

- Record at removal, by session id: exact branch and path, and covers sessions whose own directory is the main checkout; needs one small JSON file.
- Derive the branch from the directory name: no new state, but `<repo>-wt/<topic>` names a topic, not a branch, and `/` in a branch name is lost.
- Refuse the resume with a clear message: no new state, but leaves the user to recreate the worktree by hand each time.
