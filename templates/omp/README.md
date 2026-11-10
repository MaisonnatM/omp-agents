# omp starter kit

An opinionated omp setup to start from: model roles with fallback chains across four providers, agent rules, a reply format, a review agent, a `/ship` workflow, and UI design skills.
It is the setup this project is built with.

## Install

From the repository root:

```sh
bun run omp-template --dry-run   # list what would change
bun run omp-template             # install
```

The installer:

- copies every file under [`agent/`](agent) into your omp agent directory, `~/.omp/agent` (or `PI_CODING_AGENT_DIR` when set);
- with `--maintainer`, also copies [`maintainer/`](maintainer), and a file there replaces the `agent/` file with the same path;
- applies each setting in [`config.yml`](config.yml) with `omp config set`, so omp writes it and every other key in your `config.yml` stays as it is;
- adds the [`cursor/plugins`](https://github.com/cursor/plugins) marketplace and installs its `pstack` plugin, unless they are already there, then links pstack's skills where omp loads them, as `extensions/pstack-skills.ts` below explains;
- adds the `chrome-devtools` MCP server, headless on a throwaway profile, to `mcp.json` in the agent directory, unless you already list a server by that name.

A setting that you already have keeps your value, and the installer lists it as `keep yours`.
A file that you already have is replaced, listed as `overwrite`, only when you never edited it: it matches what the last install wrote, which the installer records in `starter-kit-installed.json` in the agent directory, or a version the kit shipped before, which the kit's git history holds.
A file you edited keeps your version and is listed as `keep yours`; merge the kit's changes into it by hand, or pass `--force` to overwrite it and every other `keep yours` with the kit's version.
A file an earlier kit shipped and this one no longer does is removed, listed as `remove`, when you never edited it, by the same test; one you edited stays, listed as `keep yours`, even with `--force`.
Running the installer again changes nothing that already matches.
After one install with `--maintainer`, later installs copy `maintainer/` too.

`bun run omp-template --files` brings only the files up to date, as the last recorded install chose them, and never adds back a file you deleted; it needs no omp and does nothing before an install has been recorded.
**Update dashboard** runs it in the updated checkout before the server restarts, so a landed kit change reaches the files you never edited.

The desktop app's **Get started** starter kit step and **Install omp Starter Kit…** menu run this same non-forced installer.
That step's read-only status includes files, settings, marketplace, plugins, and MCP servers; `keep yours` is complete rather than an invitation to overwrite it, and an outdated file you never edited is pending.
CLI calls use the resolved omp package, including `OMP_PACKAGE_DIR` when set.

Restart running omp sessions to pick up the new files and settings.

## What's inside

Settings, in `config.yml`:

- `modelRoles`: an Anthropic model for every role.
- `retry.fallbackChains`: Codex first and Cursor Composer for cheap roles, with quota-aware skipping enabled.
  Cursor Grok is opt-in rather than an automatic fallback; existing fallback settings are preserved unless `--force` is used.
- `modelProviderOrder`: the same three providers in the same order.
- `task.isolation`: `isolated: true` subagents work in their own clone of the session's checkout, and successful changes apply back there as a patch; omp 18.18.1 has no per-task `checkout` or cwd, so a session on `main` spawns editing subagents without `isolated` and names its worktree's absolute path in their task.
  At most two subagents run at once.
- `task.perCallModel: on` with `task.perCallModelAllow`: a `task` call may pick its model per spawn, only among the council's three models.
- `skills.customDirectories`: `~/.omp/plugins/pstack-skills`, where `extensions/pstack-skills.ts` links pstack's skills.
- `collab.autoStart: control`: every terminal session publishes itself so that the omp-agents dashboard can drive it.

Files, in `agent/`:

- `AGENTS.md`: worktree and force-push safety, the rule that sends every UI change through the `design-workflow` skill, plus conditional pointers for model routing, reviews, and decision records.
  Read the matching reference under `~/.omp/agent/docs/` before taking that branch of the workflow, regardless of the repository's working directory.
- `docs/`: `model-routing.md` covers provider order and quota handling, and `review-workflow.md` covers thermonuclear and interface reviews, proof boxes, PR descriptions, and PR screenshots.
  These references load on demand rather than in every session's context.
- `APPEND_SYSTEM.md`: short final replies that open with the answer in bold and add only the Needs you, Not verified, and Done lines that have content, ending on up to three suggested next prompts, design variants named once and quoted by that name on every surface, a UI change handed off on a running dev server with checked screenshots, questions asked through the ask tool with the recommended option first, how Cursor models call omp's `ask`, `bash`, `grep`, and skills, and a code-quality review before any pull request, which a repository limits to the files its `.omp/review-paths` globs match.
- `agents/thermonuclear-reviewer.md`: a read-only reviewer that checks the diff against the `CODING_STANDARDS.md` at the root of the checkout it reviews, then runs the thermo-nuclear code quality review on the `plan` role's model.
- `agents/interface-reviewer.md`: a read-only reviewer that runs the `interface-review` skill in full mode on a PR, then applies the `app-consistency-review` skill to check the change reuses the app's shared components and follows its tokens and sibling screens, on the `plan` role's model.
- `agents/poteto-agent.md` and `agents/poteto-agent-codex.md`: the delegates a `/poteto-mode` run and `/ship` spawn, on the parent's model and on Codex, so a panel spans two model families; they replace pstack's own `poteto-agent`, which looks for its skill under Cursor's paths.
- `agents/design-critic.md`: a read-only reviewer that the `design-workflow` skill spawns on a UI change it did not build; it screenshots each page and state next to the app's sibling screens and lists every visible bug with pixel measurements, on the `default` role's model.
- `skills/council/SKILL.md` and `agents/council.md`: say "council" and three models from three providers, Claude Opus, GPT Sol, and Gemini Pro, review or advise on the request in rounds, scored out of 10 for a code review.
  The skill passes each member's model on its `task` call; the agent's `model` list and `task.perCallModelAllow` approve exactly those three.
- `skills/ship/SKILL.md`, `commands/ship.md`, and `extensions/ship.ts`: `/ship [Linear issue]` drives a change from an optional ticket to plan, draft PR, interface review, thermonuclear review, and live review.
  `APPEND_SYSTEM.md` has the agent start it on its own for a request that will end in a pull request, unless the user says "no ship".
  The skill holds the procedure and is tagged `workflow` in its `metadata.tags`, so the dashboard's Settings › Workflows lists and edits it; the command only tells the session to follow the skill for the issue it names.
  The extension adds the `ship_stage` tool and shows the stage and the PR's needs in the session.
  When the repository commits `.omp/review-paths`, the gate asks for the thermonuclear checkbox only when a changed file matches one of its globs; a repository without the file reviews every PR.
  The interface review has the opposite default: the gate asks for the `- [x] Interface review` checkbox only when the repository commits `.omp/ui-paths` and a changed file matches one of its globs.
  Recording `thermonuclear` or `ready_gate` checks the box of each review before it that the PR needs in the PR body, ticking the template's `- [ ]` box or appending it, through the same checked edit as `pr_description`.
  Recording `live` or live work while the PR is a draft records nothing and names the next step, such as `gh pr ready`, which records `live` itself.
  A branch without a PR gets draft-first recovery instructions; authentication failures retain their actual error.
  When GitHub rejects a token that gh reads from an environment variable, such as `GITHUB_TOKEN` from a project `.env`, while a stored gh login works, this extension and `pr_description` run gh without that variable for the rest of the session, which the agent's own `env -u` cannot do for omp's process.
  When no stored login works, the gate names the rejected credential and the project `.env` file omp read it from at startup, never the token itself.
  A command run through `env` or after `NAME=value` assignments, such as `env -u GITHUB_TOKEN gh pr ready 7`, goes through the same gate.
  The gate reads the PR and the review paths in the checkout the publishing command runs in, which a `cd`, `env -C`, `bash -c`, or the bash call's cwd names.
  It refuses the command when that checkout is not one of the PR's repository, such as `gh pr ready 7 -R other/repo` from this repository, when a variable or `cd -` hides the directory, and when the command sets `GH_REPO` or `GH_HOST` inline.
  A PR on a repository you cannot push to, such as a contribution to someone else's project, skips the review gates.
  A PR body with an unchecked `- [ ] Browser proof` box, which a repository's PR template can declare, also blocks going live when the interface review applies; the extension checks the box, not a screenshot.
  Dashboard and CLI GitHub calls share separate GraphQL/REST reset cooldowns; exhausted quota is not reported as bad credentials or a fresh successful read, and stale `/ship` status cannot advance a gate.
- `extensions/pr-description.ts`: the essential `pr_description` tool reads and edits descriptions with checked fresh reads, private original backups, and guards against accidental empty output, missing or ambiguous replacement anchors, and concurrent changes observed before the write.
  Use `change: {kind:"append", text:"..."}` or `{kind:"replace-text", oldText:"...", newText:"..."}` for surgical edits; full replacement requires the exact `original` returned by `{kind:"read"}`, and clearing requires `allowEmpty: true`.
  Original descriptions are kept with mode `0600` under `$XDG_CONFIG_HOME/omp-agents/pr-body-backups/`, defaulting to `~/.config/omp-agents/pr-body-backups/`.
  `extensions/github/access.ts` stores only the budget cooldowns under the sibling `github/<credential SHA256>/` directory, never the raw credential, and uses the shared `github/owner-lock.ts` primitive.
- `extensions/cache-tail.ts`: Anthropic caches the tools and system prompt for an hour and the conversation for five minutes.
  A five-minute cache write costs 1.25 times the input price and an hour-long one twice that, and a conversation tail is read again within seconds, so this cuts the write bill without losing the warm head after a pause.
  It also stops cache warming while the session is idle.
  Set `OMP_CACHE_TAIL_TTL=1h` to turn it off.
- `extensions/land.ts`, with `extensions/land/`: the `land` tool lands a committed branch on `main` in a repository that commits `.omp/land.json`, the way [Ultimate](https://github.com/HazAT/ultimate)'s lander does, with no model in the loop.
  It merges the branch's tip into a fresh temporary worktree of `origin/main` with a merge commit whose message carries the agent's divergence note, runs the setup and checks the file lists on that merged result, and pushes the merge commit, never forced.
  `land.json` holds `target` (default `main`), `remote` (default `origin`), `setup`, commands run in the worktree after the merge so a branch's new dependencies get installed, and `checks`, each a command or a list of commands that run at the same time; checks get `LAND_BASE` and `LAND_TIP`, the target and branch commits.
  A check is stopped after 2 minutes without output or 10 in all, and a failed one runs once more: passing then lands with a flaky warning, failing again returns the failed tests and type errors it named anywhere in its output, then the end of that output.
  A conflict names the files and pushes nothing; a push that loses a race to another landing starts again from the new tip, three times at most.
  Afterwards the local `main` moves forward to the landed commit only when it can without touching uncommitted changes, and worktrees left by an omp process that died are removed at the next landing.
  In such a repository the extension blocks an agent's `git push` to `main`, `git merge` into a checked-out `main` other than `--ff-only` from `origin/main`, and `gh pr merge`, so an agent lands only through `land`; your own terminal is not affected, and a subagent cannot land.
- `extensions/end-session.ts`: the `end_session` tool, with which an agent ends its own session once its turn is over, and the omp-agents dashboard removes its worktree as **End session** does, so a prompt such as "Merge on main, then end the session" runs to the end.
- `extensions/arena.ts`: the `arena` tool, with which an agent that gives two or more subagents the same task records the runners, its judge, the runner it keeps as the base, and what it takes from the others.
  The omp-agents dashboard shows those runners side by side in the Todos card's Subagents section and marks the base.
- In a task subagent, `end-session.ts`, `arena.ts`, `land.ts`, `ship.ts`, `todos.ts`, `notes.ts`, and `events.ts` remove their tools when its session starts, since those tools act for the session you talk to; each subagent request then carries about 2,600 fewer tokens of tool schemas.
- `extensions/google-accounts.ts`: when omp is signed in to two or more Gmail or Google Calendar accounts, one MCP server each, tells a session at every prompt each account's server, address, and tool prefix.
  When you put only some of the addresses in the session's space, Personal or Work, in the dashboard's Settings › Integrations, it also tells the session to use those for its mail and calendar unless you name another account.
  A session's space is its workspace's, where a linked worktree counts as its repository's main checkout, and no tool is blocked.
  When a Gmail or Google Calendar server answers a tool call with HTTP 401, the session is told the account is signed out, not to retry or sign in itself, and to ask you to sign in again in the dashboard's Settings › Integrations, and the dashboard's bell shows a sign-in notice.
- `extensions/pstack-skills.ts`: omp skips every pstack skill in the plugin, because pstack's `plugin.json` opts into a strict schema that refuses the `disable-model-invocation` key its skills carry.
  At each session start this links each skill of the installed pstack into `~/.omp/plugins/pstack-skills`, which `skills.customDirectories` lists and omp reads leniently, keeping them hidden from the model's skill list as pstack intends, and repoints the links after a marketplace update.
  Those links take the bare name from a skill of the same name in your own skill folders, which stays reachable under a prefixed name such as `agent/<name>`; pstack's `poteto-mode` is left out, so the kit's alias keeps that name.
- `extensions/headless-mark.ts`: adds an `omp-agents.headless` entry to a session that `omp -p` or `omp --mode json` runs, so the omp-agents dashboard leaves those one-shot runs out of its past sessions.
- `extensions/chrome-devtools-page.ts`: a `chrome-devtools` MCP call written to its `xd://` device without a `pageId` runs on page `1`, the first page, except `close_page` and `select_page`, whose `pageId` names the page they act on, and `list_pages` and `new_page`, which take none.
- `extensions/project-memory.ts`: gives the omp sessions of one git repository a shared memory and news of each other's work.
  Before a session's first prompt it gets a brief: the repository's memory index and the last 10 landings on its default branch, each with the session that made it and that session's first prompt.
  Before a later prompt, and only when something is new, it gets a catch-up on what other sessions landed and remembered since, listing first the landings that touch files its own branch changed.
  The `project_memory` tool lists, reads, and changes the memory, decisions, facts, and lessons of one line and a body each, in batches that apply whole or not at all; a subagent can only read it.
  Omit `read` and `ops` to list the index; empty `read: ""` and `ops: []` placeholders also mean omitted.
  A nonempty `read` and a nonempty `ops` batch together are refused before anything is written.
  The memory is a `memory.json` committed to `refs/omp/memory` in the repository, which its worktrees share and which is never pushed, so `git log -p refs/omp/memory` shows each change and the session that made it.
  Landings are read from git each time, and the `Omp-Session` trailers that `extensions/session-trailer.ts` writes say which session made each one; each session's first prompt is kept under `.git/omp-project-memory/intents/`.
  `omp -p`, `--mode json`, and subagents get neither the brief nor a catch-up.
- `extensions/redact-secrets.ts`: once each turn ends, replaces every secret in what omp keeps of the session on disk with `[redacted secret: <what it was>]`: the session file, the folder of tool logs and subagent files beside it, and the session's rows in `history.db`.
  It finds keys by their shape, such as Stripe, GitHub, OpenAI, Anthropic, Supabase, AWS, and Google keys, the password in a database URL, and, in what you wrote, `password:` and `NAME_PASSWORD=` pairs, then that value wherever else it shows up.
  The running agent keeps the real values until the session ends, so save a pasted secret where it belongs in the same turn; the provider has already received it.
  See [Pasted secrets](../../docs/architecture/pasted-secrets.md) for what it leaves.
- `extensions/session-trailer.ts`: adds an `Omp-Session: <session id>` trailer to every commit an omp session makes, through a config-based `prepare-commit-msg` git hook set in omp's environment, which runs beside a repository's own hooks, husky's included.
  `git log --format='%h %(trailers:key=Omp-Session,valueonly)'` names each commit's session, and `omp -r <session id>` reopens it.
  A git without config-based hooks ignores it.
- `extensions/worktree-guard.ts`: keeps agents from changing a checkout under each other.
  It blocks every `edit` or `write` in a repository's main checkout while it is on its default branch (`origin/HEAD`, else `main` or `master`), and tells the agent to work in a linked worktree; on any other branch the main checkout is edited in place, as `AGENTS.md` asks.
  The omp process that last changed a checkout, a session with its subagents, owns it, and `omp-checkout-owner.json` in the checkout's git dir names its pid.
  While the owner runs and the checkout holds uncommitted changes to tracked files or an unfinished merge or rebase, another session's `edit`, `write`, and git or `gh pr checkout` commands that change or switch the checkout are blocked, and that session works in a worktree of its own.
  The guard reads commands behind `env` and similar wrappers, in the directory an `env -C` names, and inside `bash -c`, and `git worktree remove` or `move` counts as a change to the worktree it names.
  A file git ignores, such as `.env`, is in no worktree, so its edit there asks the user and goes ahead once approved; a declined edit, or one in a session that cannot ask, stays blocked.
  A clean checkout passes to the next session that changes it, and a session that ends gives up its claims.
  When HEAD is no longer where a session left it, because another process switched the branch, that session's changes there are blocked until a switch it runs as its own command succeeds, back or to the new branch.
  The changes of an `isolated: true` subagent apply to the checkout its spawn names only where an edit could go, so an apply into the main checkout on its default branch, or into another live session's checkout with uncommitted changes, is refused and its patch kept; this needs an omp that fires `before_subagent_apply`, which 18.18.1 does not.
  Reads, files outside git, and the clones omp makes for `isolated: true` subagents pass, and a change in a directory that a variable names is blocked until the command writes the directory out.
  If a session's process dies and you know its work is done, delete the claim file it names; the guard also replaces a claim whose process has ended.
  It reads HEAD and `origin/HEAD` from their files in the git dir and keeps each directory's checkout for a minute, so an edit or write in a checkout another session does not hold starts no `git`.
- `extensions/todos.ts`: `user_todo` reads the dashboard list and queues add, check, edit, and delete changes; `add` and `edit` take the name of an existing section, and an `add` naming one that does not exist files the todo in none.
  On `add`, an omitted or empty `due` value means no due date, and on `edit` an empty one clears it; a nonempty value must use `YYYY-MM-DD`.
- `extensions/notes.ts`: `user_note` lists and reads the dashboard's notes and queues add/append changes.
  An empty parameter reads as left out, and a session that adds a title it already added gets that note's id back.
- `extensions/events.ts`: `user_event` lists the upcoming events kept on this computer for the dashboard's Calendar page, queues a timed reminder in the session's name, and removes one that session added.
  A start without an offset is local time, a start in the past is refused, and a session that adds the same title and start again gets that event's id back.
- `extensions/inbox/client.ts`: what `todos.ts`, `notes.ts`, and `events.ts` share to read their inboxes and leave a change there, one file each, for the dashboard to apply; the dashboard's own extensions import it too.
- `skills/design-workflow/SKILL.md`: the steps `AGENTS.md` sends every UI change through: references before the first edit, five structurally different variants for a structural ask, and the `design-critic` agent before the user sees it.
- `skills/`: `apple-design`, `emil-design-eng`, and `beautiful-shadows` for interface work; `thermo-nuclear-code-quality-review` for the reviewer; `app-consistency-review`, which the interface reviewer autoloads to check a PR against the app's shared components, tokens, and sibling screens; `decision-records`, which keeps each choice made in a project as one dated file in its `docs/decisions/`, with a `check.ts` that checks them; `ship`, the `/ship` workflow above; and `poteto-mode`, which says where pstack's skill of the same name keeps its file.
  The alias maps Cursor-only cleanup and runtime-control instructions to omp's available tools without editing the plugin cache.
- `skills/interface-review/` and `skills/better-*/`: Jakub Krehel's change-scoped interface review, the `better-interface` review it hands off to, and the six discipline skills that one routes to: accessibility, colors, layout, typography, UI, and writing.
- `skills/grill-with-docs/`, `skills/grill-me/`, `skills/grilling/`, and `skills/domain-modeling/`: Matt Pocock's design interview, which you start with `/skill:grill-with-docs` in a repository or `/skill:grill-me` anywhere; it asks rounds of numbered questions, each with a recommended answer, and `grill-with-docs` also writes settled terms to the project's `GLOSSARY.md` as they resolve.
  The kit's `domain-modeling` records decisions with `decision-records` instead of upstream's numbered ADRs in `docs/adr/`.

## Requirements

- omp, on your `PATH` or named by `OMP_PACKAGE_DIR`.
- Accounts for the providers you want to use: Anthropic, OpenAI Codex, and Cursor.
  omp skips a provider that it cannot reach and uses the next one in the chain.
  Edit `config.yml` before you install to drop a provider, or change the roles later in the dashboard's **Settings**.
- For `/ship`: the [GitHub CLI](https://cli.github.com) signed in, and the Linear MCP server connected to omp.
- For `/ship`'s interface review: a repository with `.omp/ui-paths`; without it the review never runs.
- For `/ship`'s plan: the `arena` and `technical-writing` skills from pstack, which the installer and `extensions/pstack-skills.ts` make loadable; without them the plan step stops and names the missing skill.

## Maintainer git profile

`bun run omp-template --maintainer` also copies [`maintainer/`](maintainer) on top of the same relative paths.
The profile includes `AGENTS.md` for local-main pushing and worktree cleanup, `docs/git-workflow.md` for worktrees, rebases, draft-first PRs, and stacks with `git` and `gh`, `skills/mma-mode/` for maintainer steering, and `skills/best-in-class-approach/`, the quality bar mma-mode stacks for build and review.
Mma-mode resolves poteto by URI and loads only references matching the current task instead of a monolithic contract.
It also includes two scripts, run with `python3 ~/.omp/agent/scripts/<name>`: `prune-git-branches.py`, which with `--apply` removes merged worktrees and local branches whose upstream is gone (a dry run without it), and `session-speed.py`, which compares agent time per prompt before and after a config cutover.
The default install does not copy those files.
`--force` still overwrites a file you already have, including one the profile replaces.

## Customize

The kit is a starting point.
Edit the files here before you install, or edit your own copies afterwards; the dashboard's **Settings** page edits the model routing and every file above in place.
The model ids in `config.yml` are the ones `omp models` listed when the kit was written; replace any that your omp no longer lists.

## Per-project setup

The kit is your personal layer in `~/.omp/agent`, which every session loads.
A repository can commit its own layer in an `.omp/` folder at its top, with the same kinds of files, and omp loads it after yours, so the project's entry wins on a name clash, except a TypeScript slash command, where yours wins.
Before the dashboard starts a session that would run the project's extensions, hooks, tools, MCP servers, or settings, it asks you to trust them; see [Per-project agent setup](../../docs/usage/per-project-agent-setup.md).

## Licenses

The kit is MIT-licensed with the rest of the repository.
The `apple-design`, `emil-design-eng`, `beautiful-shadows`, `thermo-nuclear-code-quality-review`, `interface-review`, `better-*`, `grill-with-docs`, `grill-me`, `grilling`, and `domain-modeling` skills are copies of MIT-licensed skills by their authors; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
