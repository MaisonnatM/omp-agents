---
status: accepted
date: 2026-10-30
decision-makers: user, agent
---

# A todo names one workspace, and the sidebar's workspace scopes the todo lists

In the context of the Todo page and the `user_todo` tool, facing todos that belong to a repository such as `~/code/yampa` while every start from a todo ran in the sidebar's workspace, we chose one optional `workspace` field on each top-level todo, the `Workspace.cwd` its sub-todos share, over a `workspace` kind of `UserTodoLink`.
**Work on it**, **Plan it**, **Start session**, and the new-session board then start in the todo's workspace, and an agent's directory counts in its repository's main checkout through the same `WorkspacePlacement` the sessions use.
The user then asked to see only the selected workspace's todos, so every todo list, the archive too, and every count in the Todo sidebar hold only the todos that name the sidebar's workspace, and **All workspaces** shows them all.
We accept that a todo naming no workspace, as every todo from before this change does, shows only under **All workspaces**, and that a renamed or deleted checkout leaves a stale path on the todo until someone picks another.

## Options considered

- A `workspace` link kind: links come in any number and open as chips, while a todo starts in exactly one directory.
- Keep every list global and show the workspace as a chip: the user wanted the lists scoped.
- Scope the lists but keep todos with no workspace in every one: a list for one repository would still mix in every older todo.
- One field, and the lists scoped strictly by it: chosen.

## Revisit when

A todo needs several repositories at once, or todos with no workspace get lost under a selected workspace.
