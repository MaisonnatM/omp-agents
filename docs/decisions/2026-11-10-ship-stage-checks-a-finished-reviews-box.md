---
status: accepted
date: 2026-11-10
decision-makers: Maxence Maisonnat
---

# ship_stage checks a finished review's box instead of refusing the next stage

In the context of `/ship`'s review stages, facing runs that stopped at `thermonuclear` or `ready_gate` because the agent had not yet ticked `- [x] Interface review` or `- [x] Thermo-nuclear code quality review` in the PR body, we chose to have `ship_stage` tick the box, or append it, when it records the stage after the review, over refusing the stage as [the interface review record](2026-10-28-ship-gates-ui-changes-on-an-interface-review-before-thermonuclear.md) has it, and over polling GitHub again after the agent edits the body.
Recording the next stage is the agent's statement that the review finished, so the box no longer needs a second step, accepting that the stage now writes the PR body, through the same checked edit as `pr_description`, and that an unreadable body still refuses the stage.

## Consequences

The publish gate still blocks `gh pr ready` on a missing box, so a PR cannot go live without the reviews.
Recording `live` or live work while the PR is a draft records nothing and names the next step instead of failing, since `gh pr ready` records `live` itself once it succeeds.

## Confirmation

`templates/omp/extensions.test.ts` checks that recording `thermonuclear` or `ready_gate` ticks a template box in place, appends a missing one, writes nothing when the box is there, and refuses the stage when the body cannot be read.
