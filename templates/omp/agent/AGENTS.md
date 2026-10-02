# OMP user context

Applies to every omp session on this machine.

## Always work in a worktree

In any git repo, create a dedicated git worktree (new branch off the current
default/parent branch) before making changes, and do all edits, checks, and
commits there, not in the main checkout. Prefer `gt create` / `git worktree add`
from the outset so the branch is Graphite-registered (see below). Skip the
worktree only when the user explicitly says not to (e.g. "work in place",
"no worktree"); read-only investigation needs none. Reuse an existing worktree
for the same task rather than creating another. Subagent spawns still use
`isolated: true`; that is separate from the session's own worktree.

## Merging into main means pushing it

When you merge or commit a branch into `main` locally, run `git push origin main`
right after, then confirm `git status -sb` shows `main...origin/main` with no
ahead count. Never leave a local `main` ahead of `origin`. This does not apply
to force-pushes or to rewriting `main`'s history, which still need explicit
approval.

## Worktree audit

`task.isolation.merge: patch` applies successful isolated work; interrupted or
failed spawns can leave workspaces behind. At the start of any session in a git
repo, run `git worktree list`; if it has more than 5 entries beyond the main
checkout, run poteto-mode's **worktree-cleanup** playbook unprompted and report
the findings before other work. Never delete by age alone. Pause on `wip`,
open PRs, pinned chats, or in-use worktrees.

## Graphite registration for every branch/PR

Graphite (`gt`) never auto-discovers work: a branch pushed and opened as a PR
via plain `git`/`gh pr create` stays invisible to `gt log`, `gt state`, and
the `app.graphite.com` dashboard until it is explicitly registered.

Whenever a repo uses `gt` (check for `.git/.graphite_repo_config`), register
every branch that gets an open PR, immediately after creating it or noticing
an untracked one:

```bash
gt track <branch> -p <parent-branch> --no-interactive -q   # local tracking metadata
gt submit --cwd <worktree-or-repo-path> --no-edit --no-stack -q  # push metadata to Graphite's servers
```

`gt submit` on a branch already in sync with its remote (compare
`git rev-parse <branch>` vs `git rev-parse origin/<branch>`) never force-pushes
or creates a duplicate PR — it only attaches the existing PR to Graphite. If
the branch has no dedicated worktree and the current worktree is dirty, use a
throwaway `git worktree add /tmp/... <branch>` for the submit, then
`git worktree remove -f` it; never `git checkout` over uncommitted changes.

## Model roles — Anthropic, then OpenAI, then Cursor, then OpenRouter

Roles are set in `~/.omp/agent/config.yml` under `modelRoles`. Fallbacks are
`retry.fallbackChains`, one ordered list per role. `omp usage` reports what is
left per account; `omp models --json` lists selectable `provider/modelId`
selectors (a slug outside that set breaks every delegation that reads the role).

Provider order is fixed:

1. Anthropic — every role primary.
2. OpenAI Codex — first fallback.
3. Cursor — second fallback.
4. OpenRouter — last fallback. Open-weight models only (no Anthropic, OpenAI, Google, or xAI proxies).

`retry.usageAwareFallback` stays on, with `retry.usageReservePct: 0` and
`usageReservePolicy: auto`. The first three providers are coding-plan quota, so
any plan with quota left is used before OpenRouter; only a plan already
reporting 0 left is skipped, and a plain API key or unknown usage stays
eligible. `modelProviderOrder` mirrors the same four providers. OpenRouter is
metered and does not run dry, so it stays last. Keep `smol`, `tiny`, and
`commit` cheap. A `:level` suffix overrides the failing turn; a bare entry
keeps it.

Apply a role change with `omp config set modelRoles '<json>'` and a chain
change with `omp config set retry.fallbackChains '<json>'`. Read back with
`omp config get`. Re-check `omp usage` at the start of a long session.

When a provider is dry, skip it and take the next entry in the same role's
chain. Never point a primary or a fallback at a provider with no quota, and
never reorder a chain so Cursor or OpenRouter comes before Anthropic or Codex.

## Who consumes each role

- `default` — the session model, memory phase 1, and `security-reviewer`.
- `smol` — `scout` and `sonic`, memory phase 2, prewalk target.
- `slow` — `reviewer`.
- `task` — the bundled `task` agent.
- `plan` — plan mode and `thermonuclear-reviewer`.
- `advisor` / `vision` / `commit` / `tiny` — advisor runtime, image turns, commit messages, titles/memory/auto-thinking.

## Thermonuclear review always runs on the `plan` role

When the user asks for a thermo-nuclear code quality review ("thermonuclear
review", deep code quality audit), do NOT run the skill in the session model.
Spawn `task` with `agent: "thermonuclear-reviewer"` (frontmatter
`model: "@plan"`, so it follows `modelRoles.plan` and its fallback chain on any
provider), pass the review scope and user args, then relay its findings
verbatim.

When the review targets a PR: after the fixes are committed and pushed, add a
checked checkbox line to the PR description (`gh pr edit <N> --body-file …`
from the current body, not a blind overwrite):
`- [x] Thermo-nuclear code quality review`. Append it under an existing
checklist if the body has one, else add a `## Checks` section at the end. If
the line already exists, do nothing. Never add it before the push lands, and
never for a review that was only run, not applied.

## PR bodies: no markdown tables

Never use a markdown pipe table (`| a | b |`) in a PR body. GitHub renders a
`<table>` inside a PR description shrink-wrapped to its content, so it reads
narrower than the surrounding prose and code blocks. For a before/after
comparison, use `**Before:** ... **After:** ...` bullets or an aligned
` ```text ` block instead.
