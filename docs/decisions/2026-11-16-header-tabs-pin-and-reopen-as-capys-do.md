---
status: superseded
superseded-by: 2026-11-27-the-main-content-has-no-tabs
date: 2026-11-16
decision-makers: Maxence
---

# Header tabs pin and reopen as Capy's do

In the context of the header tabs, facing a row that copied Capy's tabs but left out its pinned tabs and Reopen closed tab, we chose to copy both with Capy's keys, Cmd+Shift+T to reopen and Ctrl+Shift+P to pin, over leaving them out and over keys of our own, so a hand that moves between the two apps finds the same tabs.
We accept a stored list of closed tabs beside the row, a pinned tab that Cmd+W leaves open, and on Linux and Windows a Ctrl+Shift+P that pins the highlighted session instead while the command menu is open.

## Context

Maxence asked for the Capy tab features the dashboard had skipped.
This record overrides the consequences of [A header tab follows where you go in it](2026-11-13-a-header-tab-follows-where-you-go-in-it.md) and [Shortcuts follow Capy's keys](2026-11-13-shortcuts-follow-capys-keys.md) that left pinned tabs and Reopen closed tab out and their keys unbound, and leaves the rest of both records in force, as the second one did to the window's record.
Capy 0.9.0's renderer binds `tab.reopen` to mod+shift+t and `tab.pin` to ctrl+shift+p, with Ctrl on every platform; its tab menu lists Pin tab, New tab, Duplicate tab, Copy URL, Close tab, Close other tabs, Close tabs to the right, and Move to new window; and it draws a pinned tab as its icon alone, before the others.
The dashboard's command menu already uses Cmd+Shift+P to pin a session, which Ctrl+Shift+P stays apart from on macOS.

## Options considered

- Keep both out: nothing new to store, but the row lacks a way back from a slip of Cmd+W and a way to keep a page at hand.
- Copy them with keys of our own: free to pick, but the keys differ from Capy's, which the shortcuts record turned down for every shared action.
- Copy them with Capy's keys and menu: chosen.

## Consequences

- The row stores which tabs are pinned and the last 20 closed tabs with their places, so both survive a reload.
- Reopen closed tab puts the tab back at its place among the pinned or the other tabs, on the page it showed; a session another tab shows by then focuses that tab instead, keeping a session to one tab.
- Pinned tabs sit first, show their icon alone, and have no ×; Cmd+W and a middle-click leave them open, and Cmd+Alt+W and **Close other tabs** keep them.
- A drag or Alt+Shift+← or → moves a tab only within its group.
- A right-click on a tab opens **Pin tab** or **Unpin tab**, **New tab**, **Close tab**, and **Close other tabs**; Duplicate tab, Copy URL, Close tabs to the right, and Move to new window are not copied.

## Confirmation

The header tabs' test, deleted with them on 2026-11-27, checked pinning, the pinned refusal to close, reopening at the old place and in the right group, and storing; `web/shortcuts.test.ts` checked Cmd+Shift+T and Ctrl+Shift+P on macOS and elsewhere.
A headless browser closed a tab and pressed Cmd+Shift+T to see it back in place, then pinned a tab from its menu and reloaded to see it still first.

## Revisit when

Revisit when Capy changes these keys or its menu, or when you miss a menu item it has, such as Close tabs to the right.
