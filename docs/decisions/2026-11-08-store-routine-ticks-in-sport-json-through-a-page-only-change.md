---
status: accepted
date: 2026-11-08
decision-makers: Maxence Maisonnat
---

# Store routine ticks in sport.json through a page-only change

In the context of the Sport page's **Chaque jour** card, where the user wants to tick off each stretch of a daily routine, facing ticks that must still be there in another window or browser and must not crowd the workout journal, we chose a `checks` list in `sport.json`, one entry per day and routine, set by a `set-check` change only the page sends, over the browser's `localStorage` and over workout logs.
The ticks then follow the same reducer, socket, and file as every other Sport change, and the agent reads them with the rest of the state.
We accept one more list in the file and a change the agent may not send.

## Options considered

- The browser's `localStorage`: no server change, but the ticks stay in one browser, so the desktop window and another browser show none.
- A workout log per ticked routine: no new field, but every day's stretches would fill the journal, the week's adherence, and the records with entries that are not sessions.
- A `checks` list in `sport.json` set by a page-only `set-check`: one place for the ticks, outside the journal, chosen.

## Consequences

A file written before the list reads as having no ticks, so the file needed no new version.
`set-check` replaces one day's ticks of one routine, and an empty list removes the entry, so the file holds only days with something ticked.
A `set-plan` that drops a routine or an exercise keeps its ticks; the page ignores a key the plan no longer holds, so a routine put back finds its ticks again.
An agent's `set-check` is refused, since ticking is something the user does on the page.
