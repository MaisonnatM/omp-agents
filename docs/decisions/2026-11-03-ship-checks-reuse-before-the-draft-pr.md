---
status: accepted
date: 2026-11-03
decision-makers: Maxence Maisonnat
---

# /ship checks for reuse in the plan and for duplication before the draft PR

In the context of the starter kit's `/ship` workflow, facing large PRs that rebuild what the repository already has, we chose a reuse list in every plan, scored by the arena, plus a duplication pass by a fresh `poteto-agent-codex` in the Implement stage when a change adds more than about 500 hand-written lines, over a second minimal implementation of every change and over leaving it to the Thermonuclear stage.
It catches duplication before reviewers see the diff, accepting one extra agent run and one extra test run on large changes.

## Context

Measured commit by commit on 11 yampa PRs that passed the Thermonuclear stage, tests and generated files made up 30 to 70 percent of the large PRs' added lines, and most PRs added 100 to 500 lines.
The excess thermonuclear found was duplication: API schemas copying domain models, two enums for one concept, one table row chassis pasted five times, a fetch a parent layout already made.
Its fix commits removed that code but added replacements, so a large PR's size moved little, for example +668/-635 on #7193 and +770/-830 on #7140.

## Options considered

- A second implementation of every change aimed at fewer lines: doubles implementing and verifying, and a line target invites dense code and dropped edge cases.
- Leave it to the Thermonuclear stage: it already finds the duplication, but only after the draft PR, on a diff it then patches.
- A reuse list in the plan and a duplication pass on large changes before the draft PR: chosen.

## Consequences

Each plan names the helpers, components, models, and patterns it extends, by path, and the arena's rubric scores that list.
The duplication pass keeps its edits only when the same tests pass and the diff shrinks or loses a concept, and the report says whether they were kept.
The 500-line threshold is a guess from the measured PRs and excludes tests and generated files.

## Confirmation

The Plan and Implement steps of `templates/omp/agent/skills/ship/SKILL.md` name the reuse list and the duplication pass.

## Revisit when

Thermonuclear findings on PRs that ran the pass still name duplicated models, components, or fetches, or the pass's edits are discarded more often than kept.
