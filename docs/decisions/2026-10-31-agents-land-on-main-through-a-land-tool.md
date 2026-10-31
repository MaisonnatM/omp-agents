---
status: accepted
date: 2026-10-31
decision-makers: user, agent
---

# Agents land on main through a land tool

In the context of agents merging finished work into `main`, facing four sessions that pushed to `main` with `--no-verify` and a pre-push hook that tests the files on disk rather than the pushed commit, we chose a starter-kit `land` tool modeled on Ultimate's lander over a queue in the dashboard server and over keeping the hook as the only gate, to run the checks on the exact merged result before every push, accepting that a landing lives only as long as the session that calls it.

## Context

"Merge on main" merged in the user's main checkout, where their uncommitted work lives, then pushed.
The pre-push hook ran the checks on whatever the working tree held, which is not the pushed commit when the push comes from another worktree, and agents skipped it with `--no-verify`.
Ultimate's lander merges into a detached checkout of the target, runs every configured check, retries a failure once, and is the only way to `main`.

## Options considered

- A starter-kit tool with one temporary worktree per landing, and the non-forced push as the only lock: chosen; it works in terminal sessions without the dashboard and shares nothing between concurrent landings.
- A dashboard-server queue that lands one at a time, as Ultimate does: survives the session ending and could show a queue, but needs the dashboard running and a new server subsystem.
- Keep the pre-push hook as the gate: already there, but agents bypass it and it tests the wrong tree.

## Consequences

Landings use merge commits, as `main`'s history already does, and record the agent's divergence note in the message.
A check that passes only when run again lands with a flaky warning, as in Ultimate.
The pre-push hook keeps its own list of checks, so `.omp/land.json` and the hook must change together.
A session that ends mid-landing leaves no change on `main`, since the push is the last step.

## Confirmation

`templates/omp/land.test.ts` lands through a bare remote and covers the clean, failing, flaky, silent, conflicting, and raced landings and the gate.

## Revisit when

Landings need to outlive their session, or the hook and `land.json` drift apart often enough to make the hook read the file.
