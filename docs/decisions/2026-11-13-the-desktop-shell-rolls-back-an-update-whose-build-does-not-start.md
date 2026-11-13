---
status: accepted
date: 2026-11-13
decision-makers: agent
---

# The desktop shell rolls back an update whose build does not start

In the context of **Update dashboard**, facing a new build that crashes or hangs before it listens and leaves the desktop app on an error page with the checkout stuck on the broken commit, we chose to have the desktop shell, which spawns the server and sees it stop, take the checkout back with `git reset --keep` to the commit that ran before and start that, over a check inside the server before it restarts and over a separate watchdog process.
A broken update costs one failed start instead of a dead dashboard, accepting that only the desktop app rolls back, and that a build which listens and then fails is out of reach.

## Context

The server restarts itself in place with `process.execve`, so the old build is gone by the time the new one fails; nothing in the server can see its own failed start.
The desktop shell is the parent of that process, already waits for its listening line, and survives every crash of the server.
A checkout someone edits or moves by hand must never lose that work to an automatic reset.

## Options considered

- Check the new build inside the server before the restart, such as by building the page or importing every module: catches only what that check runs, and still leaves a start that fails on real stores or ports.
- A watchdog process beside the server: one more process to start, stop, and keep alive, for what the shell already sees.
- The shell, after the server stops before it listens, reads the update record, resets only while HEAD is still the commit the update moved to, with `--keep` so a changed file refuses the reset, reinstalls when `bun.lock` changed, and starts the commit that ran: chosen.

## Consequences

A failed update shows in the bell and the command menu, and **Update dashboard** and the automatic pull refuse that commit until origin moves past it, so the app does not loop on it.
A server run with `bun start` gets no rollback; its record waits for the next start.
The shell also restarts a server that stopped after it listened, after 1, 2, 5, then 15 seconds, and gives up at the 5th stop within 5 minutes.
A rollback restores code and packages, not the stores, so a store format change must stay readable by the build before it.

## Confirmation

`src/server/update-journal.test.ts` recovers each state with HEAD at either commit and elsewhere, twice, and with a changed file; `desktop/server-supervisor.test.ts` rolls back a scratch checkout whose new build throws and starts the commit before.

## Revisit when

Builds that listen and then fail become common, or the server stops restarting itself in place.
