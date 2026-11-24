# Projects

A **Project** is one effort that runs across many sessions and workspaces, such as a migration or a launch.
It has a goal, a plan of steps to tick, the decisions taken so far, and a dated log.
Every session in it gets that brief when it starts, so a new session knows where the work stands.

## In the sidebar

- **Projects**, its own section above the Workspaces section, holds a folder per open project, level with a workspace's folder; the open project's folder is highlighted.
  A project's folder lists its running, interrupted, and pinned sessions from every workspace, which then leave their workspace's folder and **Pinned**; its ended sessions stay under **Past**.
  The section shows while you have an open project, and its label reads **No projects** otherwise.
- Click a project's name to open its page, `#projects/<id>`.
- **+** beside **Projects** starts a project named "New project" and opens its page with the name selected, ready to type.
- **Move to project** in a session row's menu puts the session in an open project; a session is in one project at most, so this moves it out of any other.
  **Remove from project** takes it out.

## The project page

- `#projects` lists every project in a table, open ones first and archived ones muted after them, with its status, a progress bar of its plan, how many of its sessions run, and its last update; click a name to open it.
  On a narrow page the status and sessions columns fold away.
- An open project's page has an arrow back to the table, and its header says when it started, or when it was archived.
- Edit the project's name and goal in place: Enter or leaving the field saves, Escape drops your edit.
- A strip of four figures sums it up: steps done and left, sessions running out of all, linked pull requests and Linear issues, and its last update, green while it moved today and red once it has been quiet longer.
- **Plan** is a checklist with **To do**, **Done**, and **All** tabs, each with its count: tick a step's box, click its text to edit it, remove it, or add one in the field at the card's foot.
- A step can hold sub-steps, one level deep: the plus button on a step's row opens a field under it, where Enter adds one and Escape closes it.
- Sub-steps are numbered under their step, such as 2.1, and a tab that hides a step still shows it above its sub-steps.
- **Select** turns the boxes into a selection: picking a step picks its sub-steps too, and **Start session** opens a new session in the project with the picked steps already written in its prompt.
- **Sessions** is a table of the project's sessions, running first, each with its status, the pull requests it links, and its last update; hover a name to read it whole.
- **Decisions** lists what was settled, and **Recent activity** lists log lines newest first, each with the session that wrote it, or You; each card adds a line from the field at its foot.
- Removing a step removes its sub-steps too; removing a step or a decision offers **Undo**, and an undone step comes back at the end of the plan, with its sub-steps under it.
- **New session** starts a session already in the project, in the directory you pick; **New project** is on the table's page only.
- **Archive** hides the project from the sidebar and stops its brief; an archived project reads as it was left, and **Restore** brings it back.

## What a session gets

- Before its first prompt, a session in a project gets the brief: the goal, the plan with what is done, the decisions, and the 10 newest log lines.
  When the project changes, its next prompt gets the brief again.
- An agent ticks a step with its `project_update` tool when it finishes one, logs a line on what it did, and records a decision you settle.
- An agent can also list every project with `project_list`, and with `project_update` create one, rename it, set its goal, edit its plan and decisions, archive or restore it, and join or leave it, on any project you name.
  It can add a whole plan, with its sub-steps, in one call.
- Projects you had on the Board, in an older version, move to the Projects page once when the dashboard starts, with their plan, decisions, and messages as log lines.
- These tools come with the starter kit; see [Projects](../architecture/projects.md).
  Subagents, `omp -p`, and `--mode json` get no brief.
