---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# The sandbox sweep asks only a running ovnfs daemon

In the context of the isolation sweep and Settings › Storage, facing ovnfs-backed sandboxes whose checkout lives outside the sandbox, at a folder only the ovnfs daemon knows, we chose to ask a daemon that already runs, through omp's `runningDaemon`, and to keep the sandbox as unreadable when none answers, over starting the daemon with omp's `startDaemon` and over removing the sandbox unchecked as before.
The sweep never starts a file system daemon on its own and never deletes a checkout it has not judged clean and unused, accepting that ovnfs sandboxes pile up until ovnfs runs again, which an omp session using ovnfs starts.
Removal sends `rm` for the checkout name it judged to the daemon it judged it on, over that daemon's socket, so neither a record rewritten meanwhile nor a daemon that stopped meanwhile changes what it deletes.

## Options considered

- Remove the sandbox without its checkout, as before: rejected, since it leaks the checkout in ovnfs and skips the changes check.
- Start the daemon with `startDaemon`, as omp's own `releaseOvnfsCheckout` does: rejected, since a background job would mount a file system nobody asked for; for the same reason removal does not call `releaseOvnfsCheckout` either.
- Ask only a running daemon, and keep the sandbox when none answers: chosen.

## Consequences

A checkout the running daemon no longer lists gets no `rm`: the sandbox holds nothing of a task, and its folder goes alone.
A daemon that stops between the judgment and the removal fails the removal, which keeps the sandbox for the next sweep.
Settings › Storage shows no size for an ovnfs sandbox whose checkout is served, since its folder holds only the record and ovnfs cannot say what removing the checkout frees.

## Confirmation

`src/server/isolation-sweep.test.ts` checks that the sweep releases the checkout it judged and none it found unlisted, changed, in use, or unlocatable.
`src/omp/isolation.test.ts` checks the record and `ls` reply parsers, and, against a fake daemon and ovnfs executable, that removal reaches the daemon that listed the checkout and never starts one after that daemon stops.

## Revisit when

omp records an ovnfs checkout's folder in the sandbox, so the sweep can judge it without the daemon, or ovnfs runs as a service that is always up.
