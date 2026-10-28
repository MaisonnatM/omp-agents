---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# /ship gates UI changes on an interface review, path-gated by .omp/ui-paths and run before thermonuclear

In the context of the starter kit's `/ship` workflow, facing UI changes that reach review without a consistency pass, we chose an Interface review stage that runs the user's own `interface-review` skill only when the repository commits `.omp/ui-paths` and a changed file matches it, placed before the Thermonuclear stage and proven by a `- [x] Interface review` box the ship extension requires, over a review on every PR and over folding UI checks into the thermonuclear review.
It keeps repositories without UI, and users without the skills, unaffected, accepting that the kit depends on skills it does not ship.

## Context

The thermonuclear review checks code quality, not whether an interface is consistent with the rest of the product.
The user keeps an `interface-review` skill that hands off to `better-interface` and the `better-*` skills, and those live outside the kit.
`ship.ts` hard-coded one review, its box, and its paths file, so a second review would have doubled every conditional.

## Options considered

- Fold UI checks into the thermonuclear review: one stage, but the rubric is a code-quality one and the user's UI skills would not run.
- Run the interface review on every PR, the thermonuclear default: no setup, but it blocks repositories with no interface and users without the skills.
- Path-gate it on `.omp/ui-paths`, needed only when the file exists and a changed file matches: opt-in per repository; chosen.
- Run it after thermonuclear: the code-quality review would miss the code the interface fixes add.

## Consequences

`ship.ts` keeps a `REVIEWS` registry keyed by the stage that runs each review, and the publish gate, the widget, and the `ship_stage` gates loop over it, so a later review is one entry.
Recording `thermonuclear` or `ready_gate` is refused while a needed interface box is missing.
With `.omp/ui-paths` committed, a change list GitHub cut short counts as needing the review, as it does for thermonuclear.
The interface review waits for the user's go on the direction, like thermonuclear, since its findings can redesign the UI.
The `interface-reviewer` agent reports a missing `interface-review` or `better-interface` skill and stops rather than improvising a review.

## Confirmation

`templates/omp/ship.test.ts` checks when each review is needed and that the publish gate blocks on the interface box first.
`templates/omp/extensions.test.ts` checks that `gh pr ready` and recording `thermonuclear` or `ready_gate` are refused without the box when `.omp/ui-paths` matches, and pass without the file.

## Revisit when

The kit ships its own interface review skills, so the review could default on like thermonuclear.
