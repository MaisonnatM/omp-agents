---
name: git-worktrees
description: Use when spawning editing subagents, working in a linked worktree another session may share, or tracing where uncommitted changes came from.
---

# Git worktrees

- Every subagent that edits files runs without `isolated`, and its task names the session worktree's absolute path for every read, edit, and command: omp's task tool has no per-task cwd, so its cwd is still the checkout on `main`, where `isolated` would clone `main` and the worktree guard rejects relative paths.
- On a branch other than `main`, spawn editing subagents without `isolated` in the same checkout, in parallel only on disjoint files.
- When another live session has uncommitted work in your checkout, make a worktree of your own; the worktree guard enforces this, and its reason names the recovery when another process switches your branch.
- Read-only subagents, such as a scout or the thermonuclear reviewer, run without `isolated`; competing attempts at the same change, such as arena runners, always use it.
- Isolation fails when the session's cwd is not a Git repository: create a worktree for the subagent instead and name its path in the task.
- Read-only investigation needs no worktree; a request to work in place on `main` still needs a branch, which `git switch -c <branch>` in the main checkout gives.
- To learn where uncommitted or unmerged changes came from, search past sessions with eval's `archive` (`xd://eval/archive`) before guessing from git history; open a raw file under `~/.omp/agent/sessions/` only for the session it names.
