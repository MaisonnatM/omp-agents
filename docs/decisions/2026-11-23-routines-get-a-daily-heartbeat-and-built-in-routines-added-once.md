---
status: accepted
date: 2026-11-23
decision-makers: agent
---

# Routines get a daily heartbeat and built-in routines added once

A routine that errored, ended without a reply, ended far sooner than usual, or missed its schedule showed only as a red tick on its Bot's routines card, which nobody looks at unless something already seems wrong.
Once a day, and as it starts, the server that runs the routines now raises one `routine-health` notice that lists those runs, and the dashboard adds a disabled **Weekly harness review** routine that proposes one harness change a week.

- The heartbeat is a notice kind with its own check, `HEALTH_KINDS`, like the stopped sessions' check, rather than a routine or a second notification path, so it uses the bell's toasts, marks, and filters as they are.
- Its id names every run it lists and why, so a run that exits early later makes news again, and a look that finds the same runs keeps the marks.
- The thresholds are constants in `src/routine-health.ts`: a run is short below a quarter of the median of the routine's other runs, once three of them have a time, and late an hour past its slot.
- A message run's turn comes from its Bot's session file through the routine stamp on its prompt, so the heartbeat needs no new field on a run.
- Built-in routines are seeded once into `routines.json` through the lists, with their Bot, and `built-in-routines.json` records which were added, so a routine you delete stays deleted rather than coming back at the next start.
- The harness review is a prompt routine that reads and reports and never edits, so turning it on costs one Bot turn a week and changes nothing without the user.

See [Routines](../architecture/routines.md#routine-heartbeat).
