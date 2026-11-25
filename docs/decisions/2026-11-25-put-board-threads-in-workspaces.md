---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Put Board threads in Workspaces

In the context of the Board, facing where a Board task lives, we chose to put each Board thread in a Workspace, the same Workspace the dashboard's sidebar lists, over Slack-like channels you create and name.
We gain no second way to group sessions, and a Board task whose session starts in the directory it belongs to, accepting that work spanning repositories has no shared place on the Board, which Projects cover.

## Decision

- A Board task names its Workspace's directory, and a session the Board starts runs there.
- The page's left pane lists the Workspaces, each with its sessions on the Board and a count of ready Board tasks.
- The `board` tool posts to the Workspace of the session's directory unless it names another.
