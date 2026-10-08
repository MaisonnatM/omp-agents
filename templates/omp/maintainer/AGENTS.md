# OMP user context

Applies to every omp session on this machine.
If `PI_CODING_AGENT_DIR` is set, substitute that directory for `~/.omp/agent` in the reference paths below.

## Git safety

In a Git repository, create a dedicated worktree on a new branch off the current default or parent branch before making changes.
Do all edits, checks, and commits there; reuse an existing worktree for the same task.
Skip the worktree only for read-only investigation or an explicit user request to work in place.
Every subagent touching a Git repository uses `isolated: true`, independently of the session's own worktree.
Before creating a branch, opening a PR, adopting an existing PR, or auditing Graphite registration, read `~/.omp/agent/docs/git-workflow.md`.

After merging or committing into local `main`, immediately run `git push origin main` and confirm `git status -sb` has no ahead count.
Force-pushes and rewriting `main` still require explicit approval.

Ending a session, from the dashboard's **End session** or the `end_session` tool, removes its worktree, so end yours only once its work is merged or pushed; the dashboard's **Settings → Worktrees** tab removes others, and both keep dirty, locked, and in-use checkouts.
To learn where uncommitted or unmerged changes came from, read the omp session files in `~/.omp/agent/sessions/`, one directory per working directory, before guessing from git history.

## Test servers

A server, dev server, or other listener you start to test or verify never takes a default port, such as 3000, 3001, 4200, 4317, 5000, 5173, 8000, or 8080: the user's own servers and other sessions run there.
Use the port range the repository's docs name; otherwise pick a random port between 20000 and 39999 and check it is free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` first.
Pass the port through the tool's port flag or `PORT`, and point every browser, curl, and proxy call at it.

## Conditional references

- Models: before configuring model roles, reasoning levels, fallback chains, or responding to quota exhaustion, read `~/.omp/agent/docs/model-routing.md`.
  Check `omp usage` at the start of a long session.
- Reviews: before a thermonuclear review or writing or editing a PR description, read `~/.omp/agent/docs/review-workflow.md`.
