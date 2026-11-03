---
status: accepted
date: 2026-11-03
decision-makers: Maxence Maisonnat
---

# The Browser proof box blocks publishing only when the interface review applies

In the context of the `/ship` publish gate, facing an unchecked `- [ ] Browser proof` box from a repository's PR template that blocked every PR, including ones with no page to prove, we chose to block on that box only while the interface review is needed, over always blocking and over matching the box's own wording.
A PR that changes no interface goes live without editing its template, accepting that a repository without `.omp/ui-paths` never has the box enforced.

## Context

The Nov 3 retro found the gate forbidding the unchecked box on every PR, so a PR that changed no interface had to delete the template's line before it could go live.
The kit already decides whether a PR changes the interface: `reviewNeeded` reads `.omp/ui-paths` for the interface review.

## Options considered

- Always block on the unchecked box: the old behavior, which made agents edit the template away on PRs it did not concern.
- Parse the box's own text, such as "UI changes", for the paths it means: every template words it differently.
- Block only while the interface review is needed, the same `.omp/ui-paths` match: chosen.

## Consequences

A repository that wants the box enforced commits `.omp/ui-paths`; yampa, whose template declares the box, commits none yet.
When GitHub lists fewer changed files than the PR has, the interface review counts as needed, so the box blocks.

## Confirmation

`templates/omp/ship.test.ts` checks the box blocks a PR changing a file the ui paths match, and lets through one without ui paths or without a matching file; `templates/omp/extensions.test.ts` checks the same through `gh pr ready`.

## Revisit when

A repository needs the box enforced on changes its ui paths do not describe.
