# Projects

- A project is a coordinator session that plans the work and hands it to worker sessions, as Cursor's Projects do.
  The coordinator plans, delegates, and reports, and never changes the project's code: it starts a worker for each change, and for any investigation, research, review, or browser check beyond a quick look, follows what the workers report, and tells you what is done and what waits on you.
  Every session of a project reads and keeps one shared directory of notes, and the notes about you that every project shares.
- The **Projects** page, a `#projects` address, G then P, or **Go to projects** in the command menu, lists the projects.
  On the **Todo** page, G then P picks the focused or open todo's priority instead, as P alone does there; with no todo focused or open, it opens the projects.
  **New project** on that page, the **+** of the sidebar's projects group, or `#projects/new` opens its form: a name, the workspace the coordinator starts in, its model and effort, as on a new session, and its first message, which says what the project is for.
  **Create** starts the coordinator on that message and opens its pane; a name left empty becomes **New project**.
  The project exists once its coordinator runs, so a start that fails leaves none behind.
- The coordinator has six tools that the dashboard serves it, and only it has them.
  `start_worker` starts a worker: a new dashboard session on a prompt that stands alone, with a short title, in the project's workspace or a directory the coordinator names, absolute, `~/`, or relative to the workspace.
  It may also name a model as `provider/id`, an effort, a skill, and a branch.
  In a git checkout a worker gets a branch of its own from the checked-out one, `<project>/<title>-<id>`, unless the coordinator names one or says `none`.
  Workers are numbered `w1`, `w2`, and so on in the order their sessions start.
  A project runs at most 3 workers at once, working or asking, unless you change **At most** on its page, up to 20; the coordinator's other workers wait in a queue, listed on the page, and start in order as slots free up.
  `list_workers` lists the workers, their phases, and the queue, `read_worker` reads one worker's whole last reply and the questions it waits on, and `message_worker` sends one a message as you would: a running worker gets it after its current turn, and a stopped one is resumed first.
  `answer_worker` answers a question a worker asks through `ask`, a yes or no, one of its options, or text, and `end_worker` ends a worker that is done.
- The coordinator starts and ends workers on its own.
  Once its plan is clear, it starts the workers at once, without asking you to approve the plan or to say go, and never hands you a prompt to paste or start yourself.
  It asks you only for a decision that is yours, such as the scope, a product choice, or a merge when your review cadence calls for it.
  When a worker's work is done, its pull request merged or closed or its report leaving it nothing to do, the coordinator ends it in the same turn, then tells you.
  With **Workers' pull requests** on, the dashboard also ends a worker once one of its pull requests merges, as soon as the worker is idle and every pull request it worked on is merged or closed, as **After a merge** in Settings › Source control does for other sessions; an update then tells the coordinator which worker it ended.
  A worker that works or asks stays until it is idle, and a worker the coordinator or the dashboard ends sends no update that it stopped.
  Ending a worker removes its worktree only when nothing in it would be lost, as **End session** does, and deletes its local branch only when the merge took every commit of it.
- The **Sessions** tab lists each project as a collapsible group at the top, under the project's name: the coordinator first, with a **Coordinator** badge, then the workers in order, `w1` first.
  A worker's row reads as the title the coordinator gave it, beside its `w1`, `w2` badge, rather than the title omp generated for the session.
  A project's sessions leave the other groups, **Pinned** included, and the group lists them even in `/tmp`, which the sidebar otherwise hides.
  With a workspace selected, a project shows when it started there or one of its sessions runs or ran there.
  A search that matches a project's name keeps all its rows, and one that matches a worker's title keeps that worker.
- `#projects/<id>` opens one project: its coordinator's status with **Open coordinator**, a table of its workers in order with each one's phase and last reply, the updates still waiting for the coordinator, and its notes.
  A worker's phase is working, asking while it waits on a question, idle, interrupted when it stopped without **End session**, or ended.
  **Notes** shows two trees, **Project** and **User**, each with its folders first and then its files, by name, and its directory under it; click a file to open it in the file dialog.
  **Rename** renames the project, and **Archive** archives it: its group leaves the sidebar, its sessions go back to the other groups, its coordinator's tools refuse to start, list, read, or message workers, and its updates wait.
  **Archive and end its sessions** also ends the project's sessions that run.
  **Unarchive** brings an archived project back and delivers what waited.
- **Subscriptions** on a project's page says what the coordinator hears about on its own, each saved as it changes.
  **Workers' pull requests**, on by default, reports checks that fail or pass again, new comments and reviews, a merge, and a close on the pull requests of the workers' branches.
  **Linear issues assigned to me** reports issues assigned to you that are new or changed, filtered by a team, a label, and a project, each a name or key, empty for any.
  The dashboard looks every 2 minutes, and the first look at each pull request or issue only records it.
  **Ask me to review**, `every PR` by default, tells the coordinator how often to ask you to review, in your own words.
