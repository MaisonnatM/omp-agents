---
status: accepted
date: 2026-11-24
decision-makers: user, agent
---

# Eval runs show as subagents of the session that started them

In the context of eval runs, which `scripts/evals/run.ts` starts as headless `omp -p` processes with their own config and session directory, facing a session that ran an eval for an hour with nothing in the dashboard showing its runs or their progress, we chose a record per run that the runner writes into the starting session's artifacts directory and that the server lists as a subagent row, over a manifest in a shared folder matched by session id and over making the runs real omp subagents, so each run shows under the session or subagent that started it with its status, task, and outcome, accepting that runs started outside omp, or before this change, do not show.

- The runner reads `PI_SESSION_FILE` before `confined()` strips `PI_*` from the run's environment; the artifacts directory beside that file is where omp already keeps a session's subagent files, so a subagent that starts an eval records under its own transcript and its runs nest under it.
- A shared folder would need its own cleanup and a session-id index; the artifacts directory goes with the session.
- Making each run an omp subagent would break the run's confinement, its pinned config, and the comparison with past runs.
- The rows reuse the **Subagents** section and `AgentRow` with an `evalRun` mark, which hides the stop button, keeps the session out of waiting on subagents, and keeps runs out of the worktree occupants, since a run works in its own clone.
- Agents that an eval cell starts with `agent()` or `workpool` already list as subagents: omp runs them through `runStructuredSubagent`, which publishes the same lifecycle frames as `task`, so they need no record.
