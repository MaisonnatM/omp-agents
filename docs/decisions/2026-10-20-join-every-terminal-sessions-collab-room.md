---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# Join every terminal session's Collab room

The server joins each listed terminal session as the guest `omp-agents`, opened or not.
Subagent status lives only in the host's memory, and the guest connection is the one source omp offers for it.
The cost is one more participant per session and a transcript snapshot through the relay on each join.
See [Why the server joins every terminal session](../architecture/terminal-sessions.md#why-the-server-joins-every-terminal-session).
