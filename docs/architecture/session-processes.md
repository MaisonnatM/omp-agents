# Session processes

The status bar's CPU card lists what every live session runs besides omp, and the server stops those processes on request, once their sessions have been idle long enough, and once their session leaves the roster.
`SessionProcessWatch` in `src/server/session-processes.ts` does all three, so there is one path that stops a session's processes.

## What counts as a session's process

omp's bash tool runs in omp's own process: each command it runs, foreground or async, is a child of omp that leads its own process group, and so do omp's Python kernels and private browsers.
Each such group is a job, listed by its top process, the group's leader, and stopped as a whole.
omp's stdio MCP servers are children of omp in omp's own process group: they are omp's helpers, not something the session started, so the card only shows their memory and CPU with omp's, and they end with the session.
omp starts its shared workers, whose commands begin with `__omp_worker_`, such as a project's daemon broker, the blob broker, or the LSP multiplexer, as children of whichever omp first needs them, and they serve every omp of the project or the machine.
`descendants` in `src/process-census.ts` skips them and everything under them, for the card, the keeper's census, and `stopTree` alike; `OMP_WORKER_PREFIX` names the prefix omp's `cli/worker-selectors.ts` gives every worker.
A service is a daemon the project's broker runs: a dev server the bash tool or the Browser's **Start dev server** started with a `name`, or omp's shared headless browser.
It runs under the broker, not under omp, and outlives the session that started it while any omp stays in the project, which with sessions the dashboard keeps running is forever.
`ompDaemons` in `src/omp/daemons.ts` lists them with omp's own `collectReports` from `cli/ps-data.ts`, which never starts a broker, keeps the ones a live broker supervises that have not ended, and stops one generation through the broker's `stop` with its id and a 3-second timeout.
A service whose snapshot names an owner belongs to the session with that omp session id, and to the live session that took the id over with `/new`.
A service with no owner, such as the shared browser, is shared: it serves every live session whose directory resolves, through omp's `canonicalProjectDir`, to the broker's project.
A Docker container that a session started detached is not listed: Docker Desktop records no client process, and compose's working directory label names the main checkout even for a run from a worktree, so nothing ties a container to a session.
A foreground `docker compose up` or `docker run` is a process group under omp, so it lists and stops as any job.

## Sampling

The server that holds the owner lock samples every 15 seconds, whether a page listens or not, and every server samples again for each `GET /api/session-processes` and each stop: one `ps -A -o pid=,ppid=,pgid=,rss=,pcpu=,lstart=,args=`, run without blocking the server, and one `collectReports`.
`pcpu` is `ps`'s percent of one core, which macOS reads as an average that decays over the last minute, and `LC_ALL=C` keeps its decimal point a dot.
Samples run one at a time.
A job's id is its process group and its top process's start time, and a service's id is its broker's runtime directory, its name, and its generation, so a stop of an id that no longer runs, or now names another process, stops nothing and answers the current list.
A job stops through `terminate`: SIGTERM to each member, then SIGKILL after 3 seconds to those still running under the same start time, so a reused pid is never hit.
A `ps` that fails fails the sample rather than reading as nothing running.
The same sample runs one `lsof` over every TCP listener of the user's processes (`LISTENERS_ARGV` and `parseListeners` in `src/process-census.ts`), beside `ps`, and each job and service gets the ports its processes listen on, which the [Browser](../usage/browser.md) offers as dev servers.
`lsof` exits with 1 when none listens, which reads as no ports; an `lsof` that fails or is missing leaves every port list empty and the rest of the sample stands.

## HTTP

`GET /api/session-processes` answers a `LiveSessionProcesses` from `src/shared/processes.ts` for every live session, in roster order: its instance id, omp's own memory, CPU, and process count, the jobs and services, biggest memory first, each with its id, kind, label, memory, CPU, process count, start, whether it is shared, and its `stopsAt`, and its `otherPorts`, the ports the Browser leaves a sign-in on.
`otherPorts` lists every listening port but those of the session's unshared jobs and services and those another checkout of the same app listens on: the same `git` common directory and path in it as one of the session's servers, read from each listener's working directory with `lsof` and kept per directory.
The memory and CPU of omp, a job, or a service are sums over its processes, and a shared service shows under every session it serves.
`PUT /api/session-processes/stop` takes `{ instanceId, id }`, checked by `parseProcessStop` in `src/server/wire.ts`, and answers the same list after the stop; a stop for a session that no longer runs stops nothing.
`PUT /api/session-processes/start-server` takes `{ instanceId }`, checked by `parseDevServerRequest`, starts that live session's dev server as [Start dev server](#start-dev-server) says, and answers a `DevServerStart`: `{ started: { port, command } }`, or `{ fallback }` with why it could not; a session that no longer runs answers an error.
`GET /api/process-settings` answers the `ProcessSettings`, and `PUT /api/process-settings` takes them, checked by `parseProcessSettings`, and answers them as saved.

