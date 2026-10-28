# Routines

Every routine belongs to a Bot, through its required `botId`, and acts in that Bot on its schedules, its triggers, or both, with at least one of either; see [Bots](bots.md).
A schedule is every so many minutes, counted from the last scheduled run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST.
The routine is due at the earliest of them.
Two intervals share that last scheduled run, so the shorter one decides.
The routine keeps that run's time in `scheduledAt`, which a slot's or **Run now**'s claim sets and a trigger's leaves alone, so a busy Slack moves no schedule; a file from before triggers reads it as its newest run's time.
Its task is a `prompt`, a message that goes into the Bot's conversation, or a `command`, a shell command that runs in the Bot's workspace.
A routine has no workspace, skill, or pin of its own: the Bot's workspace, job, and conversation stand in for them.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops, with a log line, a routine whose task was pull requests or a project, kinds an older version ran.
The rest of the file stays.
A file that is not a list of routines still moves aside.
`parseRoutineSpec` in `src/routines.ts` checks each routine's fields both for the file and for the socket's `routine` save, so the two hold the same limits.
The `Dashboard` refuses a save whose `botId` names no Bot, and sends the routines back to the page that asked.
A Bot can also create, change, and delete its own routines through its `save_routine` and `delete_routine` tools; see [Bots](bots.md).
They leave one `BotRoutineRequest` each in `routine-inbox/` beside `routines.json`, and `RoutineInbox` in `src/server/routine-inbox.ts` applies them through the list registry, oldest name first, so every page hears the change and the same check refuses a save for a Bot that is gone.
`parseBotRoutineRequest` reads each file with `parseRoutineSpec`, and the inbox checks ownership against the routines as each file applies: a save must name the requesting Bot and, for an id that exists, change a routine of that Bot, and a remove must name an existing routine of that Bot.
Any other file moves aside as `<name>.invalid` with a logged reason, and a change the routines refuse is deleted rather than retried.
Only the server that owns routines drains the inbox, so a request waits there while the dashboard is stopped.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, `triggeredBy`, the events that started it, empty for a slot's or **Run now**'s run, and one `outcome`: `pending` from its claim, with whether it is still `queued`; `sent` with the session its message went to; or a `command` with the command's result once it ran.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, a started session or a Bot's message `sent`, and otherwise `pending`, queued when its `queued` is set or its `queue` list holds an entry.
A run stays queued from its claim until the drain sends its message or starts its command.

## Routines from before Bots

A routine from before Bots has no `botId`, and `RoutinesFile` gives it one as it reads the file.
Only the server that owns routines saves that and creates the Bot it needs, through `RoutinesFile.migrate`: as it takes ownership at start, before the runner recovers, and again as it takes over routines and rereads the file.
Another server reads the migrated routines in memory and leaves both files alone.
Each routine goes to one Bot named **Routines**, `ROUTINES_BOT_ID`, whose workspace is the first routine's workspace, else the home directory, and whose job says it runs the routines moved there.
A command whose workspace differs from that Bot's runs `cd` into its old workspace first, so it acts where it did.
A prompt whose workspace differs starts with **Work in** and that workspace, and a prompt with a skill starts with `/skill:` and the skill's name.
The pin goes, since a Bot's conversation is never ended.
The Routines Bot is created only when it is missing, through the lists so pages hear of it, so a migration that runs again reuses it, and a file already migrated changes nothing.

## The runner

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected, and only on the server that owns routines; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Ticks and **Run now** claims share one `SerialLane`: a tick that finds the lane busy is skipped, and a **Run now** waits its turn.
Each tick does two things, in order:

1. It claims each due slot: it saves a new queued run before it starts anything.
   Slots missed while the dashboard was closed or the Mac slept coalesce into one run at the next tick.
2. It starts the queued runs, oldest first.
   A prompt goes through `Bots.message` in `src/server/bots.ts`, the path the Bot page's composer takes: a follow-up to the Bot's live session, else a resume of its saved one, else its first session in its workspace.
   The run records `sent` with the session it went to; a refusal, such as a Bot that is gone, goes to the run's errors, and the next run tries again.
   A run starts no session of its own, so routines hold no slot cap; the Bot keeps its one conversation, which the runner neither tracks nor ends.
   A command starts through the runner's `exec`, `runShell` in `src/proc.ts`, in the Bot's workspace, and the drain does not wait for it, so a tick never blocks for minutes.
   `runShell` runs `/bin/sh -c` with stderr merged into stdout, keeps the last 64 KB of output, and stops the command after 10 minutes.
   It spawns the shell in its own process group and stops the whole group with SIGTERM, since a command's own children would otherwise keep running and hold the output pipe open.
   When the command ends, the runner writes its exit code, output, and times to the run; a non-zero exit, a stop, or a failed spawn also goes to the run's errors.
   It then posts `commandReport` into the Bot's conversation through `Bots.message`: the routine's name, the command, what triggered it, how it ended, and its output fenced as data.
   The run keeps the output whether or not the post goes through, and a post the Bot refused adds why to the run's errors.
   The runner keeps the routines whose command runs in memory, since a run holds one outcome and later `run-now` claims can push a running command's run out of the saved 10; a command routine whose last command still runs records an error instead of running a second one.

