---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# A todo names one workspace, and the todo lists stay global

In the context of the Todo page and the `user_todo` tool, facing todos that belong to a repository such as `~/code/yampa` while every start from a todo ran in the sidebar's workspace, we chose one optional `workspace` field on each top-level todo, the `Workspace.cwd` its sub-todos share, over a `workspace` kind of `UserTodoLink` and over filtering the todo lists by the sidebar's workspace.
**Work on it**, **Plan it**, **Start session**, and the new-session board then start in the todo's workspace, and an agent's directory counts in its repository's main checkout through the same `WorkspacePlacement` the sessions use, accepting that a renamed or deleted checkout leaves a stale path on the todo until someone picks another.

## Options considered

- A `workspace` link kind: links come in any number and open as chips, while a todo starts in exactly one directory.
- Filter every todo list and count by the sidebar's workspace: todos from before this change name no workspace and would leave every list but **All workspaces**, and the lists were documented as not tied to a workspace.
- One field, shown as a property of the open todo and a chip on its row, with the lists unchanged: chosen.

## Revisit when

The user asks to see only one workspace's todos, or a todo needs several repositories at once.
