---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# The Tickets page has no list column and its tab reopens the last issue

In the context of the Tickets page, whose own list at its left repeated its workflow states as links to its groups, facing Maxence's request to remove that list and to open the last issue when none is open from the sidebar, we chose to drop the page from the pages with a list of their own and to have the **Tickets** tab and its shortcut open the last issue open on the page, over keeping the column and over opening the first issue of the list.
The issues take the page's full width, and coming back to Tickets lands on the issue you were reading, and we accept that the last issue lives in this browser only and that a closed issue reopens on the next visit from the tab.

## Context

[The Pull requests page has no list column and hides repositories itself](2026-11-16-the-pull-requests-page-has-no-list-column-and-hides-repositories-itself.md) removed the same kind of column from the Pull requests page.
The Tickets page already groups every issue by state with a fold per group, so its column only scrolled to a group.

## Options considered

- Keep the column: scrolls to a state from the sidebar, but repeats the page Maxence asked to clear.
- Open the first issue of the list when none is open: always opens something, but drops you on an issue you did not choose.
- Open the last issue open on the page: chosen, the one you were reading, else the list alone, as the Settings button reopens the last section.

## Consequences

- A module page sets `listsItself` in its definition to have no column; Tickets is the only one.
- The last issue lives in localStorage under `omp-agents.tickets-last`, so another browser opens the list alone.
- **Close** on an issue shows the list alone, and the tab still reopens that issue until another one opens.
- An issue no longer assigned to you still reopens, with its details beside the list, as a `#tickets/<identifier>` address does.

## Confirmation

`web/page-list.test.ts` checks that the Tickets page has no list of its own while the Calendar page keeps one.

## Revisit when

Revisit if the page grows a list the groups do not already show, or if the last issue should follow you between computers.
