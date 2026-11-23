---
status: accepted
date: 2026-11-23
decision-makers: user, agent
---

# Independent checks and reviews run at the same time

In the context of a landing's checks and `/ship`'s two reviews, facing a landing that waits on test files run one after another and an interface review that the thermonuclear review waits for, we chose to run the test files in parallel worker processes and to start both reviews in one `task` call, over keeping them in sequence, to cut the waits that no result needs, accepting a short second code-quality review of the interface fixes.

## Context

`.omp/land.json` already ran `bun test`, both typechecks, and `bun run lint` side by side, and measured on this repository's tree the landing took 104 to 114 seconds, of which `bun test` alone took 101 to 111.
The CHANGELOG rule and `scripts/check-test-edits.ts` ran first and took under 0.1 seconds, and the two `bun install` setup steps took 2 to 2.5 seconds together.
`bun test` ran its files one after another in one process; Bun 1.4's `--parallel` runs them in one worker process per core.
The interface review judges the UI against the app's design system and the thermonuclear review judges code quality, and the second waited for the first only so it would see the interface fixes.

## Options considered

- `bun test --parallel` in the landing's check group: the landing took 25 to 29 seconds; chosen.
- Move the CHANGELOG rule and the test-edit check into the parallel group: saves under 0.1 seconds, and a landing that misses its CHANGELOG lines would then fail only after the whole group, so they stay in front as quick gates.
- Run the two `bun install` setup steps at the same time: saves under a second and needs setup groups in the lander, so setup stays in sequence.
- Run both reviews at once on the same PR head, apply both reviews' findings in one fix agent, and review the interface fix commits alone for code quality afterwards: chosen.
- Keep the interface review before the thermonuclear one, as the 2026-10-28 decision placed it: the code-quality review sees the interface fixes, but waits a whole review for it.

## Consequences

Test files run in separate processes with a fresh global object each, so a test that relied on another file's leftovers fails, which is a bug in that test.
The thermonuclear review of the interface fix commits is skipped when they changed only copy, design tokens, or styles.
The pre-push hook and CI run `bun test --parallel` too, since they run the same checks as `.omp/land.json`.
The ship extension's gates do not change: the interface box still gates `thermonuclear` and the thermonuclear box still gates `ready_gate`.

## Confirmation

`bun test --parallel` passed 12 of 13 runs on this repository's tree in fresh checkouts, 6 of them alongside the typechecks and lint, and the landing's check group took 23 to 27 seconds against 101 to 111 before; the landing runs a failed check again and reports a pass on the second run as flaky.
`templates/omp/agent/docs/review-workflow.md` and the ship skill's steps 5 and 6 say both reviews start in one `task` call.

## Revisit when

A test file needs another's state, or the reviews' fix rounds keep colliding on the same files.
