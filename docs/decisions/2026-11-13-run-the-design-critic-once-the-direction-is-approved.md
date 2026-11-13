---
status: accepted
date: 2026-11-13
decision-makers: Maxence
supersedes: 2026-11-04-send-every-ui-change-through-a-workflow-with-a-separate-critic
---

# Run the design critic once the direction is approved

In the context of the design workflow, facing UI requests that took about 25 minutes each because the `design-critic` ran on every round, we chose a builder screenshot check on each round and one critique once the user approves the direction, over a critic on every round and over moving every check to the end.
Rounds come back in minutes, and the critic still measures the version that ships, accepting that the user may spot layout bugs on rounds before approval that the builder's own check missed.

## Context

The 2026-11-04 record put a separate critic on every UI change, up to two runs, because builders excused their own layout bugs.
Session logs from 2026-11-06 to 2026-11-13 showed 56 requests with a design critic at a typical 25 minutes and 53 main-agent steps, against 0.6 minutes and 4 steps for a plain request.
Many rounds were tweaks the user later replaced, so their critiques bought nothing.
The code-quality and interface reviews already wait for direction approval, in `/ship` and in the kit's pull request rule.

## Options considered

- Critic on every round: catches bugs before the user sees any round, and costs about 25 minutes per round, discarded rounds included.
- No check until approval: fastest rounds, and brings back the 2026-11-04 failure where the user finds layout bugs himself on every round.

## Consequences

Each round costs a few screenshots the builder reads beside a sibling screen.
The critic runs once per approved direction, up to two runs, before the interface review in `/ship`.
The builder's check misses more than the critic, so pre-approval rounds can show bugs the critic would have caught.

## Revisit when

Revisit when the user reports layout bugs on rounds before approval in more than a few sessions, or when the final critique keeps reopening the direction the user approved.
