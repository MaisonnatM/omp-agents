# Projects

A **Project** is a named effort that spans sessions and workspaces: a Board channel carrying a goal and decisions, whose task threads are its plan and whose messages are its log, which every session in it receives at start.
It lives in the Board module, `BOARD_MODULE` in `src/board-module.ts`, kept in `board.json`; the page's `ProjectsPage` is a view of project channels at `#projects` and `#projects/<channelId>`; see [Modules](modules.md).
See [A project is a Board channel](../decisions/2026-12-01-a-project-is-a-board-channel.md).

## The channel

A project channel's `project` field, `ChannelProject` in `src/shared/board.ts`, holds its goal, decisions, the ids of its sessions, `createdAt`, and `archivedAt` once archived; its name is the channel's name.
A plan step is a thread with a task; a sub-step names its step in `parent`, one level deep, and ticking a step marks its task done, unticking marks it open.
`planOf` returns a channel's steps in order and `stepNumbers` numbers sub-steps `2.1` and on; `isProjectChannel`, `openProjectChannels`, and `projectOfSession` find projects.
Creating a project is the `channel` op with `project` set, and adding a step is the `thread` op with an open task.
The ops `rename`, `retitle`, `remove-thread`, which drops a step's sub-steps, messages, and schedules with it, `set-goal`, `archive`, with `at: null` to restore, `decision`, `join`, and `leave` change the rest.
A session is in one project at most: `join` takes it out of any other.

## Migration

At startup the server moves an old `project-list.json` into the Board once, a channel per project, a task thread per step, and a message per log line, then renames the file `project-list.json.migrated`.

## Sessions

A new-session start may carry a `projectId`; once omp starts, `src/server/start.ts` calls `StartEnv.joinProject`, which the dashboard applies as a `join`, before it sends the first message.
The roster's **Projects** group is drawn by `projectGroups` in `web/sessions.ts`, which takes each open project's pinned, live, and interrupted rows out of the lists the workspace folders and **Pinned** draw from; ended rows stay in **Past**.
`BoardFeed` in `src/server/board-feed.ts` posts a project session's questions and finished turns in its project's channel instead of `#sessions`.

## The agent side

The starter kit's `project` extension in `templates/omp/agent/extensions/project.ts` reads `board.json` and never writes it.
Before a prompt it finds the open project channel whose session ids hold the session and adds the brief, the goal, the plan, the decisions, and the channel's 10 newest messages outside feed threads, as a hidden message, once at the start and again only when the text changed.
Agents change projects through the `board` tool's `projects`, `project`, `goal`, `decide`, `join`, `leave`, `step`, `rename`, `archive`, `restore`, and `reopen` actions, on any project they name.
