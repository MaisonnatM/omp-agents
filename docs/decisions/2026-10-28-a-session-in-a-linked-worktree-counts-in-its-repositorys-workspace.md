---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# A session in a linked worktree counts in its repository's workspace

In the context of the workspace pickers, facing one workspace per linked git worktree, such as every review or ticket worktree of `~/code/yampa`, we chose to count a session in its repository's main checkout, resolved on the server by the `WorkspacePlacement` that `SessionFactsIndex` holds and sent as `SessionFacts.workspace`, over hiding worktree directories from the pickers and over resolving each directory from the page.
This lists one workspace per repository while the session still runs in its worktree, and the new-session draft's branch picker still chooses the worktree, accepting that a session whose worktree is gone counts by a guess from its path, the prefix `~/code/yampa-` or a last segment named `yampa`, and that a session in a subdirectory of a main checkout stays its own workspace.

## Options considered

- Hide worktree directories from the pickers: their sessions would leave the sidebar under every workspace but **All workspaces**.
- Ask the server about each directory from the page: a second request path beside the session facts, which already ask git about each session's directory and push the roster when an answer changes.
- Count each session in its repository's main checkout, from the facts the roster already carries: chosen.

## Revisit when

A user keeps several main checkouts of one repository, or wants a long-lived worktree listed as its own workspace.
