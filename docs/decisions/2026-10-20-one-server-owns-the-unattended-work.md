---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# One server owns the unattended work

Servers on different ports share `~/.config/omp-agents`, so `server.lock` names the one server that runs routines, scheduled sends, the todo and note inboxes, the daily clean-up, and the idle stop of sessions' processes.
Two servers running them would start every routine twice.
See [One server runs the unattended work](../architecture/routines.md#one-server-runs-the-unattended-work).
