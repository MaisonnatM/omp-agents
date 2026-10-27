---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# The desktop shell never imports the server

The Electron main process runs the server as a Bun child process.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls.
See [Desktop shell](../architecture/desktop-shell.md).
