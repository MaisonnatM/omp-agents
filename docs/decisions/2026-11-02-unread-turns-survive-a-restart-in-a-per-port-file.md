---
status: superseded
superseded-by: 2026-11-02-terminal-unread-turns-come-back-at-the-first-registry-listing
date: 2026-11-02
decision-makers: agent
---

# Unread turns survive a restart in a per-port file

In the context of the Inbox listing each session's unread turn, facing a dashboard that restarts itself after every update and dropped every unread turn kept only in memory, we chose to have `LiveSessions` save the unread turns in `unread/<port>.json` and bring back, at startup, those of the sessions that survived, and to read a turn that ended while no server listened from the end of its session file.
We rejected one shared file, reading the gap turn through RPC `get_messages` or `get_last_assistant_text`, and restoring a saved turn on any `add`.
We gain an Inbox that keeps what finished across restarts, ordered by when each turn really ended, at the cost of one more file per port and a second reader of the session file's end, which shares `tailEntries` with `lastMessage`, a Bot's last words.

## Context

The [Inbox decision](2026-11-02-the-inbox-is-a-snippet-rows-split-list.md) accepted keeping unread turns in memory.
Measured on the user's dashboard, one self-update restart dropped 11 unread turns, and a turn that ended between one server's exit and the next one's attach was never marked unread, because nobody heard its `agent_end`.
Instance ids are each server's own, so servers on two ports must not share the file, as the keepers' directory is per port already.

## Options considered

- One file per port, restored only through `restoreUnread` from `reattachAll`: matches the keepers, and a test that builds a registry over the shared test config never sees another test's turns.
- One file for every port: two servers rewrite each other's turns.
- Restoring a saved turn whenever `add` lists its instance id: tests reuse ids such as `i1`, and a terminal guest's turn would come back with nothing to say it still applies.
- RPC `get_last_assistant_text`: crosses turn boundaries and skips an empty aborted reply, so it can answer the turn before.
- RPC `get_messages`: transfers the whole conversation and carries no turn end time the Inbox can sort by.

## Consequences

A turn left unread, or one that ended during the restart, shows in the Inbox after the dashboard comes back, with its real end time.
A terminal session's unread turn still does not survive a restart, since only dashboard sessions reattach.

## Confirmation

`src/server/live-sessions.test.ts`, `src/server/interrupted.test.ts`, `src/live-session.test.ts`, and the reattach tests in `src/server/start.test.ts`.

## Revisit when

Terminal sessions' unread turns should survive a restart too, or omp reports a turn's end to a server that joins later.
