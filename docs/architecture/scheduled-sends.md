# Scheduled sends

A scheduled send is one message to a session, or one new session's start, that waits for a time; see [Send later](../usage/send-later.md) for what the user sees.
`src/shared/scheduled.ts` holds its shapes, `ScheduledSend`, `ScheduledTarget`, and `ScheduledChange`, and the rules the server applies, `applyScheduled` and `isDueSend`.
A target is `{ kind: "message", sessionId, text }`, `{ kind: "start", request }`, where `request` is the `NewSessionRequest` that the new-session draft's **Start session** would send, without images, or `{ kind: "continue", sessionId, provider, cause }`, which only the server schedules, below.
The page resolves a plan window's reset to a time before it sends the change: `at` is the window's `resetsAt` plus `RESET_MARGIN_MS`, one minute, and `reset` only names the window for the lists.
So a send never moves when `omp usage` later reports another reset time.

`src/server/scheduled-file.ts` keeps the sends in `scheduled.json` beside the access token, as `{ sends }`, soonest first, and moves a file that holds anything else to `scheduled.json.invalid`.
A send's `state` is `waiting`, `sending` from its claim until it reaches omp, or `failed` with the error and its time; a send that reaches omp leaves the file.

`src/server/scheduled-runner.ts` sends them.
Its `tick` runs on the minute tick, before the routine runner's, only on the server that owns the unattended work, and sends each due waiting send in turn.
`sendNow` sends one at once on whichever server the page talks to, a failed one too.
Either way the runner first claims the send and writes `sending` to the file at once, so a second tick or another server never sends it twice.
Claiming holds the shared file's ownership lock across the read, state change, and successful replacement.
A persistence failure rejects `sendNow` before it reaches a session or starts one.
The failed write stays dirty and keeps its lock until a later flush succeeds.
Such a claim is not delivered after a retrying flush, and remains `sending` for recovery rather than risking a duplicate.
A message goes through `reach`, which `Dashboard` builds for this runner: the live session with that session id, else that session resumed through the same `start` the page uses.
The runner sends it through its `prompt` as a `followUp`, a follow-up while its turn runs and a prompt otherwise.
A start goes through `start` as the page's would, so the todo it names is linked the same way.
A failure, such as a session that cannot resume or a start that fails, saves the error on the send, which waits for **Try again** or **Dismiss**.
A send that a stopped server left `sending` may have reached its session, so the owner fails it at its start or takeover (`ScheduledRunner.recover`) rather than sending it again.

A `schedule` socket message carries one `ScheduledChange`: `add`, whose `id` the page picks so an add sent twice adds once, `remove`, which cancels a waiting send or dismisses a failed one and leaves one under way, `take`, `update`, or `send-now`, which answers once the send went or failed.
`update` is the scheduled-session page's save: it replaces a waiting or failed send's time and target in place, keeps its `createdAt`, sets it waiting again, and, like `take`, refuses one under way or gone, so the page never believes an edit saved.
`take` is **Edit**'s: it takes a waiting or failed send off the schedule and writes the file at once, as a claim does, so the server that sends reads it gone.
`applyScheduled` throws for a `take` of a send that is gone or under way, which may already have reached its session; the request's `done` carries that error, and the page puts the text back in the composer only after a `done` without one.
`parseScheduledSpec` in `src/shared/scheduled.ts`, which `parseScheduledChange` in `src/server/wire.ts` and `src/server/scheduled-file.ts` share, holds a message's text and a start's prompt to `MAX_SCHEDULED_TEXT`, a million characters, and refuses images, an empty text, and a start that resumes.
Every socket hears the sends after each change and each claim, send, or failure as a `scheduled` message on the roster topic, also sent when a socket opens; a change that changes nothing sends them back to its own socket alone.
Each server also reads the file and sends the list on its minute tick, so pages on a server that does not send see what the owner did.
A send is at most a minute late, and one whose time passed while no server ran goes at the first tick after one starts.
A message whose session runs live on a server that does not own the unattended work goes to a resumed copy on the owner, since each server reaches only the dashboard sessions it started.

