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

Restart running omp sessions to pick up the new files and settings.

## What's inside

Settings, in `config.yml`:

- `modelRoles`: an Anthropic model for every role.
- `retry.fallbackChains`: Codex first, Cursor Composer for cheap roles, and open-weight OpenRouter last, with quota-aware skipping enabled.
  Cursor Grok is opt-in rather than an automatic fallback; existing fallback settings are preserved unless `--force` is used.
- `modelProviderOrder`: the same four providers in the same order.
- `task.isolation`: `isolated: true` subagents work in their own clone, and successful changes apply back as a patch.
  At most two subagents run at once.
- `collab.autoStart: control`: every terminal session publishes itself so that the omp-agents dashboard can drive it.

Files, in `agent/`:

- `AGENTS.md`: worktree and force-push safety, plus conditional pointers for model routing and reviews.
  Read the matching reference under `~/.omp/agent/docs/` before taking that branch of the workflow, regardless of the repository's working directory.
- `docs/`: `model-routing.md` covers provider order and quota handling, and `review-workflow.md` covers thermonuclear review, proof boxes, PR descriptions, and PR screenshots.
  These references load on demand rather than in every session's context.
- `APPEND_SYSTEM.md`: short final replies (Résumé, Action, Then) that end on up to three suggested next prompts, questions asked through the ask tool with the recommended option first, and a code-quality review before any pull request.
- `agents/thermonuclear-reviewer.md`: a read-only reviewer that runs the thermo-nuclear code quality review on the `plan` role's model.
- `commands/ship.md` and `extensions/ship.ts`: `/ship <Linear issue>` drives an issue from ticket to draft PR, thermonuclear review, and live review.
  The extension adds the `ship_stage` tool and shows the stage and the PR's needs in the session.
  A branch without a PR gets draft-first recovery instructions; authentication failures retain their actual error.
  `gh pr ready` on a repository whose owner differs from the cwd repository's, such as a contribution to someone else's project, skips the thermonuclear gate.
  A PR body with an unchecked `- [ ] Browser proof` box, which a repository's PR template can declare, also blocks going live; the extension checks the box, not a screenshot.
- `extensions/cache-tail.ts`: Anthropic caches the tools and system prompt for an hour and the conversation for five minutes.
  A five-minute cache write costs 1.25 times the input price and an hour-long one twice that, and a conversation tail is read again within seconds, so this cuts the write bill without losing the warm head after a pause.
  It also stops cache warming while the session is idle.
  Set `OMP_CACHE_TAIL_TTL=1h` to turn it off.
- `extensions/end-session.ts`: the `end_session` tool, with which an agent ends its own session once its turn is over, and the omp-agents dashboard removes its worktree as **End session** does, so a prompt such as "Merge on main, then end the session" runs to the end.
- `extensions/google-accounts.ts`: when omp is signed in to two or more Gmail or Google Calendar accounts, one MCP server each, tells a session at every prompt each account's server, address, and tool prefix.
  When you linked addresses to the session's workspace in the dashboard's Settings › Integrations, it also tells the session to use those for the workspace's mail and calendar unless you name another account.
  A session in a linked worktree outside every linked workspace takes the links of its repository's main checkout, and no tool is blocked.
- `extensions/projects.ts`: tells a session that belongs to an omp-agents project its role, coordinator or worker, and where the project's shared notes are, at every prompt.
  A coordinator's `edit` and `write` calls outside the notes are blocked, so it delegates every code change to a worker.
  The dashboard loads this file from the repository with `-e` while it is not installed, so projects work before you run `bun run omp-template`.
- `extensions/request-log.ts`: records every request omp sends to a model provider, so any turn can be rebuilt and checked against its hash.
  Each request adds one `omp-request-log.record` entry to the session file with the model, the thinking level, the session's leaf entry, and the hashes of the system prompt, the tools, the other parameters, and the messages.
  Those parts go to omp's blob store in `~/.omp/agent/blobs/`, written once per distinct content, and the messages are stored as edits against the session's previous request, so a turn costs about what it adds.
  `bun ~/.omp/agent/extensions/request-log.ts <session.jsonl>` rebuilds every recorded request and checks its hash, and a request number after the path prints that request's body.
  The record is the body this extension receives, after the extensions that load before it; Anthropic can still withhold a disabled field afterwards, Codex over WebSocket sends only the new input after the first request, and compaction, summary, and title requests are not recorded.
  The blobs hold what the provider received, including your `AGENTS.md` files, environment details, and any secret that reached the conversation, so keep `~/.omp/agent/blobs/` as private as the session files.
- `extensions/worktree-guard.ts`: blocks every `edit` or `write` in a repository's main checkout while it is on its default branch (`origin/HEAD`, else `main` or `master`), and tells the agent to work in a linked worktree.
  On any other branch the main checkout is edited in place, as `AGENTS.md` asks, and the clones omp makes for `isolated: true` subagents pass too.
- `extensions/todos.ts`: `user_todo` reads the dashboard list and queues add/check changes.
  An omitted or empty `due` value means no due date; a nonempty value must use `YYYY-MM-DD`.
- `skills/`: `apple-design`, `emil-design-eng`, and `beautiful-shadows` for interface work; `thermo-nuclear-code-quality-review` for the reviewer; and `poteto-mode`, a typeable alias for pstack's `Poteto Mode` skill.
  The alias maps Cursor-only cleanup and runtime-control instructions to omp's available tools without editing the plugin cache.

## Requirements

- omp, on your `PATH`.
- Accounts for the providers you want to use: Anthropic, OpenAI Codex, Cursor, and OpenRouter.
  omp skips a provider that it cannot reach and uses the next one in the chain.
  Edit `config.yml` before you install to drop a provider, or change the roles later in the dashboard's **Settings**.
- For `/ship`: the [GitHub CLI](https://cli.github.com) signed in, and the Linear MCP server connected to omp.
  [Graphite](https://graphite.dev) is used when a repository is set up for it.

## Maintainer git profile

`bun run omp-template --maintainer` also copies [`maintainer/`](maintainer) on top of the same relative paths.
The profile includes `AGENTS.md` for local-main pushing and worktree cleanup, `docs/git-workflow.md` for draft-first Graphite shipping, and `skills/mma-mode/` for maintainer steering.
Mma-mode resolves poteto by URI and loads only references matching the current task instead of a monolithic contract.
The default install does not copy those files.
`--force` still overwrites a file you already have, including one the profile replaces.

## Customize

The kit is a starting point.
Edit the files here before you install, or edit your own copies afterwards; the dashboard's **Settings** page edits the model routing and every file above in place.
The model ids in `config.yml` are the ones `omp models` listed when the kit was written; replace any that your omp no longer lists.

## Licenses

The kit is MIT-licensed with the rest of the repository.
The `apple-design`, `emil-design-eng`, `beautiful-shadows`, and `thermo-nuclear-code-quality-review` skills are copies of MIT-licensed skills by their authors; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
