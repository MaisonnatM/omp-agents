---
status: accepted
date: 2026-11-23
decision-makers: Maxence Maisonnat
---

# yampa eval tasks are Linear tickets checked by their pull requests' tests

In the context of evaluating the harness on yampa, whose history has no `Land` merges and whose pull requests describe the change they make, facing prompts that would hand an agent the solution, we chose merged pull requests that name one Linear ticket, with the ticket's own text as the prompt and the pull request's test files as the hidden check, kept outside this repository, over the pull request's body as the prompt and over a committed set.
A run passes when the pull request's tests pass on the agent's change, accepting that the calling session must fetch the tickets from Linear, and that a correct change can still fail a test that pins a name or a detail the ticket does not say.

## Context

`scripts/evals/candidates.ts` builds the omp-agents set from `Land` merges and their commit messages; yampa squash-merges pull requests, so a pull request is its unit of work.
A yampa pull request's body says what changed and why, often with a `diff` block, and the review bot's summary names the tests it added.
Its Linear ticket says what was needed, before anyone wrote the change.
yampa's tests need Postgres, which `docker compose` runs for its CI and its developers.

## Options considered

- The pull request's title and body as the prompt: leaks the approach and sometimes the code.
- The Linear ticket fetched by the script: a script has no Linear access, only the session's tool has.
- The Linear ticket from a file the session fills, with the body's first section as a fallback that the script reports: chosen.
- Committing the set beside `scripts/evals/tasks.json`: puts yampa's ticket text, security findings included, in this repository.
- Keeping it in `~/.cache/omp-evalset/`: chosen.

## Consequences

A ticket that several merged pull requests name is left out, since its text asks for more than any one of them did.
A prompt that names a hidden test, a hidden file, or the pull request is dropped, and the next pick takes its place.
The check runs pytest against the main checkout's Postgres container with its own `test_db_evals` database, after omp exits and outside the sandbox.
`run.ts` reads each task's `repo`, so one runner replays both repositories, and its summary prints pass@1 and pass@3.

## Confirmation

`scripts/evals/pull-candidates.test.ts` covers the selection filter, the base of squash, merge, and rebase merges, the node id extraction, the leak check, and the pass@k math; `--verify` keeps a task only when its check fails at the base and passes at the merge commit.

## Revisit when

yampa's newest task is a month old, or most runs pass, so the set no longer tells harness changes apart.
