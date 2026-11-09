---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
supersedes:
  - 2026-11-09-settings-sync-carries-bots-and-their-memory-not-their-conversation
---

# Settings sync carries each Bot's routines to run on one machine

In the context of Settings sync, facing a user who wants each Bot's routines on every machine but run on only one, we chose to carry the routines inside their Bot with the machine that runs each one, over keeping routines out of sync or running every routine everywhere, so a routine set up once shows on every machine and runs once, accepting that moving it waits on the old machine's next sync to stop it there.
This reverses the routines part of 2026-10-21-settings-sync-syncs-a-registry-of-portable-items-through-a-git-remote, which kept routines out since one on two machines would run twice.
See [Settings sync](../architecture/settings-sync.md) and [Routines](../architecture/routines.md).

## Context

A routine runs on the machine whose dashboard holds it, so two machines holding the same routine run it twice.
Settings sync has no server between machines: each machine syncs when its user asks, so no machine can take a lock the others see at once.
A routine's runs and the time its schedules last ran describe what one machine did.

## Options considered

- Keep routines out of sync, as before: no double run, but a routine must be set up again on each machine.
- Carry routines as their own item, `routines.json`: a routine could arrive before its Bot, which the dashboard refuses, and turning Bots off would leave routines of Bots that are not there.
- Carry them inside each Bot, with the machine that runs each one: chosen, since a routine belongs to one Bot, and the Bots switch covers both.
- Mark which machine runs a routine by its host name: rejected, since a Mac's name can change; a random id in `machine.json` stays, and the name travels beside it for the page.

## Consequences

- A routine shows on every machine; only one runs it, and the others read **Runs on** and its name.
- Turning a routine on moves it to that machine at once there, and the old machine stops at its own next sync, so both may run it until then.
- Two machines that both change where a routine runs before syncing conflict, because the carried routine holds one `runsOn` field for whether and where it runs.
- Runs stay where they ran, so each machine's run history shows only its own runs.
- A machine still on the version before this drops the routines from the remote; the others keep theirs, but routines stop spreading until it updates.

## Confirmation

`src/settings-sync.test.ts` moves a routine between two machines and checks which one runs it, the conflict, and the older machine's Bots, and `src/routines.test.ts` checks the move in `applyRoutine`.

## Revisit when

Sync runs on its own, such as on a timer, which would shrink the window where both machines run a moved routine.
