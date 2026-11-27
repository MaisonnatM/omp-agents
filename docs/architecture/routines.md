# Routines

Every routine belongs to one Workspace, its `workspace`, and acts on its schedules, its triggers, or both, with at least one of either.
A schedule is every so many minutes, counted from the last scheduled run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST.
The routine is due at the earliest of them.
Two intervals share that last scheduled run, so the shorter one decides.
The routine keeps that run's time in `scheduledAt`, which a slot's or **Run now**'s claim sets and a trigger's leaves alone, so a busy Slack moves no schedule; a file from before triggers reads it as its newest run's time.
Its task is a `prompt`, which each run posts as a Board task in its Workspace, or a `command`, a shell command that runs in its Workspace, whose report a run posts the same way, under the command's own `prompt` when it has one.
Its optional `launch`, the Board's `BoardLaunch`, picks the model and thinking of the session the Board starts on its Board task.
A routine runs only where `runsHere` in `src/routines.ts` holds: it is `enabled` and its `machine` is `null`, as it is for every routine made, edited on, or turned on here.
Settings sync carries the routines and sets `machine` to the other machine that runs one, `{ id, name }`; see [Settings sync](settings-sync.md).
`applyRoutine` keeps `machine` through an edit, clears it when a routine is paused, and clears it when **enable** turns on a routine another machine runs, setting `scheduledAt` to now so a slot that machine ran does not run again here at once.
`isDue` and `isTriggeredBy` check `runsHere`, so the runner, the triggers, and `watchedKinds` skip a routine another machine runs, and the page shows **Runs on** and that machine's name with its switch off.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops, with a log line, a routine whose task was pull requests or a project, kinds an older version ran.
The rest of the file stays.
A file that is not a list of routines still moves aside.
`parseRoutineSpec` in `src/routines.ts` checks each routine's fields both for the file and for the socket's `routine` save, so the two hold the same limits.
The `Dashboard` sends the routines back to the page that asked.
Every dashboard-started main session also gets the strict host tools `save_routine` and `delete_routine`, from `SessionRoutines` in `src/server/session-routines.ts`, the way `schedule_follow_up` reaches it.
They reach only the routines of the session's Workspace, its directory or, in a linked worktree, that repository's main checkout: a new routine gets that Workspace, a save keeps it, and an id that names no routine of that Workspace is refused.
Each result and each refusal lists the Workspace's routines by id and name, so `delete_routine` with an empty id lists them and changes nothing.
They apply through the list registry, so every page hears the change.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, `triggeredBy`, the events that started it, empty for a slot's or **Run now**'s run, and one `outcome`: `queued` from its claim, `sending` while its post goes to the Board, `posted` with the Board task it posted or replied on, a `command` with the command's result once it ran and the Board task its report went to, if any, or `failed`.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, and otherwise `queued`.
A run that went to a session before routines posted to the Board, `sent`, `session`, or `started`, is dropped, since no Board task holds it.

## Routines from before the Board

Only the server that owns routines rewrites the file, through `RoutinesFile.migrate`: as it takes ownership at start, before the runner recovers, and again as it takes over routines and rereads the file.
Another server reads the migrated routines in memory and leaves the files alone.
A routine with a `botId` belonged to an agent kept in `bots.json`; it takes that file's `cwd` as its Workspace, its model as its `launch`, and its prompt, or a command's new `prompt`, becomes the routine's prompt, then `## Job` and that agent's job, then `## Memory` and its `memory.md` under `$XDG_DATA_HOME/omp-agents/bots/<id>/` when that is not empty, cut to `MAX_PROMPT_LENGTH` with a log line.
A routine whose `botId` names nothing in `bots.json` is dropped with a log line.
A built-in routine's id takes the task `BUILT_IN_ROUTINES` ships instead, with no job or memory folded in, so no past built-in prompt survives the move.
Before the migrating save, `migrate` copies `routines.json` to `routines.json.before-board`, once; then it renames `bots.json` to `bots.json.migrated`, or to `bots.json.migrated-<milliseconds>` when that name is taken.
A routine that moved but does not parse is logged and keeps both files as they are, so nothing is lost: the server runs the routines it read, and the next start tries again.
An older routine with its own `workspace` keeps it, and a skill it had becomes its `launch`'s.
A file already migrated changes nothing.

