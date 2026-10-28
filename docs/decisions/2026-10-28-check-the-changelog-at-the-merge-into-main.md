---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Check the changelog at the merge into main

In the context of branches merged into a local `main` and then pushed, facing a pre-push hook that refuses a missing `CHANGELOG.md` line only after the merge commit already sits on `main`, we chose a `pre-merge-commit` hook that refuses the merge, over a check script agents must remember to run on the branch and over forcing `--no-ff` merges on `main`.
The line lands on the branch with its change, accepting that a fast-forward or a conflicted merge skips the hook and still meets the check only at the push.

## Options considered

- A script such as `bun run changelog-check` run on the branch before the merge: it covers fast-forwards, but nothing runs it, which is how the late refusals happened.
- `branch.main.mergeOptions=--no-ff` from the `prepare` script, so every merge runs the hook: it would also turn each `git pull` on a behind `main` into a merge commit.
- A `pre-merge-commit` hook that compares the merged index's `CHANGELOG.md` with `main`'s: runs without anyone remembering it, on every merge commit; chosen.

## Confirmation

`src/githooks.test.ts` merges a branch with and without changelog lines into `main`, and `main` into a branch.

## Revisit when

Fast-forward merges into `main` become common, or merges move to GitHub, where no local hook runs.
