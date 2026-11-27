# Session processes

The server lists what every live session runs besides omp, for the Browser's dev servers, and stops those processes on request, once their sessions have been idle long enough, and once their session leaves the roster.
`SessionProcessWatch` in `src/server/session-processes.ts` does all three, so there is one path that stops a session's processes.

## What counts as a session's process

omp's bash tool runs in omp's own process: each command it runs, foreground or async, is a child of omp that leads its own process group, and so do omp's Python kernels and private browsers.
Each such group is a job, listed by its top process, the group's leader, and stopped as a whole.
omp's stdio MCP servers are children of omp in omp's own process group: they are omp's helpers, not something the session started, so the list only counts their memory and CPU with omp's, and they end with the session.
Under the [lazy MCP patch](omp-modules.md), which the dashboard turns on with `OMP_MCP_LAZY=1`, a session runs a stdio MCP server only from its first call to that server's tools until 10 idle minutes pass, so most sessions run none; a browser server, once called, runs until the session ends.
omp starts its shared workers, whose commands begin with `__omp_worker_`, such as its per-user daemon, the blob broker, or the LSP multiplexer, as children of whichever omp first needs them, and they serve every omp of the project or the machine.
`descendants` in `src/process-census.ts` skips them and everything under them, for the list, the keeper's census, and `stopTree` alike; `OMP_WORKER_PREFIX` names the prefix omp's `cli/worker-selectors.ts` gives every worker.
A service is a `proc` unit omp's per-user daemon runs in a project's scope: a dev server the bash tool or the Browser's **Start dev server** started with a `name`, or omp's shared headless browser.
It runs under the daemon, not under omp; one the bash tool starts ends with its session unless omp's `launch.persist` setting keeps it, the shared browser ends once no omp holds it, and one **Start dev server** starts runs until something stops it.
`ompDaemons` in `src/omp/daemons.ts` lists them with the daemon's `list` operation over omp's `probeDaemon`, which never starts the daemon, keeps the ones it supervises that have not ended, and stops one generation through the daemon's `stop` with the unit's id, its generation, and a 3-second timeout.
A service whose unit names an owner belongs to the session with that omp session id, and to the live session that took the id over with `/new`.
A service with no owner, such as the shared browser, is shared: it serves every live session whose directory resolves, through omp's `canonicalProjectDir`, to the unit's project.
A Docker container that a session started detached is not listed: Docker Desktop records no client process, and compose's working directory label names the main checkout even for a run from a worktree, so nothing ties a container to a session.
A foreground `docker compose up` or `docker run` is a process group under omp, so it lists and stops as any job.
A command that starts a server in the background, such as with `nohup … &`, and exits leaves the server to launchd, or to init on Linux, so it runs under no omp; only a parent pid of 1 counts as adopted, so a Linux `systemd --user` subreaper's orphans are not found.
omp's bash tool sets `PI_SESSION_FILE` in each command's environment, and every process the command starts inherits it.
So the watch reads that variable once from each process launchd or init adopted, through `readSessionFiles` (`ps -E` on macOS, `/proc/<pid>/environ` on Linux), and lists the process and everything under it as a job of the live session whose file it names, or whose subagent's file, in the directory named after the session's file, it names.
Such a job joins the session's job of the same process group, if one runs, and the idle stop and [the cleanup of a session that leaves the roster](#sessions-that-leave-the-roster) stop it as any job.
A tree that holds a session's omp or this server, such as a keeper or a dashboard a session started, is never a job.
An app that `open` started inherits the variable too, but launchd gives it its own `XPC_SERVICE_NAME`, `application.<bundle id>.…`, so `parseSessionFiles` leaves out a process whose service name starts with `application.` and differs from the server's: Docker Desktop that a session opened stays yours.
A background server whose session ended while no dashboard ran is no live session's, so it keeps running; the decision [A session owns the servers it detached](../decisions/2026-11-25-a-session-owns-the-servers-it-detached.md) says why.

## Sampling

