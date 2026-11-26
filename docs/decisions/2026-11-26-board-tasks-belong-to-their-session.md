---
status: accepted
date: 2026-11-26
supersedes: 2026-11-25-hold-a-board-claim-for-a-15-minute-lease
decision-makers: Maxence Maisonnat
---

# Board tasks belong to their session

In the context of Board sessions, facing a 15-minute lease that every session had to claim and renew while the sweep already skipped any session still working, we chose to let the session the runner started own its Board task until it marks it done or exits, over keeping the lease.
We gain fewer tool calls per session and no lease loop under load, accepting that a hung but live session keeps its task until it is stopped.

## Decision

- The runner makes one branch `board/<id>` and its worktree per Board task, and starts each session there.
- A session the runner started never claims or renews; `claim` stays for interactive sessions only.
- `done` runs the checks `.omp/land.json` lists before its full suite, then ends the session after that turn.
- A task whose session exits without `done` is ready again.
- A bare "Merge on main" reply is landed by the server without a session; a failed land reopens the task with the failure.
