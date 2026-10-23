# Decisions

The choices that shape omp-agents and why they were made.
Read the entry before you change what it covers; reopen a decision by editing its entry in the same pull request, not by working around it.
Each entry links the section that holds the details.

## Import omp's modules instead of reimplementing them

The server imports omp's own modules from the installed package, only from `src/omp/`, and only through `src/omp/modules.ts`.
A reimplemented protocol, encryption, or session-file format drifts from the omp version the user runs; an import always speaks that version.
`src/omp/modules.ts` checks every export at startup, so a breaking omp release fails loudly with the missing export instead of misreading sessions.
See [omp modules](architecture/omp-modules.md).

## Read transcripts from session files, not the network

Every transcript comes from the session files on this machine, through one file watcher per session format.
The files exist for live and past sessions alike, for omp, Claude Code, and Codex, and never depend on a relay.
See [Transcripts](architecture/transcripts.md).

## Join every terminal session's Collab room

The server joins each listed terminal session as the guest `omp-agents`, opened or not.
Subagent status lives only in the host's memory, and the guest connection is the one source omp offers for it.
The cost is one more participant per session and a transcript snapshot through the relay on each join.
See [Why the server joins every terminal session](architecture/terminal-sessions.md#why-the-server-joins-every-terminal-session).

## Run dashboard sessions under keepers

Each dashboard session's omp runs under a keeper, a detached process that lends omp's stdio to one server at a time over a Unix socket.
A session the dashboard starts must outlive a restart, an update, or a crash of the server.
See [Session keepers](architecture/dashboard-sessions.md#session-keepers).

## One server owns the unattended work

Servers on different ports share `~/.config/omp-agents`, so `server.lock` names the one server that runs routines, scheduled sends, the todo and note inboxes, the daily clean-up, and the idle stop of sessions' processes.
Two servers running them would start every routine twice.
See [One server runs the unattended work](architecture/routines.md#one-server-runs-the-unattended-work).

## Keep Notes page entries in one server-owned JSON file

Notes live in `notes.json`, not individual Markdown files.
The server remains the only writer, while agents submit adds and appends through `note-inbox/`.
This follows the todo list's reducer, optimistic socket updates, and owner-lock model.
The tradeoff is that each note is not a greppable Markdown file.
The Projects page's project and user notes directories remain separate.

## A session's processes are its process groups and the broker daemons it owns

The **Processes** tab lists each process group under a session's omp, other than omp's own, and each service omp's project broker runs with the session's id as owner, plus the project's unowned services as shared.
omp's bash tool starts every command as a child of omp that leads its own group, its MCP servers share omp's group and end with it, its `__omp_worker_` workers serve every omp of a project or the machine, and a named service runs under the broker rather than omp, so these are the lines that tie a process to one session.
Docker gives a detached container no such line, so the tab leaves it out.
See [Session processes](architecture/session-processes.md).

## The desktop shell never imports the server

The Electron main process runs the server as a Bun child process.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls.
See [Desktop shell](architecture/desktop-shell.md).

## Ask omp for what omp already computes

Plan quota comes from `omp usage --json`, and Gmail and Google Calendar use the tokens omp holds for their MCP servers.
omp already owns that setup and those sign-ins, so the dashboard needs neither a copy of the logic nor a sign-in of its own.
See [Plan quota](architecture/plan-quota.md), [Google Calendar](architecture/http-api-google-calendar.md), and [Gmail](architecture/http-api-gmail.md).

## Plain git, not Graphite, for this repository

omp-agents uses `git`, `git push`, and `gh pr create --draft`, and never `gt`, even where the maintainer's other repositories use Graphite.
The starter kit's `git-workflow.md` names this exception.

## Settings sync syncs a registry of portable items through a Git remote

Settings sync pushes only the items `SYNC_ITEMS` names: omp's user config, instruction files, skills, rules, agents, and commands, and the source control settings.
Credentials, databases, sessions, and the dashboard's machine files never sync, whatever the remote holds, and neither do routines and todos, which name one machine's sessions and runs.
A Git remote of the user's own carries them because it needs no service of ours, keeps every version, and signs in with the machine's existing git credentials.
See [Settings sync](architecture/settings-sync.md).

## The dashboard wears T3 Code's theme tokens

`web/globals.css` takes T3 Code's light and dark values for the tokens the two apps share, its system font stack, and its two small text sizes, and `web/components/ui/button.tsx` adds T3's `outline`, `ghost-muted`, `glass`, `destructive-outline`, and `warning-outline` variants.
The pull request panel is being rebuilt to look like T3 Code's, and a panel drawn from another palette, font, and border weight never matches it, however close its layout gets.
The tokens change the whole app at once, so every page keeps one palette rather than the pull request page alone wearing T3's.
Fluid's tokens that T3 lacks stay, and the button keeps Fluid's two-step size ladder and press effect, which a surrounding size switches between.
T3's 24px `xs` and `icon-xs` join it only as sizes a caller names, since the pull request header's actions are 24px in T3 and a 28px compact button would not match them.
Primary buttons use `--primary` and `--primary-foreground` for their surface, press effect, and label, so the shared theme tokens apply throughout the app rather than leaving the primary action black.
See [Interface map](code-layout.md#interface-map) and the [parity harness](agent-smoke.md#parity-harness), which measures the panel against T3's.

## Pull request detail tabs keep tab semantics in T3's segmented control

`web/components/segmented-tabs.tsx` uses Radix Tabs for selection, keyboard focus, and panel relationships, rather than copying T3's toggle semantics.
Its 24px items and selected backgrounds match T3 without changing Fluid's tabs elsewhere in the dashboard.
Count badges are omitted from the strip, while accessible names keep comment and pending-finding counts.
The checks popover follows T3's attention, running, and completed order and folds completed checks only while another check needs attention or is running.
The existing check shape has no durations or separate workflow-approval state, so the page presents only the statuses and links the server reports.
See [Pull request details](usage/pull-request-details.md).

## Pull request activity uses T3's rail without inventing history

The Timeline interleaves commits, comments, reviews, threads, and known lifecycle times before grouping, so a conversation cannot swallow a commit or cross the unread boundary.
Resolved and dismissed threads collapse initially but remain on the rail, and replies reveal locally rather than requiring a write to GitHub.
Reactions are read-only, and replies beyond the detail query's first 20 comments open on GitHub instead of adding pagination requests.
Commit rows open the commit on GitHub.
The detail query reads merge and close times alongside existing data in one GraphQL request; absent historical events stay absent rather than being inferred from current branch or draft state.

## Keep open pull requests in browser-local tabs

The PR page keeps its open tabs, order, and selected detail tab through `useStoredState`.
The page's route alone says which PR shows and whether it shows **Code**, so another window showing a different PR keeps its own.
A session's or project's PRs sidebar has no strip: it had one with its own stored tabs, which did not work, so it now shows one pull request in memory, the session's first until another is picked.
Opening an existing PR focuses it, and closing the active tab chooses the right neighbour before the left, matching T3 Code.
A small pointer reorder needs no drag dependency; Alt+Left and Alt+Right on the number give the same operation to keyboard users.
The strip adds no panel controls of T3's: the sessions sidebar keeps its own rail toggle, and thread-details, panel maximize, and panel visibility have no equivalent surface on the PR page.
The terminal remains in the existing status bar, as T3 also omits its terminal control on the PR list page.
See [Pull requests](usage/pull-requests.md).

## Code review keeps omp's renderer and local drafts

The pull request Code tab uses T3's toolbar and reading order around omp's lazy diff renderer, rather than adding a second diff library.
Viewed checkboxes belong to GitHub and follow the viewer across clients.
Line comments instead append pending findings to the dashboard's Review draft, preserving its accept, edit, preview, and explicit-post workflow.
Commit-scoped diffs disable new comments because a review is pinned to the whole pull request's head.
See [Pull request details](usage/pull-request-details.md) and [Review drafts](architecture/review-drafts.md).

## Pull request Summary uses T3's sections without changing transcript Markdown

Summary folds conversation cards into its Comments section and moves stack and linked-session navigation into the header.
The stack menu also holds the session's other pull requests, the closest T3 navigation slot, and retains the existing queue-backed merge flow.
PR Markdown opts into alerts, repository autolinks, code chips, attachments, and authenticated media; session transcripts retain the shared renderer's defaults.
The media proxy fails closed on every redirect outside the four named GitHub hosts, except GitHub's own signed upload bucket after a `github.com` hop, which is where GitHub sends a token's request for an upload; T3 follows any HTTPS redirect there, and this keeps the one bucket.
See [Pull request details](usage/pull-request-details.md) and [HTTP API: pull requests](architecture/http-api-pull-requests.md).

## The pull request composer submits the Review draft as its line comments

T3's composer submits a review with its pending line comments; here those are the Review draft's pending findings, so the badge and **Review (N)** count them.
Submitting sends the verdict and summary with the post, and the server accepts the pending findings and posts in one step, so no socket edit can race the post.
Without an open draft the composer posts a plain review through a `review` change.
**Request changes** keeps the Review draft's rule that it needs a summary, and an approval needs nothing, as GitHub allows.
The forms' text lives in the composer rather than in a force-mounted popover, so closing it keeps a draft without patching the shared popover.
See [Pull request details](usage/pull-request-details.md) and [HTTP API: pull requests](architecture/http-api-pull-requests.md).

## Pull request checkout starts its worktree session on the server

**Check out** › **In a separate worktree** starts its session inside `PUT /api/pull-request/checkout`, through the same start a socket `start` runs, so one answer carries the checkout, the session to open, or why either failed, and the new-session draft stays as it was.
omp writes a session file only after its first reply, so the session starts with a prompt that asks for a summary of the pull request, where T3 opens an empty thread.
The fetched head can only fast-forward the local branch, so a branch with commits of its own is refused rather than overwritten, and a linked worktree that already has the branch is reused without moving it; the toast says when that leaves it off the pull request's head.
**In this repository** runs `gh pr checkout`, as T3 does, so gh owns fork remotes and upstreams there.
See [Pull request details](usage/pull-request-details.md) and [HTTP API: pull requests](architecture/http-api-pull-requests.md).
