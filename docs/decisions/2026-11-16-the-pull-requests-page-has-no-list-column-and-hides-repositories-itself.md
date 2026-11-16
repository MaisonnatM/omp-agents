---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# The Pull requests page has no list column and hides repositories itself

In the context of the Pull requests page, whose own list at its left repeated its sections as links, or listed the pull requests beside their details, facing Maxence's request to remove that list and to hide repositories and change their order on the page, we chose to drop the page from the pages with a list of their own and to add a **Repositories** popover to the page's top, beside the sort button, over keeping the column and over a Settings section.
The table takes the page's full width and the repositories are shown, hidden, and moved where they are read, and we accept that a pull request's details on a page of their own no longer list the other pull requests beside them, and that the hidden repositories stay in this browser only.

## Context

[A page's own list sits in a column at the page's left](2026-11-13-a-pages-own-list-sits-in-a-column-at-the-pages-left.md) gave every tab's page a column at its left, the Pull requests page's holding its sections or its pull requests.
The page already lists every pull request in its table, so the column mostly repeated the page.
Its repository links were also where you dragged a repository to reorder it, and nowhere hid a repository whose pull requests you never want to see.
That record still holds for the other pages.

## Options considered

- Keep the column, with a switch per repository in it: hides and orders where the order was set before, but keeps the repeated list Maxence asked to remove.
- A section in Settings: keeps the page bare, but sends you away from the page to change what it shows, and gives the order a second home beside the page's drag.
- A **Repositories** popover at the page's top: chosen, the page's own control, a switch and up and down buttons per repository, next to the sort menu that already orders the page.
  Its arrows sit beside the drag of a repository's heading on purpose, since the popover is the only place a hidden repository can move.

## Consequences

- The table, **Rebase N behind**, ↓ and ↑, and the **Pull requests** tab's count leave a hidden repository out; the popover still lists it.
- The hidden repositories are a set of their own, apart from the order, so **Reset the order** keeps them hidden and a hidden repository keeps its place, as moves among the shown ones step over it.
- The set lives in localStorage under `omp-agents.pull-requests-hidden`, as the order does, so another browser or computer shows every repository.
- The page's sections lose the links that unfolded and scrolled to them; their fold buttons and the page's scroll do that now.

## Confirmation

`web/page-list.test.ts` checks that the Pull requests page has no list of its own, and `web/pull-requests-model.test.ts` checks that a hidden repository leaves the shown pull requests and the count, and keeps its place in the order.

## Revisit when

Revisit if hiding a repository should follow you between computers, which would make the set a portable preference, or if the page grows a list that the table does not already show.
