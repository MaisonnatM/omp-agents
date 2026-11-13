---
status: accepted
date: 2026-11-13
decision-makers: Maxence
supersedes:
  - 2026-11-09-the-space-switch-sits-in-the-title-bar
  - 2026-11-12-the-page-header-folds-its-buttons-before-it-squeezes-the-title
  - 2026-10-30-title-bar-reads-where-the-window-buttons-end
  - 2026-10-21-the-dashboard-wears-t3-codes-theme-tokens
---

# The window uses an inset sidebar and a tab strip across the top

In the context of the window's frame, where a page could be reached from the sidebar's tab bar, from buttons in the header, from the desktop title bar, and from a phone's tab menu, facing four places to look for one page, we chose the "Inset tabs" layout over keeping the current frame and over the other five prototypes.
The sidebar runs the window's height and lists every page in one column, the header's tabs sit right of it with Back, Forward, the pages and sessions you visited, What's new, the bell, and Settings, and the page and the details sidebar are rounded inset panels on the sidebar's color.
We accept that a page's own buttons no longer share a row with the page list, that the header's tabs take a 48-pixel row above every page, and that the Activity history of the controls that moved restarts under new names.

## Context

Maxence compared seven prototypes side by side behind a switch on the `capy-variants` branch: Current, Inset panels, Window tabs, Inset tabs, Digest home, Filtered list, and Overview cards.
Each one was a skin over the same app, toggled by a `data-capy` attribute and CSS that hid or moved the existing controls.
Inset tabs combined the inset panels sidebar with the window tabs strip, and it is the one built here, with the switch and the other six removed.
The frame before this had the sidebar's tab bar for Pull requests, Tickets, Bots, and Sessions, buttons in the page header for Notes, Calendar, Todo, Sport, and Email, a space switch in the desktop title bar or the page header, and a tab menu that folded all of them into one button in a header under 56rem.

## Options considered

- Keep the current frame: no change, but the four places to reach a page stay.
- Inset panels alone, the sidebar without the tab strip: one page list, but Back, Forward, What's new, the bell, and Settings would still need a home in each page's header.
- Window tabs alone, the strip without the new sidebar: recent pages one click away, but the sidebar's tab bar and the header's page buttons stay.
- Digest home, Filtered list, and Overview cards: each changed the home rather than the frame, so they left the four places as they were.
- Inset tabs: chosen, one page list in the sidebar and one row across the top for history and the app's own buttons.

## Consequences

- The sidebar's top row holds the omp mark, the command menu button, and the sidebar's toggle; under it the page list shows New session, each shown tab in the user's order from Settings › Preferences, and Settings, the open page's own list nested under its row.
- Cmd+1 through Cmd+5 go to the first five rows of the page list, so Notes, Calendar, Todo, Sport, and Email take numbers too when they sit among the first five.
- The roster under **Workspaces** lists each workspace as a folder holding its running and interrupted sessions; **Past** stays folded until you open it, and this browser keeps that choice.
- The account row at the sidebar's foot shows the space and its workspace count, and its menu switches the space and opens the keyboard shortcuts.
- The header's tabs keep up to eight pages and sessions in this browser, a click focuses one, × or a middle-click closes it, and a drag, or Alt+Shift+← or → on the focused tab, reorders it.
- The **Search sessions** button beside the **Workspaces** label stays visible, as the field it replaced was, rather than showing only on hover.
- The page header holds only its page's title and buttons, so a narrow header has nothing to fold into a tab menu.
- In the desktop app on macOS the header's tabs are the title bar: the row is 48 pixels tall, drags the window, starts after the window's buttons through `env(titlebar-area-x)`, and `trafficLightPosition` in `desktop/main.ts` sits at y 17 to center the buttons in it.
- The maximized Browser of [Maximized Browser covers the window](2026-10-28-maximized-browser-covers-the-window.md) now starts below `--page-header-height` rather than `top-9`, since the title bar it named changed height.
- On a phone, as [On a phone, the sidebars float closed and leave no rail](2026-11-09-on-a-phone-the-sidebars-float-closed-and-leave-no-rail.md) says, the floating sidebar's toggle now sits over the header tabs' left end rather than the page header's corner.
- The surface tokens in `web/globals.css`, from `--background` to `--active`, take the prototype's values in `:root` and `.dark`, and the radius drops from 0.625rem to 0.5rem; T3 Code's button variants and its other tokens stay, so the pull request panel no longer matches T3's surfaces exactly.
- The Activity controls `header.command-menu`, `header.space.*`, `header.tab`, and `header.tab-menu` are gone; their clicks now record as `sidebar.command-menu`, `sidebar.space.*`, `header.tab.close`, and `header.tab.move`.

## Confirmation

`web/header-tabs.test.ts` checks that visiting a page opens or focuses its tab and that a reorder survives this browser's copy, and `web/sessions.test.ts` checks that an ended session on screen shows under its folder without moving the folder.
A smoke run shot the home, Pull requests, Todo, and a past session at 1440 and 1024 pixels in both themes, the closed sidebar, and a 390-pixel phone.

## Revisit when

Revisit if the page list outgrows the sidebar's height with a page's list open, or if the header's tabs need to sync between devices.
