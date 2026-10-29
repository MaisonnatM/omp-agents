---
status: accepted
date: 2026-10-29
decision-makers: Maxence Maisonnat
---

# Only missing omp gets a dedicated startup exit

Map only unresolved or absent omp to the Node-safe `OMP_MISSING_EXIT` contract, so the desktop can offer installation before a server exists.
Malformed manifests, permissions, exports, and runtime failures keep their existing diagnostic path instead of being misreported as a missing installation.
The shell page offers one fixed command to copy, Bun guidance, technical details, and Retry, never automatic installation or generic command execution.
Retry refreshes only executable-discovery environment variables; initialized home, XDG, port, and desktop locations stay fixed.
See [Get started](../architecture/get-started.md#missing-omp-before-the-server-exists).
