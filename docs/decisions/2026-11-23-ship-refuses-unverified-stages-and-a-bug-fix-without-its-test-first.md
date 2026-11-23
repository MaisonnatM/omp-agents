---
status: accepted
date: 2026-11-23
decision-makers: Maxence Maisonnat
---

# /ship refuses unverified stages and a bug fix without its test first

In the context of the starter kit's `/ship` workflow, facing agents that report a change verified without running anything since their last edit, and bug fixes whose test was written after the fix, we chose two refusals in `ship_stage`, over instructions alone and over a generic `land` check.
`draft_pr` and `ready_gate` need a test, typecheck, or lint bash call that exited 0 in the session after its last edit, write, or subagent; with a contract's `test_first`, `draft_pr` needs a branch commit changing only that test before the first commit changing code.

## Context

The skill already told agents to run the checks before the draft PR and to name `test_first` in the contract, and nothing enforced either.
A `land` check would refuse features in this repository too, since omp-agents lands features with no failing test to write first.

## Options considered

- Keep the instructions alone: they were already there.
- A `land` check on test-first order: runs for every landing, bug fix or not.
- Refusals in `ship_stage`, read from the session's own tool calls and the branch's commits: chosen.

## Consequences

A subagent's own test run does not count, so the parent session runs the checks once after integrating, as the Implement step already said.
Any `task` call, even a read-only one, counts as a possible edit, so the checks run again after the reviews before `ready_gate`.
A check run with `async`, or one whose failure a pipe hides, does not prove a pass; the first is refused, the second is not seen.
`test_first` is the only bug signal; a bug fix planned with `test_first: null` passes.

## Confirmation

`templates/omp/ship-verify.test.ts` tests both refusals.

## Revisit when

Agents start wrapping commands to look like checks, or the refusal blocks repositories whose checks it does not recognize.
