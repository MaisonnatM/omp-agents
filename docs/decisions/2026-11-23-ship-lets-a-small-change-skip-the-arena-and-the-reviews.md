---
status: accepted
date: 2026-11-23
decision-makers: Maxence Maisonnat
---

# /ship lets a small change skip the arena and the reviews

In the context of the starter kit's `/ship` workflow, facing one-line fixes that paid for an arena, a critic, and two reviews, we chose a fast path that `ship_stage` checks against the PR's size on GitHub, over a skip the agent may claim on its own word and over making small PRs need no review at all.
A PR is small when GitHub lists every changed file with its line count, it changes at most 50 lines in at most 3 files, and no file matches a built-in high-risk glob: migrations, auth, `.omp/`, CI workflows, or secrets.
A review's output may then carry `skipped: "<reason>"`, and recording the next stage writes `(skipped: small change)` after that review's checked box; the skill also runs no arena and no critic for a change expected to stay that small.

## Context

The skill already skipped the arena when only one approach was sound, and the reviews when `.omp/ui-paths` or `.omp/review-paths` listed no changed file.
A repository without `.omp/review-paths` asked for the thermonuclear review on every PR, a typo included.

## Options considered

- The agent says a change is small, unchecked: nothing stops a large PR from skipping its reviews.
- A small PR needs no review, as an unmatched paths file does: the agent could not run a review it wanted, and the PR body would not say why no review ran.
- An opt-in skip that `ship_stage` refuses unless GitHub's size says small, noted on the box: chosen.

## Consequences

The limits and the risky globs are constants in `ship.ts`, not a per-repository file; a changed file that matches the repository's `.omp/review-paths` still forbids skipping the thermonuclear review, since that file names the code whose standards require the review.
A box with the note counts as the review only while the PR stays small, so a push that grows it makes the gates ask for the review again, and the next check drops the note.
The arena skip happens before any diff exists, so it rests on the agent's estimate; only the review skip is checked.
Every skip goes in the ship trace with the output that carried it.

## Confirmation

`templates/omp/ship-fast-path.test.ts` tests the size rule, the note, and the allowed and refused skips.

## Revisit when

Skipped reviews let through bugs a review would have caught, or the limits refuse changes that are small in practice.
