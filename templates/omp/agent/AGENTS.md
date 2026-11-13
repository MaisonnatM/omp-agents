# OMP user context

Applies to every omp session on this machine.
When an instruction file and the existing code disagree, follow the conventions in the code, and point out each mismatch in your final reply.
If `PI_CODING_AGENT_DIR` is set, substitute that directory for `~/.omp/agent` in the reference paths below.

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
Force-pushes and rewriting `main` still require explicit approval.

## Test servers

A server, dev server, or other listener you start to test or verify never takes a default port, such as 3000, 3001, 4200, 4317, 5000, 5173, 8000, or 8080: the user's own servers and other sessions run there.
Use the port range the repository's docs name; otherwise pick a random port between 20000 and 39999 and check it is free with `lsof -nP -iTCP:<port> -sTCP:LISTEN || echo free` first: `lsof` exits 1 when nothing listens, and `free` marks that as the expected answer.
Pass the port through the tool's port flag or `PORT`, and point every browser, curl, and proxy call at it.
When you tell the user about a server you started, write its full URL, such as `http://localhost:24816/settings`, never only the port.

A test or check runs headless and never opens a window on the user's screen.
Open pages with the `chrome-devtools` MCP tools (`xd://mcp__chrome_devtools_*`), which the starter kit adds to `mcp.json` and which run headless Chrome on a throwaway profile.
When the starter kit also added the `obscura` MCP server, use its tools (`xd://mcp__obscura_browser_*`) by default to read, scrape, or click through a page, such as `browser_navigate` then `browser_markdown` or `browser_snapshot`: it loads a page several times faster than Chrome in a tenth of the memory.
Keep `chrome-devtools` for anything about how a page looks, such as screenshots, layout, or design review, since Obscura lays pages out with its own engine.
Every page tool takes a `pageId` from `list_pages`, the first page being `1`; `resize_page` to 1920×1080 before screenshots, since Chrome starts at 800×600.
Use `take_snapshot` for the page's elements and their `uid`s, which `click`, `fill`, and `hover` take; `list_console_messages`, `list_network_requests`, and `performance_start_trace` cover errors, failed calls, and load time.
There is no cookie tool, and `evaluate_script` sets only non-`httpOnly` cookies; yampa verification is unaffected, since `control-yampa browser start` runs its own Playwright Chromium with the session cookie.
Start an app that opens windows, such as an Electron app, in its hidden mode, such as `OMP_AGENTS_HEADLESS=1` for the omp-agents desktop app, and open a visible window only when the user asks for one.

## Heavy commands

Run every build, test suite, and Playwright or browser run as `python3 ~/.omp/agent/scripts/heavy.py <command>`, with a command that uses `&&` or pipes quoted as one argument; it waits for one of a few slots that all sessions share, so give the call a longer timeout.

## Pasted secrets

When the user pastes a secret, such as an API key, a password, or a database URL with a password, save it where it belongs, such as the project's env file, Vercel, or the keychain, in the same turn: once the turn ends the session's saved copy reads `[redacted secret: …]`, so a resumed session no longer has the value.

## omp-agents dashboard

Never kill, signal, or `osascript quit` the omp-agents dashboard's processes: its window goes down with them.
To load new commits into it, ask the dashboard, which fast-forwards its own checkout, installs packages when `bun.lock` changed, and restarts its server in place only when origin has new commits; the sessions it started keep running through the restart, and the window then reloads.
First read where it stands with `curl -sS -H "Authorization: Bearer $(cat "${XDG_CONFIG_HOME:-$HOME/.config}/omp-agents/token")" http://127.0.0.1:4317/api/dashboard/update`, using the port the user's dashboard runs on if not 4317.
Its `behind` counts the new commits on its branch as of the last fetch.
Its `failed`, when set, names the commit the desktop app went back from because it did not start, and why; updating refuses that commit with a 409 until origin moves past it, so report it rather than retry.
Then update with the same command plus `-X PUT -H "Origin: http://127.0.0.1:4317" -H "Content-Type: application/json" -d '{}'`.
A `current` answer means origin had nothing new and the dashboard did not restart; when it still needs a restart, ask the user rather than kill its processes.
A 409 answer says why the checkout stayed as it was, such as uncommitted changes or local commits; report it rather than stash, reset, or retry.

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
