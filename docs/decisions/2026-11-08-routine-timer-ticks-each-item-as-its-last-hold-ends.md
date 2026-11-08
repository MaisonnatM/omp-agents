---
status: accepted
date: 2026-11-08
decision-makers: agent
---

# Routine timer ticks each item as its last hold ends

In the context of the routine timer, which runs the daily stretches and should tick them off for the open day, facing a run the user may close halfway, we chose to tick each item through the page's `set-check` as soon as its last hold runs out, over ticking every item once the routine ends.
A run stopped after three stretches then keeps those three ticked, and the checklist behind the timer fills as it goes.
We accept one save per item instead of one per run.

## Options considered

- Ticking all items at the end: one save, but closing the timer early, or a phone call halfway, would tick nothing.
- Ticking each item as its last hold ends: what was done is kept whatever happens next, chosen.

## Consequences

Each tick adds to what the day already holds, including the items ticked earlier in the same run whose save has not come back yet, so a tick never drops another.
A hold skipped with **Suivant** before it runs out does not tick its item, while an item counted in reps is ticked when the user presses **Suivant** on its last set, since only they know it is done.
Going back a step and running a hold again ticks nothing new, as the item is already ticked.
