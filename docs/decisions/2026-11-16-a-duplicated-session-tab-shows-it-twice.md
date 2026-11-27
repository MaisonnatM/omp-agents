---
status: superseded
superseded-by: 2026-11-27-the-main-content-has-no-tabs
date: 2026-11-16
decision-makers: Maxence
---

# A duplicated session tab shows it twice

In the context of the header tab menu, facing Capy's Duplicate tab, Copy URL, and Close tabs to the right that [Header tabs pin and reopen as Capy's do](2026-11-16-header-tabs-pin-and-reopen-as-capys-do.md) left out, we chose to copy all three with Capy's rules, including a Duplicate tab that copies a session's tab, over leaving Duplicate tab off a session's menu, so the menu matches Capy's.
We accept that a session can then show in two tabs, which [A header tab follows where you go in it](2026-11-13-a-header-tab-follows-where-you-go-in-it.md) otherwise keeps to one.

## Context

Maxence asked for the rest of Capy's tab menu.
This record overrides the consequence of the pin and reopen record that left these three items out, and leaves the rest of it in force, with Move to new window still not copied since the dashboard opens one window.
Capy 0.9.0's renderer inserts a duplicate right after its tab, or first of the unpinned tabs when the tab is pinned, never pinned, on screen, with no check for a thread another tab shows; only opening a link in a new tab looks for one.
Its Close tabs to the right keeps pinned tabs and the tab on screen when it stays, and otherwise puts the clicked tab on screen.
Its Copy tab URL copies the tab's full address, with Cmd+L and Cmd+Shift+C as keys.

## Options considered

- Leave Duplicate tab off a session's menu: keeps a session to one tab everywhere, but the menu then differs by tab and from Capy's.
- Duplicate a session's tab as Capy does: chosen; going to a session from the tab on screen that shows it now stays there, so the copy does not jump back to the first tab.

## Consequences

- The menu reads Pin tab, New tab, Duplicate tab, Copy URL, Close tab, Close other tabs, and Close tabs to the right.
- Opening a session from another tab still focuses the first tab that shows it.
- Cmd+L copies the address of the tab on screen, following [Shortcuts follow Capy's keys](2026-11-13-shortcuts-follow-capys-keys.md); Cmd+Shift+C stays the command menu's Copy path.
- A closed tab of a session that two tabs show reopens by focusing the one still open.

## Confirmation

The header tabs' test, deleted with them on 2026-11-27, checked where a duplicate goes, that going to a duplicated session stays in the copy, and which tabs Close tabs to the right keeps; `web/shortcuts.test.ts` checked Cmd+L.
A headless browser opened each menu item on a tab.

## Revisit when

Revisit if two tabs of one session confuse more than they help, or when Capy changes its menu.
