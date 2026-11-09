---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
---

# On a phone, the sidebars float closed and leave no rail

In the context of the dashboard opened on a 390-pixel phone through Phone access, where both sidebars opened on load from the stored open state, the Details sidebar covered three quarters of a conversation as soon as it opened, and the closed Sessions sidebar kept a 46-pixel rail down the whole screen, facing a narrow-window layout the app already had, sidebars that float over the page below 720 pixels, we chose to keep that layout and fix it, over a new phone shell such as a bottom tab bar.
A floating sidebar now starts closed on every load and opens only when asked, without touching the open state the window stores, so a desktop window that narrows and widens again gets its sidebars back as they were.
The floating Sessions sidebar leaves no rail: its toggle floats over the page header's left corner, which the header keeps clear, so the page gets the full width.
We accept that the toggle sits over the header rather than in it, and that a page whose top-left is not a `Header` must keep that corner clear itself, as the empty home does.

## Options considered

- A bottom tab bar for Sessions, Pull requests, Todo, and Settings, as most phone apps do: one tap to each page, but a second navigation beside the sidebar's tabs and the header's buttons, and it would take the strip the composer needs.
- Keep the rail and only start the sidebars closed: one change, but every page keeps 12% less width, and a conversation's code and tables wrap more.
- Fix the floating layout: chosen, it keeps the app's one navigation and changes only how the narrow layout opens and where its toggle sits.

## Consequences

On a phone the status bar keeps one row of plan quota that scrolls sideways, and leaves out the terminal, CPU, memory, and disk, which act on the Mac.
Toasts on a phone show one at a time, under the top bar, clear of the sidebar button and of the composer at the bottom.
Fields use 16-pixel text on a touch screen, so Safari no longer zooms the page in when one takes focus.
From 720 pixels up nothing changes.
