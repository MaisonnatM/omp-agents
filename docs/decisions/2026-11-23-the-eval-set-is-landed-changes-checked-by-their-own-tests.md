---
status: accepted
date: 2026-11-23
decision-makers: Maxence Maisonnat
---

# The eval set is landed changes checked by their own tests

In the context of judging harness changes, such as an extension, a skill, or a model, on real work, facing no task-level quality score, we chose 20 `Land` merges of this repository whose landing brought `bun test` files, each replayed from its base with its commit messages as the prompt and checked by those tests, over judge-model verdicts and over hand-written tasks.
A run passes only when the landed tests pass on the agent's change, accepting that the prompt is the author's commit messages rather than the request the agent first got, and that a correct change can still fail a test that pins details the messages do not say.

## Context

`scripts/token-audit/model-replay.ts` already replayed worker prompts in a confined clone and priced them, but it scored a replay by the repository's whole land checks and a judge's verdict, not by whether the task was done.
Landed merges carry their own proof: the tests they added or changed fail before them and pass after.

## Options considered

- Judge-model verdicts on each run's diff: costly per run and noisy across runs.
- Hand-written tasks with hand-written checks: few, and not the work agents do here.
- Landed merges with their own tests as the hidden check, verified to fail at the base and pass at the landing: chosen.

## Consequences

The prompt lists each import a hidden test makes of a name the base lacks, so a run is not failed for naming a new export differently.
Runs reuse the replay helpers, now in `scripts/evals/replay.ts`, with the full harness loaded instead of `model-replay.ts`'s bare one.
The decay check turns one component off through omp's own `disabledExtensions` setting rather than a second loading mechanism.
`XDG_CONFIG_HOME` points at each run's folder, so the kit's extensions keep their state, such as the ship trace, out of the user's files.

## Confirmation

`scripts/evals/evals.test.ts` covers the import detection, the prompt, the decay summary, and the committed set's shape; `bun scripts/evals/run.ts --dry-run` applies each landed change in place of an agent and must pass every task.

## Revisit when

The set's newest task is a month old, or most runs pass, so the set no longer tells harness changes apart.
