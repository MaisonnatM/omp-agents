# OMP user context

Applies to every omp session on this machine.
If `PI_CODING_AGENT_DIR` is set, substitute that directory for `~/.omp/agent` in the reference paths below.

## Session project

When the request targets a different project than the session's cwd, such as another repository's code, tickets, or paths, say so in your first reply.
When you have the `move_session` tool, which the omp-agents dashboard gives the sessions it runs, call it with the project's path as your turn's last step and end the turn; the dashboard moves the session once the turn ends.
Otherwise you cannot move the session yourself; tell the user which command fits:
- `/move <path>` relocates this session to that project and reloads its context files and settings.
- `/wt [<branch>]` moves this session into a new worktree of its current repository, carrying uncommitted changes; it never switches repositories.
  When the work needs a fresh worktree of another repository, suggest `/move <path>` then `/wt <branch>`; suggest `/wt` alone when the repository is right but the session sits on `main` and must edit.
Read-only work in the other project, such as reading, searching, or answering questions, needs no confirmation: do it through absolute paths while you flag the mismatch.
Before editing, committing, or running checks there, wait until the session runs there or the user confirms working from the current one.

## Linear tickets

At the start of each session's task, check Linear for an existing matching ticket before creating a branch.
When a ticket exists, reuse its branch or use its suggested branch name when compatible with the Git safety rules below.
If the session must use another branch, keep it and link the resulting PR to the ticket in Linear.
Link any resulting PR to the matching ticket in Linear even when using the ticket's branch, with `xd://mcp__linear_save_issue` and `{ id, links: [{ url, title }] }`; the `create_attachment` tools upload files and fail on a URL.

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
Start an app that opens windows, such as an Electron app, in its hidden mode, such as `OMP_AGENTS_HEADLESS=1` for the omp-agents desktop app, and open a visible window only when the user asks for one.

## omp-agents dashboard

Never kill, signal, or `osascript quit` the omp-agents dashboard's processes: its window goes down with them.
To load new commits into it, ask the dashboard, which fast-forwards its own checkout, installs packages when `bun.lock` changed, and restarts its server in place only when origin has new commits; the sessions it started keep running through the restart, and the window then reloads.
First read where it stands with `curl -sS -H "Authorization: Bearer $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token")" http://127.0.0.1:4317/api/dashboard/update`, using the port the user's dashboard runs on if not 4317.
Its `behind` counts the new commits on its branch as of the last fetch.
Then update with the same command plus `-X PUT -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d '{}'`.
A `current` answer means origin had nothing new and the dashboard did not restart; when it still needs a restart, ask the user rather than kill its processes.
A 409 answer says why the checkout stayed as it was, such as uncommitted changes or local commits; report it rather than stash, reset, or retry.

## Docs and changelog

This section narrows the harness rule that a permanent fix or feature must update docs and changelog.
A change needs a docs or changelog edit only when a reader of that page would act differently because of it; a PR adds none by default.
Cosmetic UI changes, internal refactors, and fixes that restore documented behavior leave docs untouched.
When the repository has its own docs rules, they decide.

## Presenting a plan

Present every plan, proposal, or recommendation in the final-answer format, in plain words with no jargon.
The bold first line is the recommendation; the choice waiting on the user goes on **Needs you:**.
Below it, at most three bullets on why, cost, and risk, only those with something to say; mark a guessed number as a guess.
When the plan adds, removes, or reorders steps in a workflow, put a mermaid flowchart of the new flow after the first line, with the changed step highlighted.
Leave out file paths, line numbers, principle names, measurements, evidence lists, and rejected alternatives unless the user asks; a table only when the user must compare three or more options.

## Design work

Before any change to what a screen shows, even a one-value tweak, read `skill://design-workflow` and follow it.

## Conditional references

- Models: before configuring model roles, reasoning levels, fallback chains, or responding to quota exhaustion, read `~/.omp/agent/docs/model-routing.md`.
  Check `omp usage` at the start of a long session.
- Reviews: before marking a PR ready, merging one, a thermonuclear or interface review, or writing or editing a PR description, read `~/.omp/agent/docs/review-workflow.md`.
- Decisions: when you choose between options that would each work, when the user settles a choice, or before you change code a decision record may cover, read `~/.omp/agent/skills/decision-records/SKILL.md`.
