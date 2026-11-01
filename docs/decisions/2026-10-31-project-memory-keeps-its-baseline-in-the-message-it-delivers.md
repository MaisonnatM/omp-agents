---
status: accepted
date: 2026-10-31
decision-makers: agent
---

# Project memory keeps its baseline in the message it delivers

In the context of the catch-up a session gets before a prompt, facing omp retrying the start of a turn within one prompt and sessions that fork, we chose to keep what a session was told, `{ tip, memory, at }`, in `details.seen` of the hidden message the hook returns over an `appendEntry` marker and over a file per session written by `session_*` listeners.
The baseline exists exactly when the message reached the session, a fork inherits it and catches up, and `/new` starts without one and gets a brief, accepting that a prompt with nothing new leaves the old baseline, so later prompts compare against it again.

## Options considered

- An `appendEntry` marker written when the hook runs: a retried attempt writes a marker for a message the session never got.
- A file per session kept by `session_*` listeners: a fork starts with no file of its own and gets a brief instead of a catch-up, and the file outlives the session.
- The baseline in the delivered message: chosen.

## Confirmation

`templates/omp/project-memory.test.ts` grows a session branch as omp does and checks that a second prompt with nothing new gets nothing and that a fork gets a catch-up, not a brief.