## Routine heartbeat

`erroredRuns` in `src/routine-health.ts` lists the runs that errored, as `ErroredRun`s: the routine's Workspace, id, and name, and the run's key.
It judges the runs claimed in the day before the last half hour (`HEALTH_WINDOW_MS`, `SETTLE_MS`), so a run still under way waits for the next look.
A run errored when it has errors, its outcome is `failed`, its command stopped, failed, or did not exit 0, or its Board task's session failed.
A command whose routine has `post: "failures"` hands its output to a session by exiting non-zero, so that exit, and the `exitedWith` error it records, is no error.
A run that took far less than usual, was claimed late, or whose session ended with no reply is not listed: those flagged too many healthy runs.

`boardRunTurn` in `src/server/routine-turns.ts` reads a posted run's turn, a `RunTurn`, from its Board task, from what the run posted, the Board task or the routine's reply, to the first done after it: the session that took it (`start`, or the `startedOn` of the reply the run posted), whether that session replied or marked the Board task done quietly, whether its start failed, how long it took, and its `usage`, every assistant message's input, output, and cache tokens, and its `usage.cost.total`, read from that session's file.
A run whose Board task or session file is not found has no turn, so it is judged on its outcome and errors alone.
The runner records that `usage` on each posted run that has none yet once its session's turn ended, in `routines.json`, so the page shows each run's tokens and cost and a routine's total over its kept runs.
The `Dashboard` checks `HEALTH_KINDS` on the owner at startup and on the daily tick, and the bell shows one `routine-health` notice for what it found; see [Notifications](notifications.md).

## Built-in routines

`BUILT_IN_ROUTINES` in `src/server/built-in-routines.ts` holds the routines the dashboard adds by itself, each with the omp-agents checkout (`sourceDir`) as its Workspace.
As the owner takes ownership, right after it migrates the routines, `addBuiltInRoutines` saves each one that `built-in-routines.json` beside the access token does not list yet, through the lists so pages hear of them, then lists its id there.
A routine you delete is not added again, and one listed is left as it is.
The second built-in routine is **Friday routine receipt**, disabled, on Fridays at 17:00.
Its prompt, `ROUTINE_RECEIPT_PROMPT`, reads the last 7 days of runs in `routines.json`, with each run's `usage`, tells a quiet run by the quiet `done` of its Board task in `board.json`, and asks for one table of runs, useful runs, tokens, cost, and a keep, slow down, or retire verdict per routine; it changes nothing.
The first is **Weekly harness review**, disabled, on Mondays at 9:00.
Its prompt, `HARNESS_REVIEW_PROMPT`, first judges last week's change: it finds the newest `~/.cache/omp-harness-review/<date>-review.md` before today and, when its folder `<date>/` holds replay results, runs `model-replay.ts summary --by-task` there and says per replayed failure whether the replay kept its base's checks and now passes the ones that failed; with no results it says in one line that the replay was never run.
It then reads the last week of `ship-trace.jsonl` for every repository, with the fixes refused at their round budget or stall limit, which need `moreRounds`, `LEARNINGS.md`, the failed merges in `merges.json`, and the failed runs in `routines.json`, and asks for the failures grouped by cause, exactly one harness change as a decision for the user, and five past failures to replay against it.
It saves those five with `model-replay.ts candidates --sessions` as `<today>-tasks.json` and its reply as `<today>-review.md` in that folder, and ends with the `model-replay.ts run` command, on the `task` role's model and out to `<today>/`, to run once the change lands; see [Worker model replay](token-cost.md#worker-model-replay).
It forbids editing, committing, or pushing in any repository and running `run` or `judge`, and writes only under `~/.cache/omp-harness-review/`.
Since a replay loads no extension but `cache-tail.ts`, a proposed extension change names instead the [Evals](evals.md) run that would measure it with the full harness, such as its `--disable-extensions` arm, which the review does not run.

## Routines in every Workspace

