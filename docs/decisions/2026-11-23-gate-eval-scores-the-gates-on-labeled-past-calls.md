---
status: accepted
date: 2026-11-23
decision-makers: Maxence Maisonnat
---

# Gate eval scores the gates on labeled past calls

In the context of the starter kit's gates, the bash guard, the untrusted reader's nudge, and ship's draft and verification refusals, whose unit tests hold inputs written to pass, facing no measure of how often they fire wrongly on the calls agents really make, we chose 50 real bash and `ship_stage` calls mined from omp's session files, redacted and labeled by hand, run through the real rule functions, over synthetic cases and over replaying whole sessions.
A rule change now shows its precision and recall per gate and each call it gets wrong, accepting a fixture that ages as the agents' habits change and labels that are one person's judgment.

## Context

Each gate has unit tests, but their lines were chosen by whoever wrote the rule, so they pass by construction.
The session files hold every call the gates saw: `gh pr view` lines, `--no-verify` commits, and the tool runs before each `ship_stage` record.
Many of those calls predate a rule, so the recorded outcome is not the label; each case carries the outcome a reviewer expects and why.

## Options considered

- **Labeled past calls through the rule functions (chosen).** Deterministic, runs in a second, and scores the code that decides; it skips the extension wiring, such as the reader's nudge firing only on a successful result.
- **Synthetic cases.** Easy to write, but they repeat the unit tests' blind spots.
- **Replaying whole sessions through omp.** Covers the wiring, but costs model calls and depends on the machine's state.

## Consequences

- `scripts/gate-eval/cases.json` holds the calls with home paths, `cd` targets, commit messages, PR titles, and bodies replaced; `{repo}` stands for a scratch git repository on a feature branch that the runner creates, so a verdict never depends on this machine's checkouts.
- A case that needs live state, such as killing a pid or `gh pr ready`'s GitHub check, stays out.
- `scripts/gate-eval/run.test.ts` holds a floor per gate: the cases each gets right today. A fix raises it; a drop fails the test.
- Cases labeled against today's rule, such as a variable that holds the dashboard token, record a known false positive rather than a bug to fix at once.

## Confirmation

`bun scripts/gate-eval/run.ts` prints the table and the mismatches; `bun run test:agent scripts/gate-eval/run.test.ts` passes.

## Revisit when

A new gate or rule lands without cases here, or the agents' calls drift enough that a fresh mine finds patterns the fixture lacks.