- With a coordinator's pane focused, the right sidebar shows its project rather than the coordinator's own changes: **Workers** lists each worker with its phase and the first line of its last reply, a click opening its session, **Notes** shows the same **Project** and **User** trees, and **PRs** the pull requests its workers submitted or worked on, each once.
- Workers report back on their own, so the coordinator never polls.
  Each time a worker finishes a turn, asks a question, or stops, the dashboard keeps an update for the coordinator; a worker's later finished turn replaces its earlier one, since the coordinator reads only its last reply.
  Once the coordinator runs and is idle, every waiting update reaches it as one message that starts with `[omp-agents] Project update.`, quoting each finished worker's last reply up to 2,000 characters.
  You do not see that message: the coordinator's transcript shows only its reply, which says which worker reported what, and the notices bell's **Projects** tab tells you what needs you.
  Any message that starts with `[omp-agents]` stays out of the transcript, the queued messages above the composer and what ↑ takes back, the conversation search, and a session's title, though the session file keeps it and the model reads it.
  The **Trajectory** shows it inside the turn before it, as a step injected by `omp-agents`, rather than as a prompt of its own.
  An edit of your last prompt would drop the updates after it, so once an update follows it, it is not editable; the coordinator's reply before an update still has **Fork from here**.
  When omp does not take that message, the updates keep waiting, and the coordinator's next change of state, such as its next turn ending, sends them again.
  A worker you prompt yourself reports the same way when its turn finishes.
  A worker is told to end each turn on a report that stands alone, since the coordinator reads only its last reply, and to end its turn with a question it needs answered rather than ask it through the `ask` tool.
  A question a worker still asks through `ask` reaches the coordinator with its request id: it answers it with `answer_worker` when the notes or your preferences settle it, and tells you otherwise.
  The update also says when workers stopped while no dashboard ran; a coordinator that stopped then resumes on its own.
- The notices bell's **Projects** tab tells you when a worker asks and the coordinator is idle or stopped, when a worker stopped without **End session**, and when a project is done: all its workers idle or ended, nothing queued, and nothing waiting for the coordinator.
- A routine can **Send to a project**: each run sends its prompt to the project's coordinator as an update from **Routine**, taking no session of its own.
- A project's notes live in `$XDG_DATA_HOME/omp-agents/projects/<id>/`, `~/.local/share/omp-agents/projects/<id>/` by default, outside every repository, so every worktree the project works in shares them.
  A new project starts with `notes.md`, which holds the name, the goal from the first message, a **Decisions** section, the index of the other notes, and a **Promoted** section, `testing.md` under `docs/` for how to build, run, and test the work, `research.md` beside it for what agents found out, with sources, `internal/checklist.md`, the coordinator's plan, and `archived.md`, for finished work moved out of the other notes.
  `inbox/` holds one Markdown file per outside event, such as a routine's prompt, a pull request's checks, or a Linear issue, named by its time, source, and title, with its source, time, link, and text; the coordinator deletes the file, or moves its line to `archived.md`, once it has handled it, and moves finished checklist items there too.
  The coordinator records what you decide about the project under **Decisions** in `notes.md`, and each worker ends by recording what it learned; what should outlive the project goes under `## Promoted` in `notes.md`.
  A project from an older version keeps its files: when the dashboard starts, `README.md` moves to `notes.md`, `testing.md`, `research.md`, and `preferences.md` to `docs/`, and `checklist.md` to `internal/`, each only when its new place is free, and any other file stays where it is.
- Your own notes, shared by every project, as Cursor's User folder, live in `$XDG_DATA_HOME/omp-agents/user/`, `~/.local/share/omp-agents/user/` by default.
  The dashboard starts them with `preferences.md`, how you work across every project, and `workflows/README.md`, which says to keep one file per way of working that held across projects, such as a new feature's flow or a quality pass; it never overwrites a file there.
  Every session of a project is told to read the project's `notes.md` first, then your `preferences.md` and any workflow that fits its task, and to record a preference that holds beyond the project in your notes and one about this project only in the project's `notes.md`.
- The coordinator may edit and write only the project's notes and yours: its `edit` and `write` calls outside them, and calls whose files the extension cannot tell, are refused, and it is told to start a worker instead.
  Its `local://` and `artifact://` scratch files are allowed.
  Its `bash` calls that redirect or `tee` output to a file outside those notes, and git and `gt` commands that change the checkout or a branch, are refused.
  That shell check is a reminder, not a wall: other commands, such as a script that writes files, still run.
  A subagent has its project session's role and its limits, a `task` subagent included.
- The role text and that limit come from the omp extension `~/.omp/agent/extensions/projects.ts`, which `bun run omp-template` installs.
  When it is not installed, the dashboard loads this repository's copy with `-e` for each project session, so a project works either way.
  The extension adds the session's role and the notes' place to every prompt, so they survive compaction.
- **Resume** keeps a project's session in its project: a resumed coordinator gets its tools back, and the updates that waited while it was stopped reach it once it is idle.
  Resuming it with `omp --resume` in a terminal gives it the role text, when the extension is installed, but no coordinator tools, since only the dashboard serves them.
  A `/move` or an edited prompt, which gives a session a new id, keeps it in its project, and a fork of a project's session belongs to no project.
- The server keeps the projects and their waiting updates in `projects.json` beside its access token, so no update is lost while the coordinator is stopped or the dashboard restarts.
  The project's sessions keep running when the dashboard quits or restarts, and the next dashboard follows them again.