A routine with `everyWorkspace: true` is a template, and a routine with `copyOf` is a copy of the template with that id; both fields are part of `RoutineSpec`, so a save, the file, and Settings sync carry them.
A Workspace has a template when it is the template's own Workspace or one of its routines has that template as `copyOf`.
`copiesFor` in `src/server/routine-copies.ts` names the copies due among the eligible Workspaces, given what was seen: a template not seen yet goes to every eligible Workspace that does not have it, and a Workspace not seen yet gets every template it does not have.
A copy is a new routine with a fresh id, the template's name, schedules, triggers, task, launch, and `enabled`, the Workspace as its own, `copyOf` set, `linked: true`, and no `everyWorkspace`.
A linked copy follows its template: `applyRoutine` rewrites the name, task, triggers, and launch of every linked copy when the template is saved, and leaves each copy's Workspace, schedules, and `enabled` alone.
A save of a linked copy whose name, task, triggers, or launch differ from its template's drops `linked`, and so does the editor's **Detach**; deleting the template drops it from all its copies. A copy without `linked` keeps `copyOf` and is an ordinary routine.
The editor of a linked copy shows **Follows** with the template's name and leaves the name, model, task, and triggers read-only.
What was seen is `routine-copies.json` beside the access token, `{ workspaces, templates, linked }`, which only this computer keeps and Settings sync never carries.
Without `linked: true` in it, the next check asks once to link every copy made before copies followed their template; the save keeps the link only on copies still the same as their template, so a copy changed by hand stays its own.
With no such file yet, `RoutineCopies.check` copies nothing and records the eligible Workspaces and current templates, so the first run adds no copy.
The seen Workspaces only grow, so a copy you delete stays deleted, and a Workspace hidden then shown again is not new.
The seen templates are the ones still marked, so a template turned off and on again copies again where it is missing, and turning it off removes no copy.
The eligible Workspaces are those the dashboard shows, the known and added ones without the hidden ones, that pass `takesCopies`: outside the temp roots, and with a `.git` directory, so a linked worktree, a folder outside git, and a gone directory take none.
Only the server that owns routines checks: as it takes over, right after the built-in routines, on its minute tick after the runner, and right after any routine save that changed something, so turning a template on copies it at once.
It saves the copies through the lists, so pages hear of them, and then what it saw, so a crash between the two repeats no copy, since the Workspace then has it.
A check with nothing new changes nothing.
The `save_routine` tool takes `everyWorkspace` and keeps the routine's own when it is left out, and always keeps a copy's `copyOf`.

## The runner

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected, and only on the server that owns routines; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Ticks and **Run now** claims share one `SerialLane`: a tick that finds the lane busy is skipped, and a **Run now** waits its turn.
A tick starts nothing unless the Mac is fully awake, by `fullyAwake` in `src/full-wake.ts`, which reads the system capabilities `pmset -g systemstate` prints: a dark wake, the few seconds of Power Nap or network maintenance the Mac wakes for while asleep, lacks Graphics.
A run started in a dark wake stalled until the next full wake, and a command's time limit ran out meanwhile.
Off macOS, or when `pmset` fails, the Mac counts as fully awake.
**Run now** does not wait, since someone asked.
Each tick at a full wake does three things, in order:

1. It posts the command reports held since a command ended outside a full wake.
2. It claims each due slot: it saves a new queued run before it starts anything.
   Slots missed while the dashboard was closed or the Mac slept coalesce into one run at the next tick at a full wake.
