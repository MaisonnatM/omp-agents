---
status: accepted
date: 2026-10-27
decision-makers: Maxence Maisonnat, agent
---

# A Bot's routines show as one card of rows that open in place

In the context of a Bot's routines, facing a page per routine that showed one routine at a time and hid the others' health behind the sidebar's dots, we chose Arc's Agent routines card, one card of rows with a run strip each, where one row opens in place at `#bots/<id>/routines/<routine id>`, over keeping `RoutineDetail`'s page and over a list beside a detail pane.
It shows every routine's schedule, next run, and last 10 runs at a glance, and changes a common schedule without the editor.
We accept a denser row, a second timer for countdowns under an hour, and a compact schedule control that covers only four cadences.

## Context

A Bot can hold several routines, each with schedules, triggers, a task, and up to 10 runs.
The old page showed one routine's task, runs, and settings, and the sidebar listed the routines with a dot each, so comparing them meant opening each in turn.
The editor already makes and edits a routine whole, with any mix of schedules and triggers, and it stays.
The address names what the page shows, and the activity log records each address as a view, so whatever opens a routine must be an address too.
The page runs in a narrow window as often as a wide one.

## Options considered

- Keep `RoutineDetail`, one routine's page in place of the conversation.
  It shows a run's whole output and errors, but it shows one routine at a time, and pausing or running another means going back to the sidebar.
- A list of routines beside an open routine's pane, as the Todo and Email pages lay out.
  It keeps the list in view, but the conversation's column is too narrow for two panes in most windows, and the pane would repeat what a row already shows.
- Arc's Agent routines card, rows that open in place, one at a time.
  Each row shows its health and countdown, **Run now** and the switch work without opening it, and an open row holds what the old page held, with its schedule changed in place.
  It was chosen.

## Consequences

- Users see every routine's next run and recent runs on one card, and pause, run, or reschedule one without leaving it.
- `#bots/<id>/routines` is a new view in the activity log, `bots/routines`, and an open row is still `bots/routine`, so the old page's address keeps its meaning.
- The compact schedule control writes one schedule, hourly, daily, on weekdays, or weekly, and keeps the triggers; a routine with any other schedule shows it in words, and picking a cadence replaces it, so a custom schedule still needs the editor.
- A countdown under an hour from its run renews each second through a second timer that only those countdowns read, so the rest of the page still renders once a minute.
- The row's motion, the open's height, the strip's slide, the progress line, and the shimmer of **Running…**, all stop when the system asks to reduce motion.
- `RoutineDetail` and its ⋯ menu are gone; **Edit** and **Delete** sit at the foot of the open row.

## Confirmation

`web/routines-model.test.ts` holds the countdown, past-run, strip, and cadence words and shapes, `web/routing.test.ts` and `web/bots-model.test.ts` the card's address and what the page shows for it, and `web/activity.test.ts` its view.
Review checks that `web/components/routines/routines-card.tsx` is what `#bots/<id>/routines` and `#bots/<id>/routines/<routine id>` render.

## Revisit when

The choice is confident for Bots with a handful of routines.
Reopen it when a Bot commonly holds dozens of routines, when users ask for a cadence the compact control lacks often enough that they reach for the editor for most changes, or when runs need a longer history than the 10 a routine keeps.
