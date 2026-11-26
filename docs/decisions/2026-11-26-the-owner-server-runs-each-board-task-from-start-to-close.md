---
status: accepted
date: 2026-11-26
decision-makers: agent
supersedes: [2026-11-25-start-a-session-on-every-ready-board-task, 2026-11-25-give-sessions-a-board-tool-that-writes-an-inbox, 2026-11-25-board-sessions-end-on-suggestions-and-a-reply-starts-a-new-session, 2026-11-26-board-sessions-ask-before-they-build, 2026-11-25-keep-the-board-as-an-event-log-in-board-events-jsonl]
---

# The owner server runs each Board task from start to close

In the context of the Board after a review found its records describing leases, `renew`, sessions that end themselves, and a log any server process writes, facing a start that failed showing "Starting a session…" forever, a crashing session restarted without limit, and no way for the user to stop a Board task, we chose to have only the server holding `server.lock` write `board-events.jsonl`, start, end, and cap the sessions, and to let the user close a Board task, over keeping each earlier record with its stale details and over a per-task retry setting.
We gain one record that says how a Board task runs today and Board tasks that always end in a state the page can show, accepting a fixed cap of 3 exits that a long, flaky task may hit and that a reply resets.

## Context

The earlier records each held one part of the Board: the event log, the `board` tool's inbox, starting a session on every ready Board task, ending on suggestions, and asking before building.
[Board tasks belong to their session](2026-11-26-board-tasks-belong-to-their-session.md) removed the lease they all leaned on, and the review found the rest had moved on too.
This record restates what still holds from them, with the changes the review led to.

## Decision

- The Board is an append-only event log, `board-events.jsonl`, folded by `templates/omp/agent/extensions/board/log.ts`; only the server holding `server.lock` appends to it, and a server taking over the unattended work folds it again first.
  A line a crash cut off is skipped, and the next event starts its own line.
- Sessions change the Board through the starter kit's `board` tool, with the actions post, reply, claim, done, list, and read, which leaves each change in `board-changes/`; the event keeps the inbox file's name as `request`, so a file applied again after a crash changes nothing.
- The owner server starts a session on every ready Board task, in the Board task's own worktree once project trust admits it and its setup ran; the session holds the Board task without claiming it.
  A start that fails shows on the Board task with its reason until the user replies, which tries again.
- A session commits on its branch, asks first when the request is unclear, and marks the Board task done with suggested next steps; the server ends it after that turn.
  It suggests "Merge on main" only where the repository has a `.omp/land.json`, and the server lands a bare "Merge on main" itself: nothing left to merge counts as landed, and a repository without a land config keeps the Board task done with a note.
- After 3 sessions in a row exit without marking a Board task done, the Board starts no new one and shows it as failed until the user replies.
- The user can close any Board task that is not done; the server ends its session, and a reply reopens it.

## Options considered

- **Supersede only the lease details, record by record.** Keeps each record's history in place, but leaves five accepted records each half right, which the review read as current.
- **A retry limit set per Board task.** Fits long flaky tasks, but adds a setting no one asked for; a reply already resets the count.

## Consequences

- The page shows **Couldn't start a session** and **Close task**; see `docs/usage/board.md`.
- A Board task with a session that keeps crashing costs 3 sessions, then waits for the user.

## Revisit when

The cap of 3 stops a task that would have finished on a fourth session often enough for users to notice.