3. It starts the queued runs, oldest first, unless memory pressure holds unattended work, which leaves them queued for the next tick; see [Unattended work waits on memory](session-processes.md#unattended-work-waits-on-memory).
   While it holds them, its `held()` returns the reason, kept only in memory and cleared once the runs start, and the `routines` message carries it as `held`.
   A prompt run posts to the Board of its Workspace through the runner's `postBoard`, which writes it at once and returns the Board task it posted or replied on, the path the Board page and tool take, as the routine author `{ kind: "routine", routineId, name }`, which only the server may post as; see [Board](board.md).
   The post's title is the routine's name, its `launch` the routine's, and its text, from `postText`, the prompt, then the trigger events fenced as data.
   When the routine's newest Board task in its Workspace, the newest one posted there as that routine, is not done, the run replies on it instead, which wakes its session; otherwise it posts a new Board task.
   The run records `posted` with that Board task's id; a refusal, or a Board that could not be written, goes to the run's errors, and the next run tries again.
   The Board's runner starts the Board task's session as for any other, in its worktree `board/<id>`; the routine runner neither tracks nor ends it, so routines hold no slot cap of their own.
   A command starts through the runner's `exec`, `runShell` in `src/proc.ts`, in the routine's Workspace, and the drain does not wait for it, so a tick never blocks for minutes.
   `runShell` runs `/bin/sh -c` with stderr merged into stdout, keeps the last 64 KB of output, and stops the command after 10 minutes of awake time.
   Timers and `Date.now()` count the time the Mac sleeps, so its timer re-arms for the awake time left by `performance.now()`, which stops while the Mac sleeps.
   It returns `slept`, the wall time less the awake time, to the second, when a second or more.
   It spawns the shell in its own process group and stops the whole group with SIGTERM, since a command's own children would otherwise keep running and hold the output pipe open.
   When the command ends, the runner writes its exit code, output, times, and `slept` to the run; a non-zero exit, a stop, or a failed spawn also goes to the run's errors.
   It then posts, or replies, the command's report, `commandReport`: the command, its result, how long the Mac slept, and its output fenced as data, under the command task's `prompt` when it has one.
   A command task with `post: "failures"` skips that post, and holds nothing for a full wake, when it exited with code 0; see [Command routines can post only their failures](../decisions/2026-11-04-command-routines-can-post-only-failures.md).
   With `post: "changes"` it skips it only when it exited 0 with the same output as the routine's newest earlier run that exited, so a command acts as a cheap gate before a session's model turn.
   That post waits for a full wake, since the session it starts would stall in a dark wake; it waits in memory, so a server that stops first never posts it, though the run keeps the output.
   The run keeps the output whether or not the post goes through, records the Board task in its `command` outcome's `task`, and a post the Board refused adds why to the run's errors.
   The runner keeps the routines whose command runs in memory, since a run holds one outcome and later `run-now` claims can push a running command's run out of the saved 10; a command routine whose last command still runs records an error instead of running a second one.

Running a tick twice starts nothing new, since the slot is claimed, and a tick that comes while one runs is skipped.
A crash after a claim loses no queued run, since it is on disk.
A run left `sending` when the server stopped fails at the next start with `STOPPED_WHILE_SENDING`, and waits for the routine's next slot.
Stopping the server stops every running command, right before it exits, so the result of a command it stopped is never saved as a time-limit stop.
A run saves its command as `running` before the command starts, then as `exited`, `stopped`, or `failed` when it ends.
No command resumes after a restart: the server that owns routines turns each run still saved as `running` into `stopped` by the dashboard, with that error, when it starts or takes over (`RoutineRunner.recover`).

A `routine` socket message carries one change: `save`, `remove`, `enable`, or `run-now`, which claims a slot now, whatever the schedules, and drains it.
Every socket hears the routines after each change and each step of a run as a `routines` message on the roster topic, also sent when a socket opens.
Its `held` is why the queued runs wait to start, sent only by the owner, else `null`; a routine whose runs include a queued one shows it in place of **Running…**.

## Triggers

A trigger is a kind of thing that happened, `slack` or `pull-request`, that also starts a run of each enabled routine that lists it.
Triggers add no integration of their own: they read what the bell's checks already fetch, in `src/server/notices.ts`.
The `Dashboard` wraps two of the `NoticeSources`, `pullRequests` and `slack`, so each answer also goes, unchanged, through the helpers in `src/server/routine-triggers.ts`, which turn it into sightings.
A sighting has an id that names what it saw in the state it saw it, and a scope, which one answer covers:

- **Pull requests**: each pull request of a repository GitHub answered for whose move is yours, by that move as `moveOf` reads it with the sessions on it, as the bell reads it; scope `pull-request:<owner/repo>`.
  A pull request is new when its move becomes yours or changes to another of yours, so a draft, checks still running, or a session at work on it, such as a routine session pushing a fix, fires nothing until it ends in a move of yours.
- **Slack**: each conversation's newest message that waits on you, by Slack's id for it; scope `slack`.
  While Slack is signed out, the check forgets the scope, so the first answer after signing in sets a new baseline and fires nothing for messages already waiting.

`TriggerWatch` keeps the ids of each scope's last answer in memory, and keeps the ids it had not seen as news until the `Dashboard` takes them once the check ends, so the sources of one check start one run of a routine.
A scope's first answer since the server started only sets what it knows, so a restart, or what happened while the dashboard was stopped, starts nothing; a scope whose check failed keeps what it knew.
Every server learns its sightings, but only the server that owns routines fires them; another drops its news, and a server that takes over routines forgets what it learned before, so its next answers set a new baseline and a takeover fires nothing old.

`RoutineRunner.fire` claims one run of each routine that watches a kind of the news, holding the first 10 of those events the check listed, then drains when the Mac is fully awake, in the same `SerialLane` as ticks and **Run now**.
Otherwise the runs stay queued for the next tick at a full wake, and news for a routine whose triggered run is still queued joins that run, up to 10 events, through `RoutinesFile.addTriggerEvents`, so a night of dark wakes starts one run.
A run is keyed by its time, so a claim lands at least a millisecond after the routine's newest run.
A routine whose schedules are all weekly hears its triggers only on the weekdays they name, by `triggersOn`, so a weekdays-only routine ignores weekend news; one with no schedule or an interval hears them every day.
A prompt run lists the events under its instructions in the Board task it posts, as one JSON list fenced as data.
A command gets the events as a JSON list in the `ROUTINE_TRIGGERS` environment variable, `[]` for a scheduled run or **Run now**, which `runShell` sets beside the server's environment.
Each event carries its kind, a title, a detail of at most 2,000 characters, and a link when it has one.
The pull request and Slack checks run on the 2-minute activity tick, which checks both while a page listens; while none does, the owner checks only the kinds an enabled routine has a trigger for, by `watchedKinds`, and another server checks nothing.
A page that opens after a tick checked only some kinds checks both again.

## One server runs the unattended work

Servers on different ports share `~/.config/omp-agents`: your app and a smoke run, say.
Routines, the sport inbox, the daily sweep of omp's isolation sandboxes, and the idle stop of sessions' processes write that directory or omp's, or end processes, without anyone asking, so one server at a time runs them.
`OwnerLock` in `templates/omp/agent/extensions/github/owner-lock.ts` decides which, with `server.lock`, a file that holds `{pid, port}` of the owner.
A server creates it whole through a draft file and a hard link, so a reader never sees half of it.
Taking over a dead or invalid owner holds a short ownership lock at `<path>.reap` and rereads the original file before removal, so competing reclaimers cannot remove a new owner's lock.
The same mechanism recovers a crashed reclaimer's lock.
A process id that another program reused keeps the lock held; delete `server.lock` to release it.
At startup a server that does not own the lock logs once which port does, and the minute tick tries again.
On a takeover the server logs it, reads `routines.json` again, since the previous owner kept saving it, migrates it, fails the runs left sending a prompt or running a command and the scheduled sends left sending, and drains the sport inbox.
A server that exits normally deletes its lock.
The servers that do not own it still serve their pages, start sessions, and take what you do in them, such as editing a routine, **Run now**, or a process's **Stop**; only the minute tick's routines, scheduled sends, and isolation sweep, the runs the routines' triggers start, the sport inbox, the end inbox's requests for sessions started in a terminal, and the process sample's idle and gone-session stops are left to the owner.
Each server keeps its own copy of `routines.json` in memory and saves whole, so the last server you edited in wins until the owner changes.
`scheduled.json` is the exception: `ScheduledFile` is a `shared` `ReducerFile`, so a send added on any server reaches the owner and only one process can claim it.
Each mutation holds an `OwnerLock` at `<path>.lock` across reload, reduction, and the immediate JSON replacement, so independent server processes keep one another's changes.
A failed shared write rejects the mutation, retains the dirty value and its lock, and releases ownership only after a later flush succeeds or the process exits.
Other processes wait at most five seconds for a mutation lock, then reject rather than write without ownership.

## Isolation sandboxes

omp runs a subagent's isolated task in a sandbox under `~/.omp/wt` (`getWorktreesDir`, which `OMP_WORKTREE_DIR` moves): a directory named after the repository and the task, which holds the owner marker `.omp-isolation-owner.json`, naming the omp process and its start time, and the task's checkout.
In a native sandbox the checkout is `m`, `merged` in older sandboxes, a full copy of the repository with its own `.git`.
When omp finds ovnfs, the sandbox holds instead the record `.omp-ovnfs-checkout.json`, naming the ovnfs command and the checkout its daemon serves in a folder outside the sandbox.
omp removes a sandbox when its task ends, but one whose omp exited first stays, often gigabytes, and `omp worktree clear` removes those without looking at their changes.
`IsolationSweep` in `src/server/isolation-sweep.ts` removes them more carefully, once a day: the owner's minute tick starts a sweep when none ran for 24 hours, the first one a minute after the server starts or takes over, and does not wait for it, since it runs `git status` in every sandbox, four at a time.
A directory without the marker, such as a pull request's checkout, is no sandbox, and the sweep leaves it alone.
A sandbox stays while omp's `hasLiveIsolationOwner` says its process runs: a process id that is gone, or that another process now holds with a different start time, has exited.
It stays while a live session, idle or waiting ones included, or the server runs in it or in its ovnfs checkout, by `Worktrees.inUse`; while its checkout has a tracked change or an untracked file, by `git status --porcelain --untracked-files=all`; and while its checkout is a linked worktree that Git locked.
It also stays when the sweep cannot read it: a marker that names no process, a checkout that is not a Git checkout of its own, or a git call that fails, such as a `git status` that takes over two minutes.
An ovnfs sandbox stays as unreadable when the sweep cannot locate its checkout: a record it cannot read, no running daemon for the record's command, or a daemon that does not answer, since the sweep asks only a running daemon and never starts one.
Commits that no remote has do not keep a sandbox, since the copy carries every local branch of the repository it copies, so nearly every sandbox has some, and the repository the task ran from keeps those branches.
A commit the task itself made, which its omp exited before bringing back, goes with the sandbox, as with `omp worktree clear`.
A sandbox with the marker but no checkout, left by an omp that exited while it made one, holds nothing of a task and goes, as does an ovnfs sandbox whose running daemon no longer lists its checkout, without any request to ovnfs.
Just before it removes one, the sweep asks again whether an omp owns it, since a task run again takes the same directory; then it runs omp's teardown in the order of `omp worktree clear`: it stops a retained native mount as omp's private `stopRetainedMount` does, and for an ovnfs checkout the sweep sends `rm` to the daemon it judged it on, first for the baseline checkout the record names, if any, then for the checkout name it judged, which deletes their files and never starts a daemon.
A checkout that daemon reports already gone counts as removed, and a daemon that stopped meanwhile fails the teardown.
Then it renames the sandbox with the suffix `.omp-agents-removing` and deletes it, so the next sweep finishes a removal cut short instead of reading half a sandbox.
A teardown that fails keeps its sandbox.
Each sweep logs one line with how many sandboxes it removed and kept, by reason, and one more for each it could not read or remove.
Storage shares this instance for a read-only `preview()` that measures removable sandboxes and those kept only for changes, and `remove(paths, { discardChanges })` that rechecks each sandbox because the confirmed preview may be old; only `discardChanges` lets a changed one go, and the unattended sweep never sets it.
An ovnfs sandbox whose checkout its daemon still serves gets no size in the preview, since its folder holds only the record and ovnfs cannot say what removing the checkout frees.
Each operation takes one `Worktrees.inUse` snapshot; the unattended sweep judges each sandbox once, then rechecks ownership immediately before removal.
Preview, manual removal, and the unattended sweep share a single-flight guard.
Manual removal accepts only direct directory children of omp's sandbox root, never symlinks, and the preview does not finish interrupted removals.
