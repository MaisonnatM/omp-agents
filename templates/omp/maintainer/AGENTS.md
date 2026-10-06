# OMP user context

Applies to every omp session on this machine.
Resolve the reference paths below against `PI_CODING_AGENT_DIR` when set, otherwise `~/.omp/agent`.

## Git safety

In a Git repository, create a dedicated worktree on a new branch off the current default or parent branch before making changes.
Do all edits, checks, and commits there; reuse an existing worktree for the same task.
Skip the worktree only for read-only investigation or an explicit user request to work in place.
Every subagent touching a Git repository uses `isolated: true`, independently of the session's own worktree.
Before creating a branch, opening a PR, adopting an existing PR, or auditing Graphite registration, read [docs/git-workflow.md](docs/git-workflow.md).

After merging or committing into local `main`, immediately run `git push origin main` and confirm `git status -sb` has no ahead count.
Force-pushes and rewriting `main` still require explicit approval.

Remove your own worktree through `end_session` with `removeWorktree: true`, once its work is merged or pushed; the dashboard's **Settings → Worktrees** tab removes others, and both keep dirty, locked, and in-use checkouts.
To learn where uncommitted or unmerged changes came from, read the omp session files in `~/.omp/agent/sessions/`, one directory per working directory, before guessing from git history.

## Conditional references

- Models: before configuring model roles, reasoning levels, fallback chains, or responding to quota exhaustion, read [docs/model-routing.md](docs/model-routing.md).
  Check `omp usage` at the start of a long session.
- Reviews: before a thermonuclear review or writing or editing a PR description, read [docs/review-workflow.md](docs/review-workflow.md).
