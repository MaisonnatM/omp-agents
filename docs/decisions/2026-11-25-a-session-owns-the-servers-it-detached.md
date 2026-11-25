---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat, agent
---

# A session owns the servers it detached

In the context of sessions whose scripts start dev servers with `nohup … &`, which launchd adopts once the script exits, facing a machine that ran out of memory with 19 such process groups, about 14 GB, left by ended sessions, we chose to read `PI_SESSION_FILE` from each adopted process's environment and list its tree as a job of the live session it names, over fixing each script or stopping every adopted process whose session is not live, so the idle stop and the cleanup of a gone session stop them, accepting that a server whose session ended while no dashboard ran keeps running.

## Context

`SessionProcessWatch` counted only processes under a session's omp.
yampa's `control-yampa` starts uvicorn and react-router with `nohup … &` and exits, website scripts do the same with `astro dev`, and Playwright's Chrome outlives a killed test run; each is reparented to launchd, out of every session's tree.
On 2026-11-25 those orphans, about 2 GB per yampa stack, pushed swap to 14 of 15 GB, and macOS force-quit Ghostty and Slack.
omp's bash tool sets `PI_SESSION_FILE` and `PI_SESSION_ID` in each command's environment (`tools/bash.ts`), and a subagent's file lies in a directory named after its parent's file.

## Options considered

- Fix `control-yampa` and every other script that detaches: each new script can leak again, and scripts live in other repositories. Rejected as the only fix.
- Match by `PI_SESSION_ID`: a subagent's commands carry the subagent's id, which the roster does not know. Rejected for the session file, whose path names the parent.
- Stop every adopted process that names a session file no live session has: a session in a terminal the dashboard does not list, or another dashboard, would lose its servers. Rejected.
- List an adopted tree as a job of the live session whose file it names, so it shows, idles out, and stops when the session leaves the roster. Chosen.
- Leave out an app launchd started for `open`, which inherits the variable: Docker Desktop opened by a session kept a session file of a long-gone session. Its `XPC_SERVICE_NAME` is launchd's own `application.<bundle id>.…`, not the server's, which tells it apart. Chosen.

## Consequences

- Each sample reads the environment of processes launchd or init adopted since the last one; a first sample reads about 500, in under 50 ms on macOS.
- A tree holding a session's omp or the server itself is skipped, so a keeper or a dashboard started from a session is never stopped as a job.
- A server whose session ended while no dashboard ran, or before a dashboard restart saw it, still leaks until you stop it.
