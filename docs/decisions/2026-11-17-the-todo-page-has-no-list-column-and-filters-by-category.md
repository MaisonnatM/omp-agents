---
status: accepted
date: 2026-11-17
decision-makers: Maxence
---

# The Todo page has no list column and filters by category

In the context of the Todo page, whose own list at its left held **All**, **Today**, **Needs you**, **From agents**, **Archive**, then the categories with their counts, color checkboxes, and add, rename, and delete, facing Maxence's request to remove that list and put filters in its place, we chose the Pull requests page's bar, a tab per list, a **Category** field under **Filter**, and a **Categories…** panel under **Display**, over keeping the column or giving each category a tab.
The list takes the page's width and categories filter like every other field, and we accept that the lists no longer show their counts, that `#todo/<category id>` links now open **All**, and that the categories once hidden from the lists that span them show again.

## Context

[A page's own list sits in a column at the page's left](2026-11-13-a-pages-own-list-sits-in-a-column-at-the-pages-left.md) gave the Todo page a column, which made it three columns wide with the list and the open todo.
[The Pull requests page has no list column and hides repositories itself](2026-11-16-the-pull-requests-page-has-no-list-column-and-hides-repositories-itself.md) already moved that page's sections into tabs in the bar above its list.
[A todo names one workspace, and the sidebar's workspace scopes the todo lists](2026-10-30-a-todo-names-one-workspace-and-the-sidebar-scopes-the-lists.md) still holds: the sidebar's workspace scopes every list and the count.
The column's color checkboxes kept a category's todos out of the lists that span categories, a choice synced across machines, and each category had its own list.

## Options considered

- Keep the column: the request was to remove it.
- A tab per list and per category: the categories are the user's own and grow without bound, so the tabs would wrap or scroll.
- A tab per list, a **Category** filter, and the categories managed from **Display**: chosen, as the Pull requests page keeps its repositories in a **Repositories…** popover there.

## Consequences

- **Filter** › **Category** checks any number of categories, with **No category** for todos in none; the choice lives in this browser with the other filters, where the hidden categories followed you through Settings › Sync.
- A category checked alone stands in for its old list: new todos join it, **Clear done** clears only it, rows drop the badge it would repeat, and an empty one reads as empty rather than as a filter that matches nothing.
- Deleting a category takes it out of the filter, and **No category** leaves once no category is left, so a stored filter never empties the list for good.
- No category may take `none`, the key **No category** goes by, as its id.
- `#todo/today`, `#todo/needs`, `#todo/agents`, and `#todo/archive` still open their lists, and any other `#todo/` address opens **All**.
- The tabs carry no counts, as the Pull requests page's do not; the page's header still counts the list picked.

## Confirmation

`web/page-list.test.ts` checks that the Todo page has no list of its own, `web/routing.test.ts` that an old category link reads as **All**, and `web/todo-filter.test.ts` that the Category filter keeps, stores, and prunes as above.

## Revisit when

Revisit if hiding a category should follow you between computers again, or if the tabs need counts to tell where work waits.
