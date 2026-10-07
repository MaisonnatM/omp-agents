# OMP user context

Applies to every omp session on this machine.
If `PI_CODING_AGENT_DIR` is set, substitute that directory for `~/.omp/agent` in the reference paths below.

## Git safety

In a Git repository, create a dedicated worktree on a new branch off the current default or parent branch before making changes.
Do all edits, checks, and commits there; reuse an existing worktree for the same task.
Skip the worktree only for read-only investigation or an explicit user request to work in place.
Every subagent touching a Git repository uses `isolated: true`, independently of the session's own worktree.
Force-pushes and rewriting `main` still require explicit approval.

## Conditional references

- Models: before configuring model roles, reasoning levels, fallback chains, or responding to quota exhaustion, read `~/.omp/agent/docs/model-routing.md`.
  Check `omp usage` at the start of a long session.
- Reviews: before a thermonuclear review or writing or editing a PR description, read `~/.omp/agent/docs/review-workflow.md`.
