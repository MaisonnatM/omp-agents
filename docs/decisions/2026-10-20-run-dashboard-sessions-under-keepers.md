---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# Run dashboard sessions under keepers

Each dashboard session's omp runs under a keeper, a detached process that lends omp's stdio to one server at a time over a Unix socket.
A session the dashboard starts must outlive a restart, an update, or a crash of the server.
See [Session keepers](../architecture/dashboard-sessions.md#session-keepers).