Running a tick twice starts nothing new, since the slot is claimed, and a tick that comes while one runs is skipped.
A crash after a claim loses no queued run, since it is on disk.
A message that had not gone waits for the routine's next slot.
Stopping the server stops every running command, right before it exits, so the result of a command it stopped is never saved as a time-limit stop.
A run saves its command as `running` before the command starts, then as `exited`, `stopped`, or `failed` when it ends.
No command resumes after a restart: the server that owns routines turns each run still saved as `running` into `stopped` by the dashboard, with that error, when it starts or takes over (`RoutineRunner.recover`).

A `routine` socket message carries one change: `save`, `remove`, `enable`, or `run-now`, which claims a slot now, whatever the schedules, and drains it.
Every socket hears the routines after each change and each step of a run as a `routines` message on the roster topic, also sent when a socket opens.
Removing a Bot removes its routines first, in the same `bot` change, and every socket hears both lists.

## Triggers

A trigger is a kind of thing that happened, `slack`, `pull-request`, `event`, or `gmail`, that also starts a run of each enabled routine that lists it.
Triggers add no integration of their own: they read what the bell's checks already fetch, in `src/server/notices.ts`, and the Gmail inboxes the Email page reads through `GmailAccounts.inbox`.
The `Dashboard` wraps four of the `NoticeSources`, `pullRequests`, `slack`, `localEvents`, and `googleEvents`, so each answer also goes, unchanged, through the helpers in `src/server/routine-triggers.ts`, which turn it into sightings.
A sighting has an id that names what it saw in the state it saw it, and a scope, which one answer covers:

- **Pull requests**: each pull request of a repository GitHub answered for whose move is yours, by that move as `moveOf` reads it with the sessions on it, as the bell reads it; scope `pull-request:<owner/repo>`.
  A pull request is new when its move becomes yours or changes to another of yours, so a draft, checks still running, or a session at work on it, such as a Bot pushing a fix, fires nothing until it ends in a move of yours.
- **Slack**: each conversation's newest message that waits on you, by Slack's id for it; scope `slack`.
  While Slack is signed out, the check forgets the scope, so the first answer after signing in sets a new baseline and fires nothing for messages already waiting.
- **Gmail**: each unread conversation of an inbox that answered, by its last message's arrival, so new mail, in a new conversation or an old one, is new; scope `gmail:<account>`.
- **Calendar events**: each timed event that starts within the bell's 10-minute lead, by its event and start, so it is new once as it comes within the lead and again if it moves; scope `event:local`, or `event:google/<account>` for an account that answered.

`TriggerWatch` keeps the ids of each scope's last answer in memory, and keeps the ids it had not seen as news until the `Dashboard` takes them once the check ends, so the sources of one check start one run of a routine.
A scope's first answer since the server started only sets what it knows, so a restart, or what happened while the dashboard was stopped, starts nothing; a scope whose check failed keeps what it knew.
Every server learns its sightings, but only the server that owns routines fires them; another drops its news, and a server that takes over routines forgets what it learned before, so its next answers set a new baseline and a takeover fires nothing old.

`RoutineRunner.fire` claims one run of each routine that watches a kind of the news, holding the first 10 of those events the check listed, then drains, in the same `SerialLane` as ticks and **Run now**.
A run is keyed by its time, so a claim lands at least a millisecond after the routine's newest run.
A prompt run sends the prompt, then the events, fenced as data; a command gets the events as a JSON list in the `ROUTINE_TRIGGERS` environment variable, `[]` for a scheduled run, which `runShell` sets beside the server's environment.
Each event carries its kind, a title, a detail of at most 2,000 characters, and a link when it has one.
The pull request and Slack checks run on the 2-minute activity tick, which checks both while a page listens; while none does, the owner checks only the kinds an enabled routine has a trigger for, by `watchedKinds`, and another server checks nothing.
A page that opens after a tick checked only some kinds checks both again.
On the same tick, the owner reads the Gmail inboxes, 50 conversations each as the Email page lists them, while an enabled routine has a `gmail` trigger, and fires once both reads end.
Calendar events are checked on the minute tick.

