---
status: accepted
date: 2026-11-09
decision-makers: agent
---

# Model profiles show as a row of buttons

In the context of Settings › Models' saved model profiles, facing settings lists that show each record as a row with a remove button, we chose a wrapping row of ghost buttons, one per profile, each followed by a **Delete** button, over a vertical row list, because clicking a profile applies it, so each record is itself the main action, as the range picker's buttons are, and a handful of short names fits on one line.
The applied profile shows `active` with a check, as the range picker marks its pick, accepting a second way to show a list of saved records in Settings.

## Options considered

- A vertical list of rows with the name and a remove button, as `OrderedList` draws chains: the established shape, but applying would need a separate button on every row.
- A select with the profiles: hides which one is active until opened and takes two clicks to apply.
- A row of buttons: chosen; one click applies, and the active one is visible at a glance.

## Revisit when

Users keep more profiles than fit on two lines, or a profile needs more than its name shown, such as its default model.
