---
status: accepted
date: 2026-11-16
decision-makers: Maxence Maisonnat, agent
---

# An idle session stops its omp and keeps its worktree

In the context of dashboard sessions left idle for days, each holding an omp process and its memory, facing a user who wants them gone from the live list without losing work, we chose to stop an idle session's omp through the keeper after a setting's hours, 24 by default, over ending it as **End session** does or signalling omp by pid, to free the machine while the session stays one **Resume** away, accepting that a session only counts as idle from the last time this server saw it busy, or from its file's last write when the server first sees it.

## Context

The idle stop already stopped the jobs and services an idle session ran, but never omp itself.
A forgotten session keeps its omp, its MCP servers, and its place under the workspace folders until someone ends it.
**End session** removes the linked worktree and cancels the session's continue, which loses uncommitted work the user may come back to.
A Bot's conversation already stops itself after 24 hours idle (`Bots.stopIdle`) by ending its live session, which keeps its file and resumes on the next message.

## Options considered

- Run **End session**: removes the worktree and records it in `ended-worktrees.json`, so a session the user meant to come back to loses its checkout. Rejected.
- Send SIGTERM to omp's pid, matched by start time: the keeper then reports an exit that was no end, so the session lands under Interrupted with **Resume all** sweeping it up, not under Past. Rejected.
- End the live session through `DashboardSession.end`, as a Bot's idle stop does: the keeper stops omp and the processes under it, the exit reports as ended, and nothing of `session-end.ts` runs. Chosen.
- Defaults of 4, 12, or 72 hours: 4 or 12 stop sessions left overnight that the user still means to read; 72 leaves a forgotten session for a weekend. 24 hours, the Bots' stop, chosen, with the others offered.
- Stop every live session: a terminal session runs in the user's terminal, a private session's end deletes it, and a Bot's conversation has its own stop. Only sessions this server started, neither private nor a Bot's conversation, stop.

## Consequences

- `SessionProcessWatch` keeps a settled clock per session, reset while the session works, waits on a question, or waits on a running subagent, and the owner ends a session once the clock passes the setting's hours.
- `processes.json` gains `stopIdleSessionsAfterHours`; a file without it takes the default, so an older file and an older machine's synced value still parse.
- An ended session keeps a scheduled send or auto-continue, which resumes it when it fires.

## Confirmation

`src/server/session-processes.test.ts` ends a settled session exactly at the setting's hours, and never one that works, waits on a subagent, is left alone, or runs on a server without the owner lock.
On a running dashboard, Settings › Preferences shows **Stop idle sessions** at **After 24 hours**.

## Revisit when

A session's idle time is kept across restarts by omp itself, or users ask to stop terminal sessions too.