`src/server/auto-continue.ts` schedules a `{ kind: "continue", sessionId, provider, cause }` send when a dashboard session's `turn-ended` carries a `failure` ([Dashboard sessions](dashboard-sessions.md)); the runner delivers it as the message `continue`.
`Dashboard` hands each `turn-ended` of a session it started to `AutoContinue.turnEnded`.
A usage limit's continue has `cause` `usage-limit`, and a transient fault's `transient`; `parseScheduledSpec` reads a continue that `scheduled.json` kept without a `cause`, from before transient retries, as `usage-limit`.
`continueWhen` picks its time after reading `omp usage` again, once a run already under way, which may have started before the limit, finished: when every one of the provider's accounts has a used-up window, the latest reset among each account's used-up windows, then the soonest account, since omp moves to any account that serves, plus `RESET_MARGIN_MS`, with `reset` naming the window as the **Send later** menu does.
Otherwise, an account with nothing used up being one that could serve now, it waits the error's own retry hint plus the margin, with `reset` `<provider> limit`, and with neither one hour, `UNKNOWN_RESET_WAIT_MS`, with `reset` `null`, which the page words as an unknown reset; a failed `omp usage` run counts as no window.
A transient fault schedules its continue at once, with `reset` `null`, after the next wait of `TRANSIENT_RETRY_WAITS_MS`, 1, 2, 4, 8, then 16 minutes, by how many transient faults in a row the session's retries already followed; the sixth schedules nothing and starts the count over, so the session stays idle.
`AutoContinue` keeps that count per session id in memory, so a restart starts it over too.
A turn that ends without a failure or on a usage limit, an `edit-prompt`, and `#endLive` clear it, while `turn-started` leaves it, so the turn a retry starts and fails again waits longer.
`applyScheduled` takes the server's `ContinueChange`s: `continue` replaces the waiting or failed continue of its session, and `drop-continue` drops it; both leave one under way, which may already have reached the session.
The socket's `schedule` parser refuses a page's `add` or `update` of a continue, while `scheduled.json` keeps them.
`AutoContinue.turnStarted` runs on the session's `turn-started`, which `DashboardSession` emits at each main-agent `agent_start` whoever prompted: the page or a scheduled message.
The continue's own turn does not cancel it, since the runner claimed it first and `drop-continue` leaves one under way.
An `edit-prompt` cancels the old session id's continue through `AutoContinue.cancel`, since the edited turn starts under the new id, and ending the session through `Dashboard`'s `#endLive` cancels it too.
A cancel that arrives while the usage read runs keeps the continue from being scheduled.

`AutoContinue.held` reads the hold from the schedule: a session is held while `scheduled.json` has a continue for it that waits or is under way, or while its limit's usage read runs, the one part kept in memory.
A continue that failed never goes on its own, so it holds nothing: the runner's failure reaches `sendsChanged` like any change, which releases the session, while the row stays for **Try again** or **Dismiss**.
So a session the server attached to after a restart is still held while its continue waits.
The routine runner and the cleanup after a merge read a session's real `status` and its `occupied`: a turn runs or waits on a question (`occupiedBy` in `src/server/auto-continue.ts`), or `AutoContinue` holds it.
An occupied session is not ended by a routine or by the cleanup after a merge, which tries it again at its next look.
The page reads the roster, so a held session shows idle.
`AutoContinue.sendsChanged` compares the held sessions with those it last saw, starting from the file as the server starts, and releases each that is no longer held.
Every change to the sends goes through `Dashboard`'s `#publishScheduled`, which tells every socket and calls `sendsChanged`: the page's edits, through the list registry's push, the runner's claims, sends, and failures, `AutoContinue`'s own continues and cancels, and the minute tick's read of the file, which brings in what another server did.
