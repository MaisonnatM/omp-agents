---
status: accepted
date: 2026-11-23
decision-makers: agent
---

# Agent metrics read records that already exist

In the context of measuring whether harness changes make agents ship better, facing four metrics whose facts already sit in the ship trace, the `land` tool's results in omp's session files, git history, and omp-stats' `~/.omp/stats.db`, we chose a script, `bun run metrics`, that reads those records at report time over a new metrics log that `land` and `ship_stage` would append to, so that no record can disagree with the source it summarizes and the report covers history from before the script existed, accepting that each metric inherits its source's blind spots.

## Options considered

- A metrics log that `land` and `ship_stage` append to: one file to read, but a second record of what the session files and the ship trace already hold, and it starts empty.
- Read the existing records at report time: chosen; `scripts/metrics.ts` is the only new code, and the windows reach back as far as the sources do.
- Count landings from the dashboard's `merges.json`: it records only failed and pending GitHub merges, with no time, so it cannot fill a 7 or 30 day window.

## Definitions

- A landed change is a `land` result of kind `landed`, or a ship trace line that recorded the `merged` stage for a pull request; its cost is the whole spend of its session and that session's subagents in `stats.db`, counted once per session, and landings whose session `stats.db` never priced are left out of the average.
- A land run is the `land` calls of one session up to and including a landing; it passes first try when its first call landed, and a `nothing` result is not a call.
- An escalation is a `ship_stage` fix round that the trace shows refused with a round number, which only the round budget and the stall rule produce.
  It was needed when its pull request later merged without the user approving more rounds, and it was a false alarm when the user approved more rounds, seen as a later recorded round 1 of the same fix, and the pull request then merged; a pull request not merged yet leaves it open and out of the accuracy.
- A human edit is a commit without an `Omp-Session` trailer, outside the branch of any merge that carries one, that touches a file an agent's landing changed within the days `--human-days` names after it.

## Consequences

- Commits made before the kit's session trailer, 2026-10-31 here, carry no trailer and read as a person's, so the human-edit rate of a window reaching before that date counts agent commits as human edits.
- A commit an agent pushes straight to the branch without a trailer reads as a person's.
- A pull request merged on GitHub without a later `ship_stage` call naming `merged` is neither a landed change nor the end of an escalation.

## Confirmation

`scripts/metrics.test.ts` builds session files, a ship trace, a `stats.db`, and a git repository with dated commits, and checks each metric and the table for a 7 and a 30 day window.

## Revisit when

`land` or the ship trace stops recording a fact a metric reads, or the user commits by hand often enough that trailer-less agent commits skew the human-edit rate.
