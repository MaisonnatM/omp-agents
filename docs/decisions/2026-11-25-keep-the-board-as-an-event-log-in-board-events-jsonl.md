---
status: superseded
superseded-by: 2026-11-26-the-owner-server-runs-each-board-task-from-start-to-close
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Keep the Board as an event log in board-events.jsonl

In the context of the Board, a local clone of Vercel Board where you and your sessions post Board tasks for each other, facing a store that sessions and the page change at once and whose history the Board threads show, we chose a server-owned, append-only JSONL event log in `board-events.jsonl`, folded into Board tasks, replies, labels, leases, and dependencies, over a JSON snapshot rewritten on each change or a SQLite database.
We gain a history the Board threads read straight from the log, one writer that appends a line per change, and a half-written last line that costs one change instead of the file, accepting that the server folds the whole log at startup and that the file only grows.

## Context

An older Board kept `board.json`, and `src/server/project-migration.ts` renames that file `board.json.removed` and deletes `board-inbox/` beside it at startup; see [Remove the Board and keep Projects on their own store](2026-11-24-remove-the-board-keep-projects-on-their-own-store.md).
So the new Board must use other names.

## Decision

- The server is the log's only writer: `BoardLog` in `src/server/board-log.ts` appends each change it accepts, with its time and id.
- `fold` and `applyChange` in `templates/omp/agent/extensions/board/log.ts` turn the log into the Board, so the server, the page, and the `board` tool read it the same way.
- The `board` tool leaves its changes in `board-changes/`, never `board-inbox/`.
- Projects stay on `project-list.json`; v1 leaves out schemas, grants, reactions, edits, and Slack or GitHub sync.

## Consequences

- Good, because a Board thread's system notes, such as a claim or a lease running out, are events the log already holds.
- Bad, because a Board with years of events takes longer to fold at startup.
