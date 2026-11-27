---
status: superseded
superseded-by: 2026-11-27-the-main-content-has-no-tabs
date: 2026-11-16
decision-makers: Maxence
supersedes: 2026-11-13-a-header-tab-follows-where-you-go-in-it
---

# Each header tab keeps its own Back and Forward

In the context of the header tabs, which follow where you go in them as Capy's and a browser's do, facing Back and Forward that walked the window's one history across every tab, we chose a Back and Forward history for each tab, as Capy's desktop app keeps, over the window's history and over a history that records every address the tab shows.
Back in a tab then shows what that tab showed before, whatever happened in the other tabs, and we accept that the window's own history no longer means anything to the app, and that the tabs' stored row grows by up to 50 addresses a tab.

## Context

[A header tab follows where you go in it](2026-11-13-a-header-tab-follows-where-you-go-in-it.md) copied Capy's tabs but left Back and Forward on the window's history, so Back after switching tabs went to where you were in the other tab.
Maxence asked for the Capy features that record skipped, starting with this one.
Some moves add no entry to the window's history: a page that picks what it opens, such as Bots opening its latest Bot with `location.replace`, a move of the focus between panes, and a `#session/<id>` link that the dashboard replaces with its panes.

## Options considered

- Keep the window's history: nothing to build, but Back crosses tabs, which is what Maxence asked to change.
- Record every address the tab shows: simple, but Back from a Bot lands on `#bots`, which opens the same Bot again, so Back never leaves it, and every click into another pane adds a step.
- Record a move as the window's history took it, a push adding an entry to the tab and a replace changing the one on screen: chosen, so each tab's Back skips what the window's Back skipped before.

## Consequences

- A tab keeps `back` and `forward` beside its `hash` in the row the header tabs' model stored in localStorage, so a tab's history survives a reload; a tab stored before this starts with none.
- Whether a move pushed comes from the Navigation API: the window's current entry has a new `key` after a push and the same one after a replace, which Chromium's 50-entry cap on the window's history does not change.
- Back and Forward, the buttons, Cmd+[ and Cmd+], and the mouse's back and forward buttons, step through the tab on screen with `location.replace`, and so do picking, closing, and reopening a tab, so the window's history no longer grows from them.
- Going to a session another tab shows still focuses that tab without adding to either tab's history, while Back to a session another tab now shows stays in the tab on screen.
- A pinned tab keeps its history as any tab does, a closed tab keeps its history in the closed list, so Reopen closed tab brings it back with its Back and Forward, and Duplicate tab gives the copy the tab's Back and Forward, as a browser does, after which each keeps its own.
- Everything else in the superseded record stands: going somewhere shows it in the tab on screen, only the + opens a tab, and closing the last tab leaves one on New session.
  Its pinned tabs and Reopen closed tab, which it left out, follow [Header tabs pin and reopen as Capy's do](2026-11-16-header-tabs-pin-and-reopen-as-capys-do.md).

## Confirmation

The header tabs' test, deleted with them on 2026-11-27, checked that Back and Forward move through the tab on screen and leave the others alone, that a push drops Forward, that a replace keeps both, that pinning and reopening a tab keep its history, and that the stored row keeps each tab's history, a closed tab's too.
A headless browser smoke opened Todo then Bots in the first tab, Pull requests in a second, went back to the first, and saw Back show Todo through the button, Cmd+[, and the mouse's back button, with the second tab untouched, also after a reload.

## Revisit when

Revisit if Capy changes how its tabs' history works, or if the dashboard needs the window's own history again, such as for a page opened in a web browser's tab.
