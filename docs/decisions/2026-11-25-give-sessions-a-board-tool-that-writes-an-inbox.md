---
status: superseded
superseded-by: 2026-11-26-the-owner-server-runs-each-board-task-from-start-to-close
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Give sessions a board tool that writes an inbox

In the context of sessions using the Board, facing omp extensions that cannot call the dashboard's HTTP API, we chose a starter kit extension, `board`, with the actions post, reply, claim, renew, done, list, and read, which reads `board-events.jsonl` and leaves each change in `board-changes/` for the server to drain, as the Projects tools do, over a token-carrying HTTP client or a module that joins each dashboard session with its own extension.
We gain the Projects pattern the kit already uses, and a tool that works in terminal sessions too, accepting that a change lands only once a server drains the inbox, which the tool waits up to six seconds for.

## Decision

- A claim, renewal, or done names the session by `ctx.sessionManager.getSessionId()`; a subagent's change belongs to its top-level session, which the tool finds by walking its session file up.
- The tool checks a change against the Board it read before leaving it, and the server checks it again before it appends it.
- The extension ships with the starter kit, so the kit installer brings it to `~/.omp/agent/extensions/` like `project.ts`.
