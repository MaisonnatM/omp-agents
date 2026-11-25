# Projects

A **Project** is a named effort that spans sessions and workspaces, with a goal, a checklist plan, decisions, and a dated log that every session in it receives at start.
It is a stored module: `PROJECTS_MODULE` in `src/projects-module.ts` and `PROJECTS_PAGE` in `web/components/projects/module.ts`; see [Modules](modules.md).
See [Give a multi-session effort a project brief and a roster group](../decisions/2026-11-20-give-a-multi-session-effort-a-project-brief-and-a-roster-group.md), and [Remove the Board and keep Projects on their own store](../decisions/2026-11-24-remove-the-board-keep-projects-on-their-own-store.md) for why projects left the Board.

## The file

A project made from a Board's **Projects** tab carries that Workspace's directory in `workspace`, which `workspaceSlice` in `web/components/board/tabs.tsx` matches; a project without one, made on the Projects page or by `project_update`, shows in a Workspace's tab while one of its sessions ran there.
`ProjectList` in `src/shared/projects.ts` holds every project, archived ones included, each with its steps, decisions, log, and the ids of its sessions.
Steps are one flat list in plan order; a sub-step names its step in `parentId`, `add-step` places it after its step's last sub-step, and refuses a parent that is missing or is a sub-step itself, so a plan nests two levels at most.
`remove-step` removes a step's sub-steps with it, and `stepNumbers` numbers them `2.1` and on, for the page and, in the kit's copy, for the brief and `project_update`'s `step` and `parent` params.
`ProjectsFile` keeps it in `project-list.json` beside the access token with `ReducerFile`, so the server is its only writer and the page hears it as a `module` message on every change.
The name is not `projects.json`, which an older version kept the workspaces in.

When the store opens at startup, `migrateBoardProjects` in `src/server/project-migration.ts` moves the projects of a `board.json` that an older version left into the list, once.
Each channel carrying a project becomes a project with the channel's id and name, its goal, decisions, session ids, and dates; its task threads become steps in plan order, done when their task was, a sub-step's parent thread its `parentId`; and its messages, oldest first, become log lines, signed with the session that wrote them.
A project the list already holds is left as it is, and once the list is saved the file is renamed `board.json.removed`, so nothing reads it again; the Board's other channels, threads, members, and schedules are dropped, and the unused `board-inbox/` beside it is deleted.

`applyProjectChange` is the reducer the server applies and the page applies before the server answers.
A change that changes nothing returns the same list, so a repeated change, such as a second tick or a second join, writes nothing.
A session is in one project at most: `join` takes it out of any other, and `leave` takes it out of its project.
`parseProjectChange` reads the page's changes, holding a name to 200 characters and a goal or a line to 4000.

## Sessions

A new-session start may carry a `projectId`; once omp starts, `src/server/start.ts` calls `StartEnv.joinProject`, which the dashboard applies as a `join`, before it sends the first message.
The roster's **Projects** group is drawn by `projectGroups` in `web/sessions.ts`, which takes each open project's pinned, live, and interrupted rows out of the lists the workspace folders and **Pinned** draw from; ended rows stay in **Past**.
It runs on the lists after the workspace filter and the search, so a project folder shows what the roster would show.

## The agent side

The starter kit's `project` extension in `templates/omp/agent/extensions/project.ts` reads `project-list.json` and never writes it.
Before a prompt, it finds the open project whose `sessionIds` hold the session, after `withWaiting` folds in the changes still waiting in the inbox, so a session that just joined or added a step sees it while the dashboard is down, and adds `briefText` from `project/brief.ts` as a hidden message, once at the start and again only when the text changed.
`project_list` lists every project, and `project_update` leaves one change per call in `project-inbox/`, which `ProjectsInbox` drains while its server owns the lock.
An agent may make every change the Projects page makes, on any project, with `projectId` naming one and the session's own project as the default; `parseProjectChange` sets aside only a malformed change, and `applyProjectChange` one the list refuses.
A log line from an agent carries its session's id, which the page and the next brief show as its author.
