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
- adds the [`cursor/plugins`](https://github.com/cursor/plugins) marketplace and installs its `pstack` plugin, unless they are already there.

A file or a setting that you already have keeps your version, and the installer lists it as `keep yours`.
Pass `--force` to overwrite those with the kit's version.
Running the installer again changes nothing that already matches.

The desktop app's **Get started** starter kit step and **Install omp Starter Kit…** menu run this same non-forced installer.
That step's read-only status includes files, settings, marketplace, and plugins; `keep yours` is complete rather than an invitation to overwrite it.
CLI calls use the resolved omp package, including `OMP_PACKAGE_DIR` when set.

Restart running omp sessions to pick up the new files and settings.

## What's inside

Settings, in `config.yml`:

- `modelRoles`: an Anthropic model for every role.
- `retry.fallbackChains`: Codex first, Cursor Composer for cheap roles, and open-weight OpenRouter last, with quota-aware skipping enabled.
  Cursor Grok is opt-in rather than an automatic fallback; existing fallback settings are preserved unless `--force` is used.
- `modelProviderOrder`: the same four providers in the same order.
- `task.isolation`: `isolated: true` subagents work in their own clone of the checkout their `checkout` option names, the session's by default, and successful changes apply back there as a patch.
  At most two subagents run at once.
- `collab.autoStart: control`: every terminal session publishes itself so that the omp-agents dashboard can drive it.

Files, in `agent/`:

- `AGENTS.md`: worktree and force-push safety, plus conditional pointers for model routing, reviews, and decision records.
  Read the matching reference under `~/.omp/agent/docs/` before taking that branch of the workflow, regardless of the repository's working directory.
- `docs/`: `model-routing.md` covers provider order and quota handling, and `review-workflow.md` covers thermonuclear and interface reviews, proof boxes, PR descriptions, and PR screenshots.
  These references load on demand rather than in every session's context.
- `APPEND_SYSTEM.md`: short final replies (Résumé, Action, What next) that end on up to three suggested next prompts, design variants named once and quoted by that name on every surface, questions asked through the ask tool with the recommended option first, and a code-quality review before any pull request, which a repository limits to the files its `.omp/review-paths` globs match.
- `agents/thermonuclear-reviewer.md`: a read-only reviewer that checks the diff against the `CODING_STANDARDS.md` at the root of the checkout it reviews, then runs the thermo-nuclear code quality review on the `plan` role's model.
- `agents/interface-reviewer.md`: a read-only reviewer that runs your `interface-review` skill in full mode on a PR, then applies the `app-consistency-review` skill to check the change reuses the app's shared components and follows its tokens and sibling screens, on the `plan` role's model; it stops naming the missing skill when `interface-review` or `better-interface` is not installed.
- `skills/ship/SKILL.md`, `commands/ship.md`, and `extensions/ship.ts`: `/ship <Linear issue>` drives an issue from ticket to draft PR, interface review, thermonuclear review, and live review.
  The skill holds the procedure and is tagged `workflow` in its `metadata.tags`, so the dashboard's Settings › Workflows lists and edits it; the command only tells the session to follow the skill for the issue it names.
  The extension adds the `ship_stage` tool and shows the stage and the PR's needs in the session.
  When the repository commits `.omp/review-paths`, the gate asks for the thermonuclear checkbox only when a changed file matches one of its globs; a repository without the file reviews every PR.
  The interface review has the opposite default: the gate asks for the `- [x] Interface review` checkbox only when the repository commits `.omp/ui-paths` and a changed file matches one of its globs.
  A branch without a PR gets draft-first recovery instructions; authentication failures retain their actual error.
  When GitHub rejects a token that gh reads from an environment variable, such as `GITHUB_TOKEN` from a project `.env`, while a stored gh login works, this extension and `pr_description` run gh without that variable for the rest of the session, which the agent's own `env -u` cannot do for omp's process.
  When no stored login works, the gate names the rejected credential and the project `.env` file omp read it from at startup, never the token itself.
  A command run through `env` or after `NAME=value` assignments, such as `env -u GITHUB_TOKEN gt submit --publish`, goes through the same gate.
  The gate reads the PR and the review paths in the checkout the publishing command runs in, which a `cd`, `env -C`, `bash -c`, `gt --cwd`, or the bash call's cwd names.
  It refuses the command when that checkout is not one of the PR's repository, such as `gh pr ready 7 -R other/repo` from this repository, when a variable or `cd -` hides the directory, and when the command sets `GH_REPO` or `GH_HOST` inline.
  A PR on a repository you cannot push to, such as a contribution to someone else's project, skips the review gates.
  A PR body with an unchecked `- [ ] Browser proof` box, which a repository's PR template can declare, also blocks going live; the extension checks the box, not a screenshot.
  Dashboard and CLI GitHub calls share separate GraphQL/REST reset cooldowns; exhausted quota is not reported as bad credentials or a fresh successful read, and stale `/ship` status cannot advance a gate.
- `extensions/pr-description.ts`: the essential `pr_description` tool reads and edits descriptions with checked fresh reads, private original backups, and guards against accidental empty output, missing or ambiguous replacement anchors, and concurrent changes observed before the write.
  Use `change: {kind:"append", text:"..."}` or `{kind:"replace-text", oldText:"...", newText:"..."}` for surgical edits; full replacement requires the exact `original` returned by `{kind:"read"}`, and clearing requires `allowEmpty: true`.
  Original descriptions are kept with mode `0600` under `$XDG_CONFIG_HOME/omp-agents/pr-body-backups/`, defaulting to `~/.config/omp-agents/pr-body-backups/`.
  `extensions/github/access.ts` stores only the budget cooldowns under the sibling `github/<credential SHA256>/` directory, never the raw credential, and uses the shared `github/owner-lock.ts` primitive.
- `extensions/cache-tail.ts`: Anthropic caches the tools and system prompt for an hour and the conversation for five minutes.
  A five-minute cache write costs 1.25 times the input price and an hour-long one twice that, and a conversation tail is read again within seconds, so this cuts the write bill without losing the warm head after a pause.
  It also stops cache warming while the session is idle.
  Set `OMP_CACHE_TAIL_TTL=1h` to turn it off.
- `extensions/end-session.ts`: the `end_session` tool, with which an agent ends its own session once its turn is over, and the omp-agents dashboard removes its worktree as **End session** does, so a prompt such as "Merge on main, then end the session" runs to the end.
- `extensions/google-accounts.ts`: when omp is signed in to two or more Gmail or Google Calendar accounts, one MCP server each, tells a session at every prompt each account's server, address, and tool prefix.
  When you linked addresses to the session's workspace in the dashboard's Settings › Integrations, it also tells the session to use those for the workspace's mail and calendar unless you name another account.
  A session in a linked worktree outside every linked workspace takes the links of its repository's main checkout, and no tool is blocked.
- `extensions/headless-mark.ts`: adds an `omp-agents.headless` entry to a session that `omp -p` or `omp --mode json` runs, so the omp-agents dashboard leaves those one-shot runs out of its past sessions.
- `extensions/request-log.ts`: records every request omp sends to a model provider, so any turn can be rebuilt and checked against its hash.
  Each request adds one `omp-request-log.record` entry to the session file with the model, the thinking level, the session's leaf entry, and the hashes of the system prompt, the tools, the other parameters, and the messages.
  Those parts go to omp's blob store in `~/.omp/agent/blobs/`, written once per distinct content, and the messages are stored as edits against the session's previous request, so a turn costs about what it adds.
  `bun ~/.omp/agent/extensions/request-log.ts <session.jsonl>` rebuilds every recorded request and checks its hash, and a request number after the path prints that request's body.
  The record is the body this extension receives, after the extensions that load before it; Anthropic can still withhold a disabled field afterwards, Codex over WebSocket sends only the new input after the first request, and compaction, summary, and title requests are not recorded.
  The blobs hold what the provider received, including your `AGENTS.md` files, environment details, and any secret that reached the conversation, so keep `~/.omp/agent/blobs/` as private as the session files.
- `extensions/session-trailer.ts`: adds an `Omp-Session: <session id>` trailer to every commit an omp session makes, through a config-based `prepare-commit-msg` git hook set in omp's environment, which runs beside a repository's own hooks, husky's included.
  `git log --format='%h %(trailers:key=Omp-Session,valueonly)'` names each commit's session, and `omp -r <session id>` reopens it.
  A git without config-based hooks ignores it.
- `extensions/worktree-guard.ts`: keeps agents from changing a checkout under each other.
  It blocks every `edit` or `write` in a repository's main checkout while it is on its default branch (`origin/HEAD`, else `main` or `master`), and tells the agent to work in a linked worktree; on any other branch the main checkout is edited in place, as `AGENTS.md` asks.
  The omp process that last changed a checkout, a session with its subagents, owns it, and `omp-checkout-owner.json` in the checkout's git dir names its pid.
  While the owner runs and the checkout holds uncommitted changes to tracked files or an unfinished merge or rebase, another session's `edit`, `write`, and git, gt, or `gh pr checkout` commands that change or switch the checkout are blocked, and that session works in a worktree of its own.
  The guard reads commands behind `env` and similar wrappers, in the directory an `env -C` names, and inside `bash -c`, and `git worktree remove` or `move` counts as a change to the worktree it names.
  A file git ignores, such as `.env`, is in no worktree, so its edit there asks the user and goes ahead once approved; a declined edit, or one in a session that cannot ask, stays blocked.
  A clean checkout passes to the next session that changes it, and a session that ends gives up its claims.
  When HEAD is no longer where a session left it, because another process switched the branch, that session's changes there are blocked until a switch it runs as its own command succeeds, back or to the new branch.
  The changes of an `isolated: true` subagent apply to the checkout its spawn names only where an edit could go, so an apply into the main checkout on its default branch, or into another live session's checkout with uncommitted changes, is refused and its patch kept; the agent names a linked worktree as the spawn's `checkout` instead.
  Reads, files outside git, and the clones omp makes for `isolated: true` subagents pass, and a change in a directory that a variable names is blocked until the command writes the directory out.
  If a session's process dies and you know its work is done, delete the claim file it names; the guard also replaces a claim whose process has ended.
- `extensions/todos.ts`: `user_todo` reads the dashboard list and queues add, check, edit, and delete changes; `add` and `edit` take the name of an existing section, and an `add` naming one that does not exist files the todo in none.
  On `add`, an omitted or empty `due` value means no due date, and on `edit` an empty one clears it; a nonempty value must use `YYYY-MM-DD`.
- `extensions/notes.ts`: `user_note` lists and reads the dashboard's notes and queues add/append changes.
  An empty parameter reads as left out, and a session that adds a title it already added gets that note's id back.
- `skills/`: `apple-design`, `emil-design-eng`, and `beautiful-shadows` for interface work; `thermo-nuclear-code-quality-review` for the reviewer; `app-consistency-review`, which the interface reviewer autoloads to check a PR against the app's shared components, tokens, and sibling screens; `decision-records`, which keeps each choice made in a project as one dated file in its `docs/decisions/`, with a `check.ts` that checks them; `ship`, the `/ship` workflow above; and `poteto-mode`, a typeable alias for pstack's `Poteto Mode` skill.
  The alias maps Cursor-only cleanup and runtime-control instructions to omp's available tools without editing the plugin cache.

## Requirements

- omp, on your `PATH` or named by `OMP_PACKAGE_DIR`.
- Accounts for the providers you want to use: Anthropic, OpenAI Codex, Cursor, and OpenRouter.
  omp skips a provider that it cannot reach and uses the next one in the chain.
  Edit `config.yml` before you install to drop a provider, or change the roles later in the dashboard's **Settings**.
- For `/ship`: the [GitHub CLI](https://cli.github.com) signed in, and the Linear MCP server connected to omp.
  [Graphite](https://graphite.dev) is used when a repository is set up for it.
- For `/ship`'s interface review: your own `interface-review` skill, plus the `better-interface` and `better-*` skills it hands off to, under `~/.agents/skills/` or `~/.omp/agent/skills/`.
  The kit does not ship them; a repository without `.omp/ui-paths` never runs the review.

## Maintainer git profile

`bun run omp-template --maintainer` also copies [`maintainer/`](maintainer) on top of the same relative paths.
The profile includes `AGENTS.md` for local-main pushing and worktree cleanup, `docs/git-workflow.md` for draft-first Graphite shipping, `skills/mma-mode/` for maintainer steering, and `skills/best-in-class-approach/`, the quality bar mma-mode stacks for build and review.
Mma-mode resolves poteto by URI and loads only references matching the current task instead of a monolithic contract.
It also includes two scripts, run with `python3 ~/.omp/agent/scripts/<name>`: `prune-git-branches.py`, which with `--apply` removes merged worktrees and local branches whose upstream is gone (a dry run without it), and `session-speed.py`, which compares agent time per prompt before and after a config cutover.
The default install does not copy those files.
`--force` still overwrites a file you already have, including one the profile replaces.

## Customize

The kit is a starting point.
Edit the files here before you install, or edit your own copies afterwards; the dashboard's **Settings** page edits the model routing and every file above in place.
The model ids in `config.yml` are the ones `omp models` listed when the kit was written; replace any that your omp no longer lists.

## Licenses

The kit is MIT-licensed with the rest of the repository.
The `apple-design`, `emil-design-eng`, `beautiful-shadows`, and `thermo-nuclear-code-quality-review` skills are copies of MIT-licensed skills by their authors; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
