---
status: superseded
superseded-by: 2026-11-24-remove-the-board-keep-projects-on-their-own-store
date: 2026-11-23
decision-makers: Maxence Maisonnat
supersedes: 2026-11-20-give-a-multi-session-effort-a-project-brief-and-a-roster-group
---

# A project is a Board channel

In the context of Projects and the Board, two stores that both held threads of work, steps to tick, and lines sessions write, facing duplicate concepts and two places to look, we chose to make a Project a Board channel with a project header, its plan steps the channel's task threads and its log the channel's messages, over a Board tab on the project page.
We keep one store, `board.json`, and one agent tool, `board`, accepting a one-time migration and project tools folded into the `board` tool's actions.
This replaces the store part of the 2026-11-20 record; its brief, roster group, and project page stay.

## Context

The project store kept its own file, `project-list.json`, its own inbox, and its own `project_list` and `project_update` tools, while the Board already had channels, task threads, messages, and a tool every session uses.

## Options considered

- Keep both stores and show a Board tab on the project page: two stores, and every log line or step written twice.
- A project is a Board channel carrying `project: ChannelProject` with goal, decisions, session ids, and dates; a plan step is a task thread, with sub-steps one level deep; ticking marks the task done: chosen.

## Consequences

At startup the server moves `project-list.json` into the Board once and renames it `project-list.json.migrated`.
The `board` tool's projects, project, goal, decide, join, leave, step, rename, archive, restore, and reopen actions replace `project_list` and `project_update`.
`BoardFeed` posts a project session's questions and finished turns in its project's channel instead of `#sessions`.
The brief reads `board.json`, skips feed threads, and shows the channel's 10 newest messages.
The Projects page stays as a view of project channels at `#projects`.

## Revisit when

A project needs more than one level of sub-steps, or a session needs to be in more than one project.