## Start dev server

The Browser's **Start dev server** starts a session's dev server without a model turn, as a service the session owns, so it lists, stops, and idles out as a service the session's bash tool started does.
`startDevServer` in `src/server/dev-server.ts` works in the session's `worktree`, else its `cwd`, and reads `package.json` and which lockfiles are there.
It also reads the env files of `ENV_FILES`, and `planDevServer` answers a reason instead of a command when the script runs several servers (`SEVERAL_SERVERS`), sets its own port (`PINNED_PORT`), or an env file points a variable at a server on this computer (`LOCAL_SERVER_ENV`), such as an API, which the start would not run and which may be another checkout's.
Otherwise `planDevServer` turns them and a port into the command: the `dev` script, else `start`, run by the package manager the first lockfile of `LOCKFILES` names, else npm, with `PORT` set and, when the script's last command is a server in `PORT_FLAG_COMMANDS`, `--port`, after `--` for npm.
The port is a random one from 20000 to 39999 that binds on 127.0.0.1 a moment before.
`startOwnedService` in `src/omp/daemons.ts` then sends the project's broker, through omp's `createDaemonBrokerClient`, which starts a broker when none runs, a `start` of `dev-<port>`: the user's `$SHELL`, else `/bin/sh`, with `-lc` and the command, in a pseudo-terminal, owned by the session's omp session id, replacing one of the same name, and ready once the port accepts a connection on 127.0.0.1, within 30 seconds.
The broker answers once the service is ready, its readiness timed out, or it ended; one that ended answers with its last 40 lines of output from a `logs` request, and the client closes either way.
A service that runs counts as started, ready or not, and the page loads `http://localhost:<port>`.
No `package.json`, no script, a service that ended, and an error from the broker answer `fallback`, and the page then sends the session its old prompt with that reason appended, so the model starts the server instead.

## The idle stop

Each live session has an idle clock: the time of the last sample that saw it anything but `idle`, so a session that waits on an answer counts as busy.
A process's idle stop time is the setting's minutes after the latest of its own start and the idle clocks of the sessions it serves, and there is none while one of them is busy.
A job and an owned service serve their session, and a shared service every live session of its project, so the shared browser stops only once all of them have been idle that long.
`ProcessSettingsFile` in `src/server/process-settings-file.ts` keeps the setting in `processes.json` beside the access token, as `{ stopIdleAfterMinutes }`, one of `null` for off, 15, 30, 60, and 120, 30 by default, and moves a file that holds anything else to `processes.json.invalid`.
It is a shared `ReducerFile` and each sample reads it again, so a choice saved on any server reaches the one that stops processes.

## Sessions that leave the roster

The watch remembers, for each live session, its omp's pid and start time, the jobs it last saw under it, and every omp session id it had.
When a session leaves the roster while its omp still runs, the watch keeps that memory, since the session may come back.
Once its omp no longer runs, the watch stops the services the session owned and the jobs it last saw, which omp's exit left reparented, and forgets it.
The keeper already stops a dashboard session's jobs when it ends; stopping them again by pid and start time is harmless, and it covers terminal sessions and a dashboard session's services, which run under the broker.

## One server stops

Only the server that holds the owner lock stops idle processes and what a gone session left, as with the rest of the unattended work; see [One server runs the unattended work](routines.md#one-server-runs-the-unattended-work).
Another server samples only when a page asks, lists no stop time, and still stops a process when you press **Stop**.
A server lists omp's registry of terminal sessions again only while a page listens, so with no page open a terminal session that ended stays on the roster, and its cleanup waits, until a page opens.
