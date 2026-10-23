# Routines

A routine starts dashboard sessions, or runs a shell command, on one or more schedules. A schedule is every so many minutes, counted from the last run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST. The routine is due at the earliest of them. Two intervals share that last run, so the shorter one decides.
Its task is one prompt, one command, or one `project` task, `{ projectId, prompt }`, which takes no session slot: the run hands the prompt to the project runner's `notify` as an `event` from **Routine** and ends with outcome `project`, or with the error when the project is gone or archived.
The prompt ends with `UNATTENDED`, which tells the session not to ask questions.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops a routine whose task was pull requests.
A prompt task from before `pin` reads as unpinned.
The rest of the file stays.
The next save writes `schedules` and `pin`.
A file that is not a list of routines still moves aside.
`parseRoutineSpec` in `src/routines.ts` checks each routine's fields both for the file and for the socket's `routine` save, so the two hold the same limits.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, and one `outcome`: `pending` from its claim, with whether it is still `queued`; a `session` with the instance and session ids it started; or a `command` with the command's result once it ran.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, a started session a `session` (the first, of the several that a pull request routine's run started), and otherwise `pending`, queued when its `queued` is set or its `queue` list holds an entry.
A run stays queued from its claim until the drain starts its session or command.

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected, and only on the server that owns routines; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Ticks and **Run now** claims share one `SerialLane`: a tick that finds the lane busy is skipped, and a **Run now** waits its turn.
Each tick does three things, in order:

1. It claims each due slot: it saves a new queued run before it starts anything.
   Slots missed while the dashboard was closed or the Mac slept coalesce into one run at the next tick.
2. It starts the queued runs, oldest first, while fewer than 3 routine sessions are busy; a command takes no session slot, so a command run starts even when they are all busy.
   It starts each prompt session through the same `start` the page uses.
   A failed start goes to the run's errors, and the next run tries again.
   A prompt routine whose last session still runs records an error instead of starting a second one.
   A command starts through the runner's `exec`, `runShell` in `src/proc.ts`, and the drain does not wait for it, so a tick never blocks for minutes.
   `runShell` runs `/bin/sh -c` in the workspace with stderr merged into stdout, keeps the last 64 KB of output, and stops the command after 10 minutes.
   It spawns the shell in its own process group and stops the whole group with SIGTERM, since a command's own children would otherwise keep running and hold the output pipe open.
   When the command ends, the runner writes its exit code, output, and times to the run; a non-zero exit, a stop, or a failed spawn also goes to the run's errors.
   The runner keeps the routines whose command runs in memory, since a run holds one outcome and later `run-now` claims can push a running command's run out of the saved 10; a command routine whose last command still runs records an error instead of running a second one.
3. It retires finished sessions: once a session that worked is idle, the runner ends it.
   When the routine's prompt task sets `pin`, the runner first unpins the sessions of the routine's other runs and pins this one through `changePins`, then ends it, so its row moves from **Running** to **Pinned** without passing through **Past**; other pins stay.
   A session ended at the start deadline, or one that is gone, is not pinned.
   A session counts as working from the first time its row shows it working or waiting on a question, at its start, at a tick, or at any change of its row, which the server passes to `observe`.
   `observe` also ends a session as soon as its row shows the turn over, so a finished session frees its slot at once rather than at the next tick.
   Its transcript stays a past session, and **Resume** continues it.
   A session that waits on a question holds its slot.
   A session that is still in its `starting` phase 10 minutes after its start (`SESSION_START_DEADLINE_MS`) never began its turn: the runner records that on the run as an error, releases the slot, and ends the session.

Running a tick twice starts nothing new, since the slot is claimed, and a tick that comes while one runs is skipped.
A crash after a claim loses no queued run, since it is on disk. A start that had not finished waits for the routine's next slot.
A routine's session survives a restart, and `RoutineRunner.recover` tracks it again from the run that started it, once the server attached to the surviving sessions, so it keeps its slot and ends, pinned when its routine asks, once idle.
It counts as working, since its turn may have ended while no server watched; one that never began its turn therefore ends at once, without the start deadline's error.
A run whose session did not survive keeps its `session` outcome, and the session no longer holds a slot.
On a takeover the runner tracks only the sessions this server attached to, since a server attaches only to the sessions started on its own port.
Stopping the server stops every running command, right before it exits, so the result of a command it stopped is never saved as a time-limit stop.
A run saves its command as `running` before the command starts, then as `exited`, `stopped`, or `failed` when it ends.
No command resumes after a restart: the server that owns routines turns each run still saved as `running` into `stopped` by the dashboard, with that error, when it starts or takes over (`RoutineRunner.recover`).

A `routine` socket message carries one change: `save`, `remove`, `enable`, or `run-now`, which claims a slot now, whatever the schedules, and drains it.
Every socket hears the routines after each change and each step of a run as a `routines` message on the roster topic, also sent when a socket opens.

## One server runs the unattended work

Servers on different ports share `~/.config/omp-agents`: your app and a smoke run, say.
Routines, the todo inbox, the daily clean-up of checked todos, and the daily sweep of omp's isolation sandboxes write that directory or omp's without anyone asking, so one server at a time runs them.
`src/server/owner-lock.ts` decides which, with `server.lock`, a file that holds `{pid, port}` of the owner.
A server creates it whole through a draft file and a hard link, so a reader never sees half of it, and it takes over a lock whose process is gone or whose content is not a lock.
A process id that another program reused keeps the lock held; delete `server.lock` to release it.
At startup a server that does not own the lock logs once which port does, and the minute tick tries again.
On a takeover the server logs it, reads `routines.json`, `todos.json`, and `projects.json` again, since the previous owner kept saving them, tracks the routine sessions it attached to, fails the runs that were running a command and the scheduled sends left sending, and drains the todo inbox.
A server that exits normally deletes its lock.
The servers that do not own it still serve their pages, start sessions, and take what you do in them, such as editing a routine, a todo, or **Run now**; only the minute tick's routines, scheduled sends, and isolation sweep, the todo inbox, and the end inbox's requests for sessions started in a terminal are left to the owner.
Each server keeps its own copy of `routines.json` and `todos.json` in memory and saves whole, so the last server you edited in wins until the owner changes.
`projects.json` is the exception: every server runs its own project runner, which writes on every worker turn, so `ProjectsFile` is a `shared` `ReducerFile`, which reads the file again before it applies a change, and a change made on one server keeps what another saved.
`ScheduledFile` is shared the same way, so a send added on any server reaches the owner.

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
