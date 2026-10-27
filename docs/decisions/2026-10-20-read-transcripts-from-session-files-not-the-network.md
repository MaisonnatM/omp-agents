---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# Read transcripts from session files, not the network

Every transcript comes from the session files on this machine, through one file watcher per session format.
The files exist for live and past sessions alike, for omp, Claude Code, and Codex, and never depend on a relay.
See [Transcripts](../architecture/transcripts.md).
