# OMP user context

Applies to every omp session on this machine.
When an instruction file and the existing code disagree, follow the conventions in the code, and point out each mismatch in your final reply.
If `PI_CODING_AGENT_DIR` is set, substitute that directory for `~/.omp/agent` in the reference paths below.

## Session project

When the request targets a different project than the session's cwd, such as another repository's code, tickets, or paths, say so in your first reply, and read `skill://session-project` for how the session moves there.
Read-only work in the other project, such as reading, searching, or answering questions, needs no confirmation: do it through absolute paths while you flag the mismatch.
Before editing, committing, or running checks there, wait until the session runs there or the user confirms working from the current one.

## Git safety

Where to edit follows the branch of the checkout the session runs in, its cwd.
On the default branch (`main`), a session that will edit starts by creating its worktree with a literal absolute path, `git worktree add -b <branch> ~/code/<repo>-wt/<topic> <base>`, or reuses an existing worktree for the same task.
Name that absolute path in every later edit, check, and commit, written out with no shell variable or `cd -`: a relative path resolves to the session's cwd on `main`, and the worktree guard reads directories only as written.
Every subagent that edits files runs without `isolated`, and its task names that worktree's absolute path for every read, edit, and command: omp's task tool has no per-task cwd, so its cwd is still the checkout on `main`, where `isolated` would clone `main` and the worktree guard rejects relative paths.
On any other local branch, including a linked worktree, work in place while your session is the one changing that checkout: edit, check, and commit on that branch alongside its existing local changes, and spawn editing subagents without `isolated` in the same checkout, in parallel only on disjoint files.
When another live session has uncommitted work in that checkout, make a worktree of your own; the worktree guard enforces this, and its reason names the recovery when another process switches your branch.
Read-only subagents, such as a scout or the thermonuclear reviewer, run without `isolated`; competing attempts at the same change, such as several runners given one task to compare, always use it.
Isolation fails when the session's cwd is not a Git repository: create a worktree for the subagent instead and name its path in the task.
Read-only investigation needs no worktree; a request to work in place on `main` still needs a branch, which `git switch -c <branch>` in the main checkout gives.
Before opening or adopting a PR, or rebasing a branch, read `~/.omp/agent/docs/git-workflow.md`.
In a repository that commits `.omp/land.json`, "merge on main" means calling the `land` tool from the branch's checkout once its work is committed; it merges into a fresh copy of `origin/main`, runs the file's checks on the merged result, and pushes, and merging or pushing into `main` yourself is blocked there.
In any other repository, after merging or committing into local `main`, immediately run `git push origin main` and confirm `git status -sb` has no ahead count.
Force-pushes and rewriting `main` still require explicit approval.
Ending a session, from the dashboard's **End session** or the `end_session` tool, removes its worktree, so end yours only once its work is merged or pushed; the dashboard's **Settings → Worktrees** tab removes others, and both keep dirty, locked, and in-use checkouts.
To learn where uncommitted or unmerged changes came from, search past sessions with eval's `archive` (`xd://eval/archive`: recaps and prompts by project) before guessing from git history; open a raw file under `~/.omp/agent/sessions/` only for the session it names.

## Test servers

A server, dev server, or other listener you start to test or verify never takes a default port, such as 3000, 3001, 4200, 4317, 5000, 5173, 8000, or 8080: the user's own servers and other sessions run there.
Use the port range the repository's docs name; otherwise pick a random port between 20000 and 39999 and check it is free with `lsof -nP -iTCP:<port> -sTCP:LISTEN || echo free` first: `lsof` exits 1 when nothing listens, and `free` marks that as the expected answer.
Pass the port through the tool's port flag or `PORT`, and point every browser, curl, and proxy call at it.
When you tell the user about a server you started, write its full URL, such as `http://localhost:24816/settings`, never only the port.

A test or check runs headless and never opens a window on the user's screen.
Before opening, reading, or screenshotting a web page, read `skill://headless-browser`, which picks the page tools.
Start an app that opens windows, such as an Electron app, in its hidden mode, such as `OMP_AGENTS_HEADLESS=1` for the omp-agents desktop app, and open a visible window only when the user asks for one.

## Pasted secrets

When the user pastes a secret, such as an API key, a password, or a database URL with a password, save it where it belongs, such as the project's env file, Vercel, or the keychain, in the same turn: once the turn ends the session's saved copy reads `[redacted secret: …]`, so a resumed session no longer has the value.

## Conditional references

- Linear: at the start of a task, before creating a branch, and when opening a PR, read `skill://linear-tickets`.
- Docs: before adding or editing docs or a changelog entry for a change, read `skill://docs-and-changelog`, which narrows the harness rule that every fix or feature updates them.
- Dashboard: never kill, signal, or `osascript quit` the omp-agents dashboard's processes, since its window goes down with them; to load new commits into it or restart it, read `skill://dashboard-update`.
- Plans: before presenting a plan, proposal, or recommendation, read `skill://presenting-a-plan`.
- Design: before any change to what a screen shows, even a one-value tweak, read `skill://design-workflow` and follow it.
- Models: before configuring model roles, reasoning levels, fallback chains, or responding to quota exhaustion, read `~/.omp/agent/docs/model-routing.md`.
  Check `omp usage` at the start of a long session.
- Reviews: before marking a PR ready, merging one, a thermonuclear or interface review, or writing or editing a PR description, read `~/.omp/agent/docs/review-workflow.md`.
- Decisions: when you choose between options that would each work, when the user settles a choice, or before you change code a decision record may cover, read `~/.omp/agent/skills/decision-records/SKILL.md`.
