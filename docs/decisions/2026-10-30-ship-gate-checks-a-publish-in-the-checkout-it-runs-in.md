---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# The ship gate checks a publish in the checkout it runs in

In the context of the ship extension's publish gate, facing a `cd ~/code/yampa && gh pr ready 7107` that the gate read in the session's checkout of omp-agents, we chose to place each command with the `located` walk the worktree guard already used, now in `shell/commands.ts`, and to refuse a publish whose checkout gh does not resolve to the PR's repository, over requiring the bash call's cwd and refusing any `cd`, and over reading the review paths from GitHub.
One walk gives the command and both guards the same directory, and the commonest shape, `cd <dir> && gh pr ready`, still passes the first time.
We accept that the walk keeps its known gaps: a `cd` inside `( )`, a pipeline, or `&` still moves the directory it reports, though the shell drops it.

## Options considered

- Require the bash call's cwd and refuse a publish line holding a `cd`: the simplest rule, but agents write `cd <dir> && ...` by habit, so most publishes would fail once before they pass.
- Read `.omp/review-paths` from the PR's base branch through the GitHub API: the policy's source would then be the PR's repository whatever the checkout, and a PR could not weaken its own gate, but it adds a REST read per policy file and still needs the checkout to find the PR of a `gt submit --publish`.
- Place the command with `located` and check that gh resolves its checkout to the PR's repository, host included: chosen.

## Consequences

`gh pr ready 7 -R other/repo` from this repository is refused with the directory to run it from, where it used to pass ungated because the owners differed.
A publish whose directory comes from a variable, a command substitution, or `cd -` is refused, as the worktree guard already refuses such a git command.
A command setting `GH_REPO` or `GH_HOST` inline is refused, since the gate's own gh reads would not see the assignment.
In a fork whose gh default is the upstream repository, the gate reads the fork's working tree as the upstream's policy; gh's own choice of repository is the contract, not the remote the files came from.

## Confirmation

The `ship publication gate` tests in `templates/omp/extensions.test.ts` cover a publish through `cd`, `env -C`, `bash -c`, `gt --cwd`, and the bash call's cwd, a linked worktree whose review paths differ from its main checkout's, an explicit `-R` before and after `ready`, a PR URL, another host, and the refused unlocated and `GH_REPO` forms.

## Revisit when

Revisit when a repository keeps a review policy on a fork that differs from its upstream's, or when publishes from subshells show up in sessions; then read the policy from the PR's base branch or track shell scopes in `located`.