## One server runs the unattended work

Servers on different ports share `~/.config/omp-agents`: your app and a smoke run, say.
Routines, the todo, note, and routine inboxes, the daily clean-up of checked todos, the daily sweep of omp's isolation sandboxes, and the idle stop of sessions' processes write that directory or omp's, or end processes, without anyone asking, so one server at a time runs them.
`OwnerLock` in `templates/omp/agent/extensions/github/owner-lock.ts` decides which, with `server.lock`, a file that holds `{pid, port}` of the owner.
A server creates it whole through a draft file and a hard link, so a reader never sees half of it.
Taking over a dead or invalid owner holds a short ownership lock at `<path>.reap` and rereads the original file before removal, so competing reclaimers cannot remove a new owner's lock.
The same mechanism recovers a crashed reclaimer's lock.
A process id that another program reused keeps the lock held; delete `server.lock` to release it.
At startup a server that does not own the lock logs once which port does, and the minute tick tries again.
On a takeover the server logs it, reads `routines.json` and `todos.json` again, since the previous owner kept saving them, tracks the routine sessions it attached to, fails the runs that were running a command and the scheduled sends left sending, and drains the todo, note, and routine inboxes.
A server that exits normally deletes its lock.
The servers that do not own it still serve their pages, start sessions, and take what you do in them, such as editing a routine, a todo, **Run now**, or a process's **Stop**; only the minute tick's routines, scheduled sends, and isolation sweep, the runs the routines' triggers start, the todo, note, and routine inboxes, the end inbox's requests for sessions started in a terminal, and the process sample's idle and gone-session stops are left to the owner.
Each server keeps its own copy of `routines.json` and `todos.json` in memory and saves whole, so the last server you edited in wins until the owner changes.
`scheduled.json` is the exception: `ScheduledFile` is a `shared` `ReducerFile`, so a send added on any server reaches the owner and only one process can claim it.
Each mutation holds an `OwnerLock` at `<path>.lock` across reload, reduction, and the immediate JSON replacement, so independent server processes keep one another's changes.
A failed shared write rejects the mutation, retains the dirty value and its lock, and releases ownership only after a later flush succeeds or the process exits.
Other processes wait at most five seconds for a mutation lock, then reject rather than write without ownership.

## Isolation sandboxes

omp runs a subagent's isolated task in a sandbox under `~/.omp/wt` (`getWorktreesDir`, which `OMP_WORKTREE_DIR` moves): a directory named after the repository and the task, which holds the owner marker `.omp-isolation-owner.json`, naming the omp process and its start time, and the checkout `m`, `merged` in older sandboxes, a full copy of the repository with its own `.git`.
omp removes a sandbox when its task ends, but one whose omp exited first stays, often gigabytes, and `omp worktree clear` removes those without looking at their changes.
`IsolationSweep` in `src/server/isolation-sweep.ts` removes them more carefully, once a day: the owner's minute tick starts a sweep when none ran for 24 hours, the first one a minute after the server starts or takes over, and does not wait for it, since it runs `git status` in every sandbox, four at a time.
A directory without the marker, such as a pull request's checkout, is no sandbox, and the sweep leaves it alone.
A sandbox stays while omp's `hasLiveIsolationOwner` says its process runs: a process id that is gone, or that another process now holds with a different start time, has exited.
It stays while a live session, idle or waiting ones included, or the server runs in it, by `Worktrees.inUse`; while its checkout has a tracked change or an untracked file, by `git status --porcelain --untracked-files=all`; and while its checkout is a linked worktree that Git locked.
It also stays when the sweep cannot read it: a marker that names no process, a checkout that is not a Git checkout of its own, or a git call that fails, such as a `git status` that takes over two minutes.
Commits that no remote has do not keep a sandbox, since the copy carries every local branch of the repository it copies, so nearly every sandbox has some, and the repository the task ran from keeps those branches.
A commit the task itself made, which its omp exited before bringing back, goes with the sandbox, as with `omp worktree clear`.
A sandbox with the marker but no checkout, left by an omp that exited while it made one, holds nothing of a task and goes.
Just before it removes one, the sweep asks again whether an omp owns it, since a task run again takes the same directory; then it stops a retained native mount through omp's `stopRetainedMount`, renames the sandbox with the suffix `.omp-agents-removing`, and deletes it, so the next sweep finishes a removal cut short instead of reading half a sandbox.
A mount that will not stop keeps its sandbox.
Each sweep logs one line with how many sandboxes it removed and kept, by reason, and one more for each it could not read or remove.
