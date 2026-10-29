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
_Avoid_: Child agent, worker

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

**Get started**:
The step-by-step setup for a model-provider sign-in and a first session, with optional steps between them, available as a page and automatically on a vacant first-run home.
Its checks reflect real setup; only its dismissal and the step on screen stay on this computer.
_Avoid_: Onboarding, tour, checklist

**Roster**:
The list of running, interrupted, pinned, and past sessions in the sidebar.
_Avoid_: Session list, inbox

**Workspace**:
A repository's main checkout, or a directory outside git, that sessions run in, which the sidebar's picker filters by; a session in a linked git worktree counts in its repository's workspace.
_Avoid_: Project, repo, folder

**Pin**:
A session id the server keeps at the top of the roster in every window.
_Avoid_: Favorite, bookmark

**Notice**:
An entry under the bell: what a check found or how an update went.
_Avoid_: Alert, notification (reserved for session notifications)

**Review draft**:
The review a **Review** session saved of one pull request, with its verdict, summary, and findings, which waits in the dashboard for the user to accept, edit, and post.
_Avoid_: Pending review (GitHub's own unsubmitted review), draft review

**Note**:
A Markdown entry on the Notes page, optionally linked to a top-level todo.
It is separate from a todo's notes field.

**Activity**:
What the page records of how its user uses the dashboard, by registry id only, which Settings › Activity reports.
_Avoid_: Usage (omp's requests, in Analytics), analytics, telemetry

## Unattended work

**Routine**:
A task a Bot does on its schedules, its triggers, or both: a message into its conversation, or a shell command in its workspace.
Every routine belongs to one Bot.
_Avoid_: Cron job, automation

**Trigger**:
What also starts a routine's run when something new happens: a Slack message waiting on you, a pull request changing status, a calendar event about to start, or unread mail in Gmail.
The run gets what the trigger saw.
_Avoid_: Hook, webhook, event listener

**Bot**:
A named teammate with one conversation you come back to, a job, and a memory that only its `remember` tool writes.
_Avoid_: Agent, assistant, persona

**Scheduled send**:
One message to a session, or one new session's start, that waits for a time.
_Avoid_: Delayed message, routine

**Owner**:
The one server that holds `server.lock` and runs the unattended work.
_Avoid_: Leader, primary

## Distribution

**Starter kit**:
The optional omp setup in `templates/omp/` that one command installs into omp's agent directory.
_Avoid_: Template, preset, config pack

**Workflow**:
An omp skill whose `SKILL.md` frontmatter names `workflow` in `metadata.tags`, such as the starter kit's `ship`, which Settings › Workflows lists and edits; a command of the same name starts it.
It is not a GitHub Actions workflow under `.github/workflows/`.
_Avoid_: Playbook, procedure, pipeline
