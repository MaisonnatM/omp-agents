---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# /ship plans through an arena of up to three approaches before it implements

In the context of the starter kit's `/ship` workflow, facing implementations that lock in the first approach the implementing agent thinks of, we chose a Plan stage between Ticket and Implement that runs the `arena` skill with one runner per sound approach, up to three, each writing its plan with the `technical-writing` skill, and posts the chosen plan on the Linear issue, over planning inside the Implement stage and over an arena on every issue.
It lets the implementing agent build from a plan picked against its alternatives, accepting up to three extra read-only agent runs and a cross-judge on each issue that admits more than one approach.

## Context

The Implement stage handed the issue straight to one `poteto-agent`, so whatever shape it chose first was the shape the PR shipped.
The user asked for three ways to build each issue, written to the `technical-writing` skill, compared through an arena, with the best one kept, when the issue allows more than one way.
A resumed `/ship` run reads the Linear issue, so the plan must live where that run finds it.

## Options considered

- Plan inside the Implement stage: no new stage, but the widget and a resumed run cannot tell planning from building, and nothing records the plan.
- Run the arena on every issue: three plans for a typo cost more than the typo.
- A Plan stage that runs the arena only when two or more approaches are sound, and otherwise writes the one plan directly: chosen.
- Keep the plan in a file in the checkout: a resumed run finds it, but reviewers on Linear do not, and the file risks being committed.

## Consequences

`STAGES` in `templates/omp/agent/extensions/ship.ts` and `SHIP_STAGES` in `src/shared/sessions.ts` gain `plan` after `ticket`; the Ship card and the terminal widget show nine steps.
The terminal widget splits its two rows at the first review stage rather than at a fixed index, so a stage added before the reviews keeps the PR stages on the second row.
A session whose agent recorded `ticket` before this change is told to record `plan` next, and a session already past `ticket` keeps its stage.
The `ship_stage` tool does not check that a plan exists before `implement`; the skill asks for the Linear comment, and a resumed run reuses it.
Arena runners only read the checkout, so they run without `isolated`.

## Confirmation

`renderLines` in `templates/omp/agent/extensions/ship.ts` draws Plan on the first row of the terminal widget, before Implement and Draft PR.
The Plan step of `templates/omp/agent/skills/ship/SKILL.md` names the arena, the `technical-writing` skill, and the Linear comment.

## Revisit when

Plans picked by the arena turn out no better than the implementing agent's first approach, or the cost of three runners per issue outweighs the rework they save.
