---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# The sandbox sweep asks only a running ovnfs daemon

In the context of the isolation sweep and Settings › Storage, facing ovnfs-backed sandboxes whose checkout lives outside the sandbox, at a folder only the ovnfs daemon knows, we chose to ask a daemon that already runs, through omp's `runningDaemon`, and to keep the sandbox as unreadable when none answers, over starting the daemon with omp's `startDaemon` and over removing the sandbox unchecked as before.
The sweep never starts a file system daemon on its own and never deletes a checkout it has not judged clean and unused, accepting that ovnfs sandboxes pile up until ovnfs runs again, which an omp session using ovnfs starts.

## Options considered

- Remove the sandbox without its checkout, as before: rejected, since it leaks the checkout in ovnfs and skips the changes check.
- Start the daemon with `startDaemon`, as omp's own `releaseOvnfsCheckout` does: rejected, since a background job would mount a file system nobody asked for.
- Ask only a running daemon, and keep the sandbox when none answers: chosen.

## Revisit when

omp records an ovnfs checkout's folder in the sandbox, so the sweep can judge it without the daemon, or ovnfs runs as a service that is always up.
