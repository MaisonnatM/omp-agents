---
status: accepted
date: 2026-11-03
decision-makers: agent
---

# A session waiting only on a background job reads idle

In the context of a session's status, facing an agent that replies while a background job it started still runs, we chose to end the turn at that reply, so the session reads idle and reports it, over keeping it working until the job's result arrives and over a third status for the wait, to give the user the turn the agent gave back, accepting that a session restarted mid-wait comes back idle without `continue`.

## Context

omp ends such a reply with an `agent_end` that carries `isTerminal: false` and `awaitingAsyncWork: true`: the model handed control back, and only the job's result can resume it, with a new `agent_start`.
The dashboard read every non-terminal `agent_end` as a turn that runs on, and `reattach` counted `get_state`'s `hasPendingAsyncWork` as a running turn.
Measured on the user's dashboard, a session showed working for 13 minutes while it answered three prompts, until its DNS polling job delivered; omp gives such a job up to 50 minutes.
omp's own terminal sets its title idle at that `agent_end` and keeps a row naming the jobs it waits on.

## Options considered

- Keep it working until the job delivers: it matches omp's run, which is not over, but the session looks stuck, sends no reply notice, and keeps Router tasks and usage-limit continues waiting on a turn the agent already ended.
- A third status, such as waiting on a background job: the most precise, but every reader of `HostStatus` would need to place it, and the user can do nothing with it that idle does not allow.
- End the turn at the reply: the session reads idle, the reply notice and unread mark come at once, and the job's result starts a new turn the dashboard shows working; chosen.

## Consequences

The user can read the reply and send the next message while the job runs; omp takes it as a new prompt.
The page offers no Stop while the session waits, and the job's result still wakes the agent, as omp intends.
A session that waited on a job when the computer restarted resumes idle, without the `continue` prompt, though its job died with omp.
A held move happens at the reply, and the move's restart stops the job.
A Router task moves to review at the reply, and back to working when the job wakes it.

## Confirmation

`src/dashboard-session.test.ts` covers the live end, the handover that stays working, and the reattach.

## Revisit when

omp adds a turn state the dashboard could show for the wait, or users want Stop while a session waits on a job.
