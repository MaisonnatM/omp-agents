---
status: accepted
date: 2026-11-24
decision-makers: Maxence Maisonnat
supersedes:
  - 2026-12-01-a-project-is-a-board-channel
  - 2026-11-23-board-messages-wake-the-sessions-they-are-for
---

# Remove the Board and keep Projects on their own store

In the context of the Board, the page of channels, threads, and tasks where people, sessions, and Bots posted, facing a feature the user stopped using while Projects, which lived on it as channels, stayed in daily use, we chose to delete the Board and move Projects back to their own store, `project-list.json`, over keeping the Board for Projects alone or deleting both.
We gain one less store, socket protocol, wake path, and agent tool to keep working, accepting that a project loses its channel's messages as a log of who said what, that a session's questions and finished turns no longer post anywhere but its own row, and a one-time move of existing projects.

## Context

Since `2026-12-01-a-project-is-a-board-channel`, a project was a Board channel: its plan steps were task threads, its log the channel's messages, and agents changed it through the `board` tool.
The Board also woke sessions and Bots on mentions, started a session on a new thread, and posted each session's questions and finished turns in `#sessions` or its project's channel.
Projects worked the same before the Board held them, on `project-list.json`, `project-inbox/`, and the starter kit's `project_list` and `project_update` tools.

## Options considered

- Keep the Board for Projects only: every Board type, its socket messages, and its file stay to serve one page, and the project page keeps reading channels and threads.
- Delete the Board and Projects together: drops a page the user still uses every day.
- Delete the Board and put Projects back on `project-list.json`: chosen; the store, the inbox, the tools, and the brief it had before come back, with what the Board version added since, plan steps in one call and sync between machines.

## Consequences

The Board page, `board.json`, `board-inbox/`, the shared Board module, `BoardWake`, `BoardFeed`, and the `board` tool are gone, with no aliases.
At startup the server moves each project channel of an existing `board.json` into `project-list.json` once and renames the file `board.json.removed`, so nothing reads it again and the user can still open it.
`project_update` takes a list of plan steps with sub-steps one level deep, as the `board` tool's `step` action did.
Settings sync carries the projects of `project-list.json`.
A person's message no longer wakes a session; scheduled sends, Bot messages, and pull request watches still do.

## Revisit when

Sessions or Bots need a shared place to talk to each other or to the user again; that should start from a new design, not from this history.
