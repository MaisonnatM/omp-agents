---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# ship_stage reads each named PR's state from GitHub and trusts its merged state

In the context of the kit's `ship_stage` tool recording `merged` for several PRs landed one after another with the `land` tool, facing hameau #53 and #54 refused with "GitHub has not reported this PR merged." right after #55 was recorded merged, although GitHub reported all three `MERGED`, we chose to read each named PR's state from GitHub unless the state already holds that PR as merged, to drop an answer about a PR or repository the state no longer tracks, and to run one call at a time, over accepting a merge from the land commit's trailer or from the branch being an ancestor of main.
The refusal stays exactly as strict as GitHub: a PR GitHub does not report merged is refused, and one it does is accepted, accepting one `gh` read per named PR.

## Cause

`pollPr` returned early whenever the stage was `merged`, so after #55 the next `ship_stage merged` for #53 never asked GitHub and checked #55's stale state, which was not #53's.
`restore` kept the same state across a PR switch, and parallel calls shared one state, so a call could also read another call's answer.

## Options considered

- Accept a merge from the `land` tool's merge commit or an ancestor check of the PR's head on main: rejected, since GitHub already reports the merge within a second of the land, and a second source of truth could accept a PR GitHub calls open.
- Skip the read only while the state holds the same PR as `MERGED`, clear the status on a PR switch, drop late answers, and queue calls: chosen.

## Consequences

Each named PR costs one GraphQL read, five for the five calls of the hameau smoke.
Calls in one session run one after another, so parallel `ship_stage` calls take a little longer.
The stage still reads `merged` when a later call names an open PR without a stage, which this fix leaves as it was.

## Confirmation

The `ship_stage merged` tests in `templates/omp/extensions.test.ts` mark one PR merged then name others, one after another and in parallel, and check that an open PR is still refused; they fail on the old `ship.ts`.
