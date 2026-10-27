---
status: accepted
date: 2026-10-23
decision-makers: Maxence Maisonnat
---

# A session's processes are its process groups and the broker daemons it owns

The status bar's CPU card lists, under each live session, each process group under its omp, other than omp's own, and each service omp's project broker runs with the session's id as owner, plus the project's unowned services as shared.
omp's bash tool starts every command as a child of omp that leads its own group, its MCP servers share omp's group and end with it, its `__omp_worker_` workers serve every omp of a project or the machine, and a named service runs under the broker rather than omp, so these are the lines that tie a process to one session.
Docker gives a detached container no such line, so the card leaves it out.
See [Session processes](../architecture/session-processes.md).
