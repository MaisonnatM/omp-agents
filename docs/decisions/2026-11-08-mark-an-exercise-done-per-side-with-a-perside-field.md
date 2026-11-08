---
status: accepted
date: 2026-11-08
decision-makers: Maxence Maisonnat
---

# Mark an exercise done per side with a perSide field

In the context of the Sport page's routine timer, which must hold a stretch on the left then on the right and say « Change de côté » between them, facing stretches whose notes say « Par côté » in prose and whose sets count one side, we chose a `perSide` boolean on each exercise, false by default, over reading the note and over doubling `sets`.
The timer and the page's dose then read one field the agent sets with the plan, and a set stays one set of each side.
We accept one more field in the plan and in the agent's `set_plan` description.

## Options considered

- Reading « par côté » in the note: no new field, but the note is free text the agent words as it likes, so a reworded note would silently drop the side change.
- Doubling `sets`: no new field, but the timer could not tell a side from a set, so it would neither name the side nor give the short change between them, and the dose would read 4 × 45 s for 2 × 45 s each side.
- A `perSide` field: the plan says what it means, chosen.

## Consequences

A file written before the field reads it as false, so the file needed no new version, and the agent sets it on the stretches with its next `set_plan`.
The dose of a per-side exercise reads « par côté », and its sets and hold count one side, so an exercise of 2 × 45 s par côté takes 3 minutes.
