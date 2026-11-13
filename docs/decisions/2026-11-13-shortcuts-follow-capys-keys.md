---
status: accepted
date: 2026-11-13
decision-makers: Maxence
---

# Shortcuts follow Capy's keys

In the context of the dashboard's keyboard shortcuts, facing a header tab row that works like Capy's while its keys did not, we chose Capy's key for every action both apps share: Cmd+1 through Cmd+9 go to the header tabs and Alt+1 through Alt+9 open the sidebar's sessions, over keeping our keys and over moving the page rows' numbers to Alt.
We accept that the page rows lose their number keys, that every old key stops working with no alias, and that Cmd+T and its kind would belong to a web browser's tab bar.

## Context

Maxence asked for the shortcuts to match Capy, Cmd plus a number for the tabs and Option plus a number for the sidebar, then for every other action both apps have.
[The window uses an inset sidebar and a tab strip across the top](2026-11-13-the-window-uses-an-inset-sidebar-and-a-tab-strip-across-the-top.md) gave Cmd+1 through Cmd+5 to the first five rows of the sidebar's page list; this record overrides that consequence and leaves the rest of that record in force.
[A header tab follows where you go in it](2026-11-13-a-header-tab-follows-where-you-go-in-it.md) copies Capy's tabs but not its Reopen closed tab or pinned tabs, so their keys stay unbound here; its Cmd+N for New session is now Cmd+Shift+O.
Capy's renderer bundle names its keys, with mod standing for Cmd on macOS and Ctrl elsewhere.

## Options considered

- Keep our keys: nothing to relearn for the dashboard alone, but a hand that moves between the two apps presses the wrong key, and Cmd+1 lands on a page row while Capy's lands on a tab.
- Move Cmd+number to Alt+number for the page rows and give Cmd+number to the tabs: the rows keep numbers, but Alt+number then cannot open a sidebar session as Capy's does, and the keys still differ from Capy's.
- Capy's keys, Cmd+number for the tabs and Alt+number for the sidebar's sessions, and Capy's key for each other shared action: chosen, one set of keys for both apps.

## Consequences

- Cmd+1 through Cmd+9 go to the header tabs, and Alt+1 through Alt+9 open the sidebar's sessions in the order it lists them.
- Capy's keys replace ours: Cmd+Shift+O starts a session, Cmd+. stops the turn, Alt+M dictates, Cmd+/ attaches files, Cmd+Shift+B shows the details sidebar, Cmd+, opens Settings, and Cmd+Shift+, copies a pull request's link.
- Cmd+T, Cmd+Alt+W, Ctrl+Tab, Ctrl+Shift+Tab, and Cmd+Alt+← and → open, close the others of, and step through the header tabs.
- Cmd+Shift+L opens the details sidebar's Browser tab, opening the sidebar when it is closed, and Cmd+Shift+G shows its Overview tab and, pressed again there, reviews the session's changes, as Capy's diffs key opens its diffs.
- Ctrl+Shift+F maximizes a pane, and J and K step through the lists that ↓ and ↑ step through.
- Off macOS, Ctrl+Shift+F is also the session search's key, which takes it first while the sidebar shows.
- The page rows keep their commands in the command menu and their G pairs, and Settings › Preferences no longer shows a number beside each tab.
- Capy's Open in editor and Search files have no action here, so Cmd+O and Cmd+P stay unbound.
- A web browser keeps Cmd+T and Ctrl+Tab for its own tabs, which is acceptable because, per [The dashboard runs only in the desktop app](2026-10-26-the-dashboard-runs-only-in-the-desktop-app.md), no browser tab runs it.

## Confirmation

`web/shortcuts.test.ts` checks each Capy key on macOS and elsewhere, that the old keys match nothing, and that Cmd+number and Alt+number read the number key on AZERTY and with Option.

## Revisit when

Revisit when Capy changes a key, or when you miss a number key for a page row more than you use the header tabs' numbers.