The server that holds the owner lock samples every 15 seconds, whether a page listens or not, and every server samples again for each stop and for each `GET /api/session-processes` that finds no sample under 2 seconds old (`LIST_REUSE_MS`): one `ps -A -o pid=,ppid=,pgid=,rss=,pcpu=,lstart=,args=`, run without blocking the server through `readProcessTable` in `src/process-census.ts`, and one `list` of the daemon's `proc` units.
Every open window polls the list every 5 seconds, so windows that poll within 2 seconds of each other share one `ps` and one `lsof`; a stop answers from a sample taken after it.
`pcpu` is `ps`'s percent of one core, which macOS reads as an average that decays over the last minute, and `LC_ALL=C` keeps its decimal point a dot.
Samples run one at a time.
A job's id is its process group and its top process's start time, and a service's id is its unit's id and generation, so a stop of an id that no longer runs, or now names another process, stops nothing and answers the current list.
A job stops through `terminate`: SIGTERM to each member, then SIGKILL after 3 seconds to those still running under the same start time, so a reused pid is never hit.
A `ps` that fails fails the sample rather than reading as nothing running.
The same sample runs one `lsof` over every TCP listener of the user's processes (`LISTENERS_ARGV` and `parseListeners` in `src/process-census.ts`), beside `ps`, and each job and service gets the ports its processes listen on, which the [Browser](../usage/browser.md) offers as dev servers.
`lsof` exits with 1 when none listens, which reads as no ports; an `lsof` that fails or is missing leaves every port list empty and the rest of the sample stands.
On Linux, a missing `lsof` is read from `/proc` instead, for the ports, the working directories, and the files a uv prune must keep.

## HTTP

