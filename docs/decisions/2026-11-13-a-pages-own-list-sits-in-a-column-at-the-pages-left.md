---
status: accepted
date: 2026-11-13
decision-makers: Maxence
supersedes:
  - 2026-11-13-the-window-uses-an-inset-sidebar-and-a-tab-strip-across-the-top
---

# A page's own list sits in a column at the page's left

In the context of a page's own list, such as the Bots, the Pull requests sections, the Todo categories, or the Settings sections, facing a list squeezed under its row in the sidebar to 30% of the window's height and pushing the roster down, we chose a column at the page's left, as Linear's inbox draws its list, over keeping it nested under its row.
The list gets the page's full height and the sidebar keeps the same rows on every page, and we accept a 256-pixel column that pages with a short list, such as Notes and Calendar, leave mostly empty.

## Context

[The window uses an inset sidebar and a tab strip across the top](2026-11-13-the-window-uses-an-inset-sidebar-and-a-tab-strip-across-the-top.md) nested the open page's list under its row.
Maxence asked the same day for that list to move onto the page, in a left column like Linear's inbox.
Everything else that record chose stands: the inset sidebar, its page list and roster, the header's tabs, and the surface tokens.

## Options considered

- Nested under its row: the list sits beside the row that opened it, but scrolls in a box a third of the window tall and moves the roster down on every page change.
- A column at the page's left: chosen, the list takes the page's height and the sidebar stops changing shape.

## Consequences

- The sidebar's page list shows the same rows on every page, and the roster under it stays put.
- Pages that already list their items, such as Notes, Todo, and Email, show three columns: the page's list, its items, and the open item.
- While the sidebar floats, as on a phone, the column would leave the page no room, so the list nests under its row there as before, and a page whose row the user hid shows its list after the last row.

## Confirmation

A smoke run shot Bots, Notes, Pull requests, Todo, Calendar, and Settings at 1920 pixels with the list in the column and none under the sidebar's rows.

## Revisit when

Revisit if the column should resize, or if a page's list is short enough to fold into the page's own header instead.
