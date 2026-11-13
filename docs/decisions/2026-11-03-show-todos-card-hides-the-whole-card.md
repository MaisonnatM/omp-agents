---
status: deprecated
date: 2026-11-03
decision-makers: Maxence
---

# Show todos card hides the whole card

In the context of the Todos card, which holds the todo list, the /ship steps, and the **Files**, **Images**, and **Sources** sections, facing a request for a button in the pane's header that hides that card as a whole, we chose to make the one existing preference, **Show todos card**, hide the whole card and to let the header's checklist button toggle it too.
We chose it over a second key for the whole card beside the todo-list-only switch and over per-pane state like the trajectory toggle, to keep one switch that means one thing in every pane and survives a reload, accepting that nobody can hide the todo list alone and keep the other sections.

## Context

`2026-10-28-files-images-and-sources-live-in-the-todos-card` moved the files, images, and sources into the Todos card and made **Show todos card** hide only the todo list, because the other sections had no switch of their own.
Maxence now asked for a button in the header that hides the card with the todos, the steps, and the images as a whole.
A header button was tried on 2026-10-28 and reverted the same day; it toggled the same preference while that preference still hid only the todo list.
The trajectory toggle beside the title keeps its state per pane and per view, and forgets it on reload.

## Options considered

- One preference that hides the whole card, toggled from Settings › Preferences and from the header: one stored boolean, already synced as a portable preference, and the button and the switch can never disagree; chosen.
- A second key for the whole card beside the todo-list-only switch: keeps hiding the todo list alone, but leaves two switches that overlap, where turning the card off makes the todo-list switch do nothing.
- Per-pane state like the trajectory toggle: hides the card in one pane only, but the choice is lost on reload and has to be made again in every pane.

## Consequences

Users hide or show the whole card from the checklist button in a session's header or from **Show todos card**, and the choice holds in every pane and after a reload.
Someone who hid the todo list with **Show todos card** before this change now sees no card at all, its files, images, and sources included, until they turn it back on.
This record replaces only the **Show todos card** consequence of `2026-10-28-files-images-and-sources-live-in-the-todos-card`; its choice of one card with sections still stands, so that record stays accepted.
The stored key stays `omp-agents.todos-card-shown`, so an existing choice carries over with its wider meaning.

## Revisit when

Users ask to hide the todo list alone again, or to hide the card in one pane while keeping it in others.
