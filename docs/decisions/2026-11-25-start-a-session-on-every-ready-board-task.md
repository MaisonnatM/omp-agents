---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Start a session on every ready Board task

In the context of the Board, facing Board tasks that nobody picks up, we chose to start a new session in the Board task's Workspace, prompted to claim it, whenever a Board task becomes ready, over a post-only mode or waiting for an idle session to claim it.
We gain a Board where posting is enough to get work done, accepting a session for every Board task, including ones you post to note something.

## Decision

- A Board task is ready when nothing it needs is open and no lease holds it.
- A session starts when the Board task is posted from the page or by an agent, when the last Board task it needs is done, and when its lease runs out.
- Starts go through the same starter as the dashboard's new sessions, and only the owner server runs them.
- A started session that never claims the Board task within 15 minutes counts as a lapsed lease.
