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
- `retry.fallbackChains`: per role, OpenAI Codex, then Cursor, then OpenRouter (open-weight models only), with `retry.usageAwareFallback` on so that a plan with no quota left is skipped.
- `modelProviderOrder`: the same four providers in the same order.
- `task.isolation`: subagents work in their own worktree, and successful changes apply back as a patch.
  At most two subagents run at once.
- `collab.autoStart: control`: every terminal session publishes itself so that the omp-agents dashboard can drive it.

Files, in `agent/`:

- `AGENTS.md`: worktree and force-push safety, plus conditional pointers for model routing and reviews.
  Read the matching reference before taking that branch of the workflow.
- `docs/`: `model-routing.md` covers provider order and quota handling, and `review-workflow.md` covers thermonuclear review and PR descriptions.
  These references load on demand rather than in every session's context.
- `APPEND_SYSTEM.md`: final replies in three parts (Résumé, Action, What next), and `isolated: true` for every subagent that touches a git repo.
- `agents/thermonuclear-reviewer.md`: a read-only reviewer that runs the thermo-nuclear code quality review on the `plan` role's model.
- `commands/ship.md` and `extensions/ship.ts`: `/ship <Linear issue>` drives an issue from ticket to draft PR, thermonuclear review, and live review.
  The extension adds the `ship_stage` tool and shows the stage and the PR's needs in the session.
- `extensions/cache-tail.ts`: Anthropic caches the tools and system prompt for an hour and the conversation for five minutes.
  A five-minute cache write costs 1.25 times the input price and an hour-long one twice that, and a conversation tail is read again within seconds, so this cuts the write bill without losing the warm head after a pause.
  It also stops cache warming while the session is idle.
  Set `OMP_CACHE_TAIL_TTL=1h` to turn it off.
- `extensions/end-session.ts`: the `end_session` tool, with which an agent ends its own session once its turn is over and, with `removeWorktree`, has the omp-agents dashboard remove its worktree, so a prompt such as "Merge on main, delete the worktree, then end the session" runs to the end.
- `extensions/worktree-guard.ts`: holds back a session's first `edit` or `write` in a repository's main checkout and tells the agent to work in a linked worktree; trying the same call again goes through, for when you asked it to work in place.
- `skills/`: `apple-design`, `emil-design-eng`, and `beautiful-shadows` for interface work; `thermo-nuclear-code-quality-review` for the reviewer; and `poteto-mode`, a typeable alias for pstack's `Poteto Mode` skill.

## Requirements

- omp, on your `PATH`.
- Accounts for the providers you want to use: Anthropic, OpenAI Codex, Cursor, and OpenRouter.
  omp skips a provider that it cannot reach and uses the next one in the chain.
  Edit `config.yml` before you install to drop a provider, or change the roles later in the dashboard's **Settings**.
- For `/ship`: the [GitHub CLI](https://cli.github.com) signed in, and the Linear MCP server connected to omp.
  [Graphite](https://graphite.dev) is used when a repository is set up for it.

## Maintainer git profile

`bun run omp-template --maintainer` also copies [`maintainer/`](maintainer) on top of the same relative paths.
That copy is `AGENTS.md`, which tells a session to push local `main` and to clean up worktrees, and `docs/git-workflow.md`, which registers Graphite branches.
The default install does not copy those files.
`--force` still overwrites a file you already have, including one the profile replaces.

## Customize

The kit is a starting point.
Edit the files here before you install, or edit your own copies afterwards; the dashboard's **Settings** page edits the model routing and every file above in place.
The model ids in `config.yml` are the ones `omp models` listed when the kit was written; replace any that your omp no longer lists.

## Licenses

The kit is MIT-licensed with the rest of the repository.
The `apple-design`, `emil-design-eng`, `beautiful-shadows`, and `thermo-nuclear-code-quality-review` skills are copies of MIT-licensed skills by their authors; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
