---
status: accepted
date: 2026-11-04
decision-makers: agent
---

# Command routines can post only their failures

In the context of command routines, facing a cold model turn, about $0.35, on every run only to read a command that exited 0, we chose an opt-in `post: "failures"` on a command task that skips the post when the command exits 0, over appending the output to the conversation without a turn and over never posting a command's output.
It keeps a successful run's output on the run and in the routine's open row at no model cost, accepting that the Bot's conversation no longer shows those successes.

## Context

A command routine posts its report through `Bots.message`, which resumes the Bot's session and prompts it.
omp has no way to add a message to a session without starting a turn, so every post costs a turn.

## Options considered

- Append the output without a turn: not possible through `Bots.message`, and omp offers no turn-less append.
- Never post command output: loses the failures the Bot should act on.
- Post only when the command does not exit 0, per routine: chosen; a routine without `post` posts every run as before.

## Consequences

A non-zero exit, a stop at the time limit or with the dashboard, and a failure to start still post.
A successful run writes its outcome as before and is not held for a full wake.

## Confirmation

`src/server/routine-runner.test.ts` checks that with `post: "failures"` a run that exits 0 posts nothing and keeps its output, and one that exits non-zero posts; `src/routines.test.ts` checks the field round-trips and another value is refused.

## Revisit when

omp gains a way to append to a session without prompting it.
