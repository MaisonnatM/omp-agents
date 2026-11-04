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

**Goal**:
An objective omp tracks for one session, with running, paused, budget-reached, and complete states and optional token accounting limits.
By default a dashboard goal advances with your prompts; automatic continuation is an explicit omp setting.
_Avoid_: Task (the agent's todo item), mission

**Advisor**:
The passive reviewer or reviewers configured by omp's advisor model role or WATCHDOG roster, enabled per session.
_Avoid_: Subagent, critic

**Past session**:
A session no omp process runs, read from its session file.
_Avoid_: Closed session, archived session

**Cold session**:
A past session that omp's cleanup gzipped into its archive; the roster, History, and Resume no longer list it.
_Avoid_: Past session when referring to an archived file, deleted session

**Interrupted session**:
A dashboard session whose omp stopped when the dashboard went down, without **End session**, waiting to be resumed.
_Avoid_: Crashed session, orphan

**Private session**:
A dashboard session deleted with everything omp wrote for it once its omp stops, whether by **End session**, omp's `end_session` tool, or a crash; it never becomes a past or interrupted session.
_Avoid_: Incognito session, temporary session, ephemeral session

**Personal session**:
A session that runs in the dashboard's personal directory instead of a workspace, for the user's own life, such as meals or plans, and reads and writes the **Personal memory**.
_Avoid_: User session, assistant session, private session (see **Private session**)

**Subagent**:
A session that another session's `task` call spawned.
_Avoid_: Child agent, worker

**Agent definition**:
The named prompt, declared tools, and model choices omp discovers for a kind of subagent, which Settings › Agents previews before a new session starts.
It is not a running subagent or a Bot.
_Avoid_: Worker, Bot type

**Isolation sandbox**:
The directory under `~/.omp/wt` where omp runs a subagent's isolated task, with a marker naming the omp process that owns it.
_Avoid_: Workspace (see **Workspace**), worktree

**Keeper**:
The detached process that holds one dashboard session's omp and lends its stdio to one server at a time.
_Avoid_: Daemon, supervisor

**Project memory**:
The decisions, facts, and lessons the sessions of one git repository share through the starter kit's `project_memory` tool, kept on `refs/omp/memory`, with the brief and catch-ups that tell each session what other sessions landed and remembered.
It is separate from omp's own memory and from a Bot's memory.
_Avoid_: Shared memory, team memory, knowledge base

**omp memory**:
What omp itself recalls across sessions of a workspace, through the store its `memory.backend` setting picks, which Settings › omp memory shows and edits.
It is separate from project memory and from a Bot's memory.
_Avoid_: Memory (bare), Agent memory, Long-term memory

**Personal memory**:
The facts about the user that every personal session reads at each turn and that only their `remember` tool appends, kept in `personal-memory.md`.
It is separate from project memory, omp memory, and a Bot's memory.
_Avoid_: User memory, profile

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
The step-by-step setup for a model-provider sign-in and a first session, with optional steps between them, in a dialog that opens at `#get-started` and automatically on a vacant first-run home, and that closes into a bottom-right bubble until setup is done or skipped.
Its checks reflect real setup; only its dismissal, its closed state, and the step on screen stay on this computer.
_Avoid_: Onboarding, tour, checklist

**Roster**:
The list of running, interrupted, pinned, and past sessions in the sidebar.
_Avoid_: Session list, inbox

**Workspace**:
A repository's main checkout, or a directory outside git, that sessions run in, which the sidebar's picker filters by; a session in a linked git worktree counts in its repository's workspace.
_Avoid_: Project, repo, folder

**Project code**:
The extensions, hooks, tools, TypeScript slash commands, MCP servers, settings, and language server configs a repository commits for its own sessions, which omp would run with your permissions; skills, agents, and rules are prompt text, not project code.
_Avoid_: Project setup, plugins

**Trusted project**:
A repository's main checkout, or a folder outside git, whose project code you trusted piece by piece in the trust dialog, each piece by its contents, so a new or changed piece asks again; every worktree of the repository shares its trust.
_Avoid_: Allowed project, approved folder, trusted workspace

**Pin**:
A session id the server keeps at the top of the roster in every window, or a Bot it keeps under **Pinned** at the top of the Bots tab and the gallery.
_Avoid_: Favorite, bookmark

**Section**:
A named group of Bots in the Bots tab and the gallery, which exists while a Bot names it.
_Avoid_: Folder, category

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

**Starter**:
A short-labelled button under a new session's composer while the draft is empty, whose click puts its full prompt in the composer without sending it.
It is not the **Starter kit**.
_Avoid_: Template, preset, suggestion (the replies' **Suggestions:**)

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

**Bot type**:
What a Bot is for, picked when it is made and kept after: **Bot designer**, **Routines**, or **PR shepherd**.
The code calls it the Bot's `kind`.
_Avoid_: Bot class, role

**Bot designer**:
A Bot type that asks a few questions about the Bot you want, then creates it; the New Bot form starts on one named Dr Eggbot.
_Avoid_: Bot builder, Bot factory

**Bot message**:
A message one Bot sends another, which wakes it to handle the message and lets it answer back later with one of its own.
_Avoid_: Handoff, DM

**PR shepherd**:
A Bot type that drives your approved pull requests to merged: it starts quick-action sessions to fix them, then queues their merge.
_Avoid_: Babysitter, merge bot

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
An omp skill whose `SKILL.md` frontmatter names `workflow` in `metadata.tags`, such as the starter kit's `ship`, which Settings › Workflows lists; authored workflows are editable and packaged workflows are read-only.
It is not a GitHub Actions workflow under `.github/workflows/`.
_Avoid_: Playbook, procedure, pipeline

**Extension package**:
An installed marketplace plugin, npm/git/linked plugin, or registry skill, identified separately for its user or project scope.
_Avoid_: Loaded extension, workflow

**Contribution**:
A skill, command, agent, hook, tool, MCP server, rule, prompt, or executable extension supplied by a package or discovery source; being discovered for a workspace does not mean it is loaded in a running session.
_Avoid_: Plugin, package
