# Background jobs

The Overview tab's **Jobs** section and the running-jobs badge on a sidebar row show each live session's background jobs: the omp `bash` calls that moved to the background or ran with `async`, such as `bg_3`.

## Where the server learns of them

omp's `bash` tool keeps calling its `onUpdate` for a backgrounded job after the call returned (`#startManagedBashJob` in `pi-coding-agent/src/tools/bash.ts`), and omp's agent sends those frames as `tool_execution_update` events, after the turn too (`onDetachedToolUpdate` in `pi-agent-core/src/agent-loop.ts`).
Each such frame carries `partialResult.details.async`, `{ state, jobId, type: "bash" }`, with `state` one of `running`, `completed`, `failed`, or `cancelled`, and the job's latest output as its text; a call still in the foreground sends frames without `async`, so it never lists.
`SessionJobs` in `src/server/session-jobs.ts` reads the main agent's events beside `TurnWaits`, through `LiveSessions.heardJob`, for dashboard and terminal sessions alike: the call's `tool_execution_start` gives a job its start time, and each frame its command, from the call's `args.command`, its state, and its last 15 non-empty output lines, colors stripped.
A non-zero exit or a timeout is `failed`, and a stop is `cancelled`; a frame after a job settled changes nothing.
A session's finished jobs stay until the session leaves the roster; a server restart forgets them, and lists a job that still runs again from its next frame, timed from then.
The process watch of [Session processes](session-processes.md) sees the same jobs as process groups, without their omp job id or output, so it stays the path that stops them; the Jobs section has no Stop button.

## Jobs the Subagents list shows instead

The eval runs that `scripts/evals/run.ts` starts show as subagents, from the records it writes (see [Evals](evals.md)), so `runsEvalHarness` leaves out a job whose command runs that script, and the same run does not show twice.

## To the page

The `jobs` socket message, `{ t: "jobs", jobs }` in `src/shared/protocol.ts`, carries every live session's jobs by instance id, whole, as a read-only list of `ListRegistry` on the `roster` topic, so a page gets it on connect.
The server pushes it at most every 250 milliseconds (`JOBS_PUSH_MS` in `src/server/live-update.ts`), and only when it changed.
The page keeps it as `jobs` in its state and hands it down through `JobsContext` in `web/jobs-context.ts`.

## Progress

`jobProgress` in `src/shared/jobs.ts` reads a job's last 5 lines, newest first, for a count `N/M` or `N of M` with N at most M, skipping one inside a path, date, or decimal, then pass and fail counts such as `21 pass` or `2 failed` on that line or a newer one.
`jobTimeLeft` extrapolates the time left from the count and the time run so far; a job's output carries no fixed progress format, so a job whose output has no count shows no bar.
