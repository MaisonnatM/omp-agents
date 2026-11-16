---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# The Pull requests page filters its sections with tabs

In the context of the Pull requests page, which showed every section of every repository, facing Maxence's request to use Linear's list header there, view tabs as outlined buttons, filter and display buttons at the row's end, and a removable filter chip under them, we chose tabs that are presets of the sections the list shows, a **Filter** menu that switches each section, and a chip that names the shown sections, over a filter on pull request fields and over a search field.
The page answers "what is mine to do" or "what merged" in one click, and we accept that the tabs filter only by section, and that the header's search and new buttons have no counterpart.

## Context

The page already sorts every pull request into a section by whose move it is, so the sections are the filter a reader already knows.
Linear's tabs are presets of a filter, and its chip shows the filter a tab set; a filter you edit by hand leaves no tab picked.

## Options considered

- Filter by pull request fields, such as state, author, or checks: closer to Linear's chip, but a second way to group what the sections already group, and a larger menu.
- Add a search field, as Linear's header has: stack rows join across a section, and a search would cut stacks apart; nothing on the page creates a pull request for a new button to do.
- Tabs over the sections, with **Filter** and the chip over the same set: chosen.
  **Approved** stands in for Linear's **Ready to merge**, since an approved pull request with nothing to fix is what is ready.

## Consequences

- The shown sections are one set in localStorage under `omp-agents.pull-requests-sections`; an empty or unreadable value shows every section, so **All** stays the default.
- The table and ↓ and ↑ leave the other sections out; **Rebase N behind** and the **Pull requests** tab's count still cover every section.
- A manual sort started under a filter keeps the places of the pull requests it hides.
- The sort and **Repositories** buttons move from the page header to the tabs' row, as Linear puts display options beside its filter.

## Confirmation

`web/pull-requests-model.test.ts` checks that a tab reads as picked only for its exact preset, that the last shown section stays on, and that a missing or unreadable stored value shows every section.

## Revisit when

Revisit if the page needs a filter the sections cannot express, such as by author or repository, or a search across its pull requests.
