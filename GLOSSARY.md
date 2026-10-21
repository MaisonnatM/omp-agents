# omp-agents

A local dashboard that lists, streams, and drives every omp session on one machine.
These are the words the interface, the docs, and the code use for its concepts.

## Sessions

**Session**:
One omp conversation, identified by its session id and kept in its session file.
_Avoid_: Chat, thread, agent run

**Terminal session**:
A session whose omp runs in a terminal, which the dashboard reaches through its Collab room.
_Avoid_: CLI session, external session

**Dashboard session**:
A session whose omp the dashboard started in RPC mode, under a keeper.
_Avoid_: Managed session, RPC session

**Past session**:
A session no omp process runs, read from its session file.
_Avoid_: Closed session, archived session

**Interrupted session**:
A dashboard session whose omp stopped when the dashboard went down, without **End session**, waiting to be resumed.
_Avoid_: Crashed session, orphan

**Subagent**:
A session that another session's `task` call spawned.
_Avoid_: Child agent, worker (see **Worker**)

**Isolation sandbox**:
The directory under `~/.omp/wt` where omp runs a subagent's isolated task, with a marker naming the omp process that owns it.
_Avoid_: Workspace (see **Workspace**), worktree

**Keeper**:
The detached process that holds one dashboard session's omp and lends its stdio to one server at a time.
_Avoid_: Daemon, supervisor

## Collab

**Host**:
The omp process that runs a terminal session and owns its Collab room.

**Guest**:
A participant that joins a host's room; the dashboard joins every room as the guest `omp-agents`.
_Avoid_: Client, viewer

**Room**:
The Collab channel through which a host shares one session with its guests.

## Interface

**Roster**:
The list of running, interrupted, pinned, and past sessions in the sidebar.
_Avoid_: Session list, inbox

**Workspace**:
A working directory that sessions run in, which the sidebar's picker filters by.
_Avoid_: Project (see **Project**), repo, folder

**Pin**:
A session id the server keeps at the top of the roster in every window.
_Avoid_: Favorite, bookmark

**Notice**:
An entry under the bell: what a check found or how an update went.
_Avoid_: Alert, notification (reserved for session notifications)

**Review draft**:
The review a **Review** session saved of one pull request, with its verdict, summary, and findings, which waits in the dashboard for the user to accept, edit, and post.
_Avoid_: Pending review (GitHub's own unsubmitted review), draft review

## Unattended work

**Routine**:
A task the dashboard runs on one or more schedules: a prompt, a shell command, or a project task.
_Avoid_: Cron job, automation

**Scheduled send**:
One message to a session, or one new session's start, that waits for a time.
_Avoid_: Delayed message, routine

**Project**:
A coordinator session that plans the work and starts worker sessions sharing one notes directory.
_Avoid_: Workspace, repo

**Coordinator**:
The session that plans a project and starts its workers.
_Avoid_: Lead, manager

**Worker**:
A session a project's coordinator started to do part of the work.
_Avoid_: Subagent

**Owner**:
The one server that holds `server.lock` and runs the unattended work.
_Avoid_: Leader, primary

## Design comparisons

**Comparison**:
One prompt started as several dashboard sessions, each on its own fresh branch and worktree from the same commit, whose screenshots the dashboard shows side by side.
_Avoid_: Variant group, arena, coordinator

**Variant**:
One session of a comparison, with its branch, its worktree, and the screenshot it last published.
_Avoid_: Worker (see **Worker**), candidate

**Winner**:
The variant **Keep this one** kept; its session, worktree, and branch stay, and the other variants stop.
_Avoid_: Champion, merged variant

## Distribution

**Starter kit**:
The optional omp setup in `templates/omp/` that one command installs into omp's agent directory.
_Avoid_: Template, preset, config pack
