---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# The Pull requests page filters its sections with tabs

In the context of the Pull requests page, which showed every section of every repository, facing Maxence's request to use Linear's list header there, with view tabs, **Filter** and **Display** menus, removable filter chips, a search, and a new button, we chose tabs that are presets of the shown sections, a **Filter** with a submenu per field the page has data for, a **Display** menu for grouping, order, and repositories, a search in the header, and a **+** that starts a session to open a pull request.
The page answers "what is mine to do" or "what merged" in one click and narrows by repository, author, or date in two, and we accept that Linear's **Project**, **Captain**, and **Thread** filters have no counterpart, since a pull request carries none of them.

## Context

The page already sorts every pull request into a section by whose move it is, so the sections are the filter a reader already knows.
Linear's tabs are presets of a filter, and its chips show the filter a tab set; a filter you edit by hand leaves no tab picked.
A pull request summary carries its repository, author, creation and update times, title, number, and branch, which are the fields a filter or search can read.
Stacks join pull requests across a section by branch, so a filter that cuts a stack must run before the stack forms, or the rail joins rows that no longer show.

## Options considered

- Filter only by section: the first version; Maxence asked for repository, author, and date filters too.
- Filter by fields after sectioning: simpler, but a stack would keep rails to rows the filter hid.
- Filter by repository, author, dates, and search before sectioning, and by section after it: chosen.
- Keep the sort and **Repositories** buttons on the tabs' row: two more buttons than Linear's row; moved under **Display**, as Linear puts ordering there.
- Group only by repository: the existing layout; **Display** adds section, author, and no grouping, which have no drag, since the manual order is per repository and section.
- New pull request through the New session page: it would overwrite that page's draft; the popover starts the session itself with a start that leaves the draft alone.

## Consequences

- The filter is one object in localStorage under `omp-agents.pull-requests-filter`, and the display under `omp-agents.pull-requests-display`; an empty or unreadable value shows every section, repository, and author, grouped by repository.
- The table and ↓ and ↑ leave filtered pull requests out; **Rebase N behind** and the **Pull requests** tab's count still cover them.
- A manual sort started under a filter keeps the places of the pull requests it hides.
- While a filter or search is set, repositories with nothing left leave the page unless **Show empty sections** is on.
- The search lives only while the page shows.

## Confirmation

`web/pull-requests-filter.test.ts` checks that a tab reads as picked only for its exact preset, that the last shown section stays on, that a missing or unreadable stored filter shows everything, that the date, author, and search filters keep the right pull requests, that `filteredList` drops a repository a filter empties unless **Show empty sections** is on and filters sections after stacks form, that **Filter** keeps a checked repository or author that lists nothing so you can uncheck it, and that each grouping lays out and folds its headings, with **No grouping** in section order.

## Revisit when

Revisit if pull requests gain a field worth filtering, such as labels or linked tickets, or if a grouping other than by repository needs drag.
