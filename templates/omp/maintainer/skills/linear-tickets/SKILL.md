---
name: linear-tickets
description: Reuse a task's Linear ticket and link its PR there. Use at the start of a task before creating a branch, and when opening a PR.
---

# Linear tickets

At the start of each session's task, check Linear for an existing matching ticket before creating a branch.
When a ticket exists, reuse its branch or use its suggested branch name when compatible with the Git safety rules in `~/.omp/agent/AGENTS.md`.
If the session must use another branch, keep it and link the resulting PR to the ticket in Linear.
Link any resulting PR to the matching ticket in Linear even when using the ticket's branch, with `xd://mcp__linear_save_issue` and `{ id, links: [{ url, title }] }`; the `create_attachment` tools upload files and fail on a URL.