`GET /api/session-processes` answers a `LiveSessionProcesses` from `src/shared/processes.ts` for every live session, in roster order: its instance id, omp's own memory, CPU, and process count, the jobs and services, biggest memory first, each with its id, kind, label, memory, CPU, process count, start, whether it is shared, and its `stopsAt`, and its `otherPorts`, the ports the Browser leaves a sign-in on.
`otherPorts` lists every listening port but those of the session's unshared jobs and services and those another checkout of the same app listens on: the same `git` common directory and path in it as one of the session's servers, read from each listener's working directory with `lsof` and kept per directory.
The memory and CPU of omp, a job, or a service are sums over its processes, and memory is each process's macOS footprint from one `top -l 1 -stats pid,mem`, which counts the compressed and swapped pages an idle omp mostly holds, falling back to `ps`'s resident memory where `top` gives none; and a shared service shows under every session it serves.
`PUT /api/session-processes/stop` takes `{ instanceId, id }`, checked by `parseProcessStop` in `src/server/wire.ts`, and answers the same list after the stop; a stop for a session that no longer runs stops nothing.
With `id` `"stray"` (`STRAY_STOP_ID`), it ends the [stray](#strays) whose keeper id is `instanceId`, unless another live server holds it.
`PUT /api/session-processes/start-server` takes `{ instanceId }`, checked by `parseDevServerRequest`, starts that live session's dev server as [Start dev server](#start-dev-server) says, and answers a `DevServerStart`: `{ started: { port, command } }`, or `{ fallback }` with why it could not; a session that no longer runs answers an error.
`GET /api/process-settings` answers the `ProcessSettings`, and `PUT /api/process-settings` takes them, checked by `parseProcessSettings`, and answers them as saved.
`GET /api/resources` answers a `ResourcesView` from `src/shared/resources.ts`: the latest `MemoryReading`, a `Footprint` per owner with its memory, process count, and whether **Stop** applies, the ladder of what stops next under pressure, the automatic stops since the server started, and the build and test slots.
`GET /api/resources/history?hours=` answers the `ResourceSample`s of the last `hours`, 24 when absent, at most the 14 days the history keeps, oldest first.

## Memory reading and history

Each sample also reads this Mac's memory: `readMemory` in `src/memory-reading.ts` runs one `sysctl -n kern.memorystatus_vm_pressure_level kern.memorystatus_level vm.swapusage hw.memsize` and one `vm_stat`, and takes the swap-out rate from the change in `vm_stat`'s Swapouts since the last reading.
`pressureOf` turns the kernel's level, the share of memory available, and the swap-out rate into `normal`, `warn`, or `critical`: below 20% available, 128 MB a minute swapped out, or the kernel's warning reads `warn`, and below 8%, 512 MB a minute, or the kernel's critical level reads `critical`.
A rise counts at once, a fall only after two calm readings in a row, so the pressure does not flap; a read that fails reads `unknown`, which stops nothing on the ladder but holds unattended work.
`ResourceHistory` in `src/server/resource-history.ts` keeps one `ResourceSample` a minute in `~/.config/omp-agents/resources/`, one JSON Lines file per UTC day, and deletes the files older than 14 days on the first write of a day.
Each sample carries the Jetsam events since the one before, read from macOS's `/Library/Logs/DiagnosticReports/JetsamEvent-*.ips` reports: when, the largest process, and how many processes macOS killed for memory rather than idle exit; a report it cannot read is skipped.

## The memory policy

Each sample hands what it found to `decide` in `src/server/memory-policy.ts`, a pure function of the time, the reading, the settings, the live sessions with their clocks, their jobs and services, and the strays.
It answers the stops to make now, the ladder of what pressure stops next, each job's and service's `stopsAt`, the private sessions about to be deleted, and why unattended work waits.
Whatever the pressure, the idle stop and the idle session stop run on the settings' timers, and a stray ends once it has been seen for 10 minutes (`STRAY_GRACE_MS`), long enough for a restarted server to attach to its sessions.
Under `warn` the first owner of the ladder stops each sample, under `critical` the first three, so the next reading says whether more must go; under `normal` and `unknown` the ladder only shows on the Resources page.
The ladder goes cheapest loss first:

- Rung 0: strays seen for a minute (`STRAY_SETTLE_MS`), biggest first, since a session's keeper is unlisted while it starts.
- Rung 1: MCP servers of settled sessions, empty until omp starts them lazily.
- Rung 2: jobs and services whose every session has been idle 5 minutes and waits on no subagent or scheduled check, biggest first.
- Rung 3: dashboard sessions settled 20 minutes under `warn`, 2 under `critical`, oldest first, which then show under Past with their worktree kept.
- Rung 4, under `critical` only: private sessions settled an hour.

A session that works, asks a question, or waits on its work, and what it runs, is never on the ladder.
Each automatic stop is kept, the last 100, with its owner, memory, and why: `idle`, `stray`, or the pressure.

## Strays

`listAllKeepers` in `src/keeper-link.ts` reads every port's keeper directory under the sessions root and keeps the keepers whose recorded pid runs, private when that port's private sessions directory holds the session.
A keeper is a stray when no server lists its session: one in this server's directory that the roster does not list is `unattached`, one of a port no process listens on is `orphan-port`, and one of a port another server listens on is `foreign-live`, which is that server's and never stops here.
`endKept` ends a stray as **End session** does, through its keeper, which reaps what omp started; a keeper that does not greet or exit in 10 seconds is stopped with its tree, and its files go.
A private stray's session is then deleted through `PrivateSessions.purge` of its port; an ordinary one shows under Past.

## Unattended work waits on memory

`SessionProcessWatch.admit` lets what the user starts always go, and holds unattended work, a Board task's session or a routine's run, under any pressure but `normal`, and before the first reading.
`BoardRunner` leaves a held Board task ready and logs why once; its sweep starts it once the hold ends.
`RoutineRunner` leaves due runs queued and logs why once; the next tick starts them, and **Run now** does not wait.

## Start dev server

The Browser's **Start dev server** starts a session's dev server without a model turn, as a service the session owns, so it lists, stops, and idles out as a service the session's bash tool started does.
`startDevServer` in `src/server/dev-server.ts` works in the session's `worktree`, else its `cwd`, and reads the files of `ROOT_FILES` there: `package.json`, the lockfiles of `LOCKFILES`, and the env files of `ENV_FILES`.
`planDevServer` answers a reason instead of a command when the script runs several servers (`SEVERAL_SERVERS`), sets its own port (`PINNED_PORT`), or an env file points a variable at a server on this computer (`LOCAL_SERVER_ENV`), such as an API, which the start would not run and which may be another checkout's.
Otherwise it turns them and a port into the command: the `dev` script, else `start`, run by the package manager the first lockfile of `LOCKFILES` names, else npm, with `PORT` set and, when the script's last command is a server in `PORT_FLAG_COMMANDS`, `--port`, after `--` for npm.
The port is a random one from 20000 to 39999 that binds on 127.0.0.1 a moment before.
`startOwnedService` in `src/omp/daemons.ts` then opens, through omp's `daemonClient`, which starts omp's per-user daemon when none runs, a `proc` unit `dev-<port>` in the project's scope: the command in the shell omp's settings for the directory give its bash tool, from `getShellConfig`, as omp's `startService` builds it, with `PORT` in its environment, in a pseudo-terminal, owned by the session's omp session id, replacing one of the same name, kept until stopped rather than on the dashboard's connection, and ready once the port accepts a connection on 127.0.0.1, within 30 seconds.
The daemon answers once the service is ready, its readiness timed out, or it ended; one that ended answers with its last 40 lines of output from a `logs` request.
A daemon that fails answers its error as the reason, as a server that ended does; a failure to read the project or find a free port is the dashboard's own, and shows as an error instead of going to the session.
A service that runs counts as started, ready or not, and the page loads `http://localhost:<port>`.
No `package.json`, no script, a service that ended, and an error from the daemon answer `fallback`, and the page then sends the session its old prompt with that reason appended, so the model starts the server instead.

## The idle stop

Each live session has an idle clock: the time of the last sample that saw it anything but `idle`, so a session that waits on an answer counts as busy.
A process's idle stop time is the setting's minutes after the latest of its own start and the idle clocks of the sessions it serves, and there is none while one of them is busy.
A job and an owned service serve their session, and a shared service every live session of its project, so the shared browser stops only once all of them have been idle that long.
`ProcessSettingsFile` in `src/server/process-settings-file.ts` keeps the setting in `processes.json` beside the access token, as `{ stopIdleAfterMinutes, stopIdleSessionsAfterHours }`.
The minutes are one of `null` for off, 15, 30, 60, and 120, 30 by default, and the hours one of `null` for off, 4, 12, 24, and 72, 12 by default.
A file without the hours, saved before [the idle session stop](#the-idle-session-stop) existed, takes their default; a file that holds anything else moves to `processes.json.invalid`.
It is a shared `ReducerFile` and each sample reads it again, so a choice saved on any server reaches the one that stops processes.

## The idle session stop

Each live session also has a settled clock: the time of the last sample that saw it anything but `idle`, or `idle` while it waits on a running subagent (`awaitsSubagents` in `src/shared/sessions.ts`).
A server that first sees a session settled starts the clock at the last write of its session file, if that is earlier, so a restart of the dashboard does not put a long-idle session's stop off by a day.
Once the setting's hours have passed on that clock, the watch ends the session through `DashboardSession.end`: the keeper stops omp and the processes under it, and the exit reports as ended.
The session then leaves the roster and shows under Past with its worktree kept, and **Resume** continues it; nothing of **End session** runs, so no worktree is removed and no auto-continue is cancelled.
A bare signal to omp would report as an exit that was no end, and put the session under Interrupted instead.
Only a session this server started stops so: a terminal session runs in your terminal.
A private session stops too, which deletes it, so the bell names it from five minutes before as a `private-deleting` notice, and any use in between resets its clock.
See [the decision](../decisions/2026-11-16-an-idle-session-stops-its-omp-and-keeps-its-worktree.md) and [the private one](../decisions/2026-11-27-a-private-session-ends-at-the-idle-hours-after-a-notice.md).

## Sessions that leave the roster

The watch remembers, for each live session, its omp's pid and start time, the jobs it last saw under it, and every omp session id it had.
When a session leaves the roster while its omp still runs, the watch keeps that memory, since the session may come back.
Once its omp no longer runs, the watch stops the services the session owned and the jobs it last saw, which omp's exit left reparented, and forgets it.
The keeper already stops a dashboard session's jobs when it ends; stopping them again by pid and start time is harmless, and it covers terminal sessions and a dashboard session's services, which run under the broker.

## One server stops

Only the server that holds the owner lock stops idle processes, ends idle sessions and strays, applies the ladder, and stops what a gone session left, as with the rest of the unattended work; see [One server runs the unattended work](routines.md#one-server-runs-the-unattended-work).
Another server samples only when a page asks, lists no stop time, and still stops a process when you press **Stop**.
A server lists omp's registry of terminal sessions again only while a page listens, so with no page open a terminal session that ended stays on the roster, and its cleanup waits, until a page opens.
