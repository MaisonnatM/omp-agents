# OMP user context

Applies to every omp session on this machine.
If `PI_CODING_AGENT_DIR` is set, substitute that directory for `~/.omp/agent` in the reference paths below.

## Git safety

When the checkout is on the default branch (`main`), create a dedicated worktree on a new branch off it before making changes.
When the checkout is on any other local branch, work in place: edit, check, and commit on that branch alongside its existing local changes, without a worktree.
In a worktree, do all edits, checks, and commits there; reuse an existing worktree for the same task.
Skip the worktree also for read-only investigation or an explicit user request to work in place.
On the default branch, every subagent that edits files in a Git repository uses `isolated: true`, independently of the session's own worktree; a read-only one, such as a scout, runs without it.
Isolation fails when the session's cwd is not a Git repository: create a worktree for the subagent instead and name its path in the task.
On any other local branch, editing subagents also work in place: spawn them without `isolated` in the same checkout, and run two at once only on disjoint files.
Competing attempts at the same change, such as arena runners, still use `isolated: true`.
Force-pushes and rewriting `main` still require explicit approval.

## Test servers

A server, dev server, or other listener you start to test or verify never takes a default port, such as 3000, 3001, 4200, 4317, 5000, 5173, 8000, or 8080: the user's own servers and other sessions run there.
Use the port range the repository's docs name; otherwise pick a random port between 20000 and 39999 and check it is free with `lsof -nP -iTCP:<port> -sTCP:LISTEN` first.
Pass the port through the tool's port flag or `PORT`, and point every browser, curl, and proxy call at it.

## omp-agents dashboard

Never kill, signal, or `osascript quit` the omp-agents dashboard's processes: its window goes down with them.
To load new commits into it, ask the dashboard, which fast-forwards its own checkout, installs packages when `bun.lock` changed, and restarts its server in place only when origin has new commits; the sessions it started keep running through the restart, and the window then reloads.
First read where it stands with `curl -sS -b "omp-agents-token=$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token")" http://127.0.0.1:4317/api/dashboard/update`, using the port the user's dashboard runs on if not 4317.
Its `behind` counts the new commits on its branch as of the last fetch.
Then update with the same command plus `-X PUT -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d '{}'`.
A `current` answer means origin had nothing new and the dashboard did not restart; when it still needs a restart, ask the user rather than kill its processes.
A 409 answer says why the checkout stayed as it was, such as uncommitted changes or local commits; report it rather than stash, reset, or retry.

## Conditional references

- Models: before configuring model roles, reasoning levels, fallback chains, or responding to quota exhaustion, read `~/.omp/agent/docs/model-routing.md`.
  Check `omp usage` at the start of a long session.
- Reviews: before a thermonuclear review or writing or editing a PR description, read `~/.omp/agent/docs/review-workflow.md`.
