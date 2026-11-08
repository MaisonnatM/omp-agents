---
status: accepted
date: 2026-11-08
decision-makers: Maxence Maisonnat
---

# Wrap the page header's controls under the title on a phone

In the context of the shared page header on a 390-pixel phone, where the sidebar rail, the header's padding, and the app's seven header buttons leave the title about 34 pixels, so the Sport page reads « Sp… » over « Tra… », facing a header that seven screens share and a desktop layout that must not move, we chose to let the header wrap below the `sm` breakpoint, the title keeping its full width on the first row and the buttons wrapping to a right-aligned row under it, over an overflow menu and over a container query.
The title and its meta line then read in full on every page, the buttons keep their size and their order, and the header looks as before from 640 pixels up.
We accept a taller header on a phone, about 88 pixels instead of 48, and 124 on a page such as Notes whose own controls take a third row.

## Options considered

- Fold the buttons into a `⋯` menu, as the session header's more-actions menu does: one row, but the Sport tabs alone leave the title about 124 pixels, under the 154 its meta line needs, so the subtitle would still be cut, and every page button would sit one tap deeper.
- A container query on the header: it would follow the pane's width rather than the screen's, but it needs inline-size containment on a header that seven screens and the panes use, which can change how their content sizes.
- Swap the rows, the buttons on top and the title under them, the usual large-title layout of a phone: the sidebar toggle and the buttons would share the first row, but reading and focus order would no longer follow the screen.
- Let the header wrap below `sm`, the title first and the buttons after it: chosen, a change of classes in one component.

## Consequences

The title row keeps the header's 48-pixel height, so the sidebar rail's toggle stays level with it.
The buttons' row wraps on its own too, so a page whose controls are wider than the screen, such as Notes with its search and **New note**, no longer pushes the page sideways.
A header whose title and buttons fit side by side, as a short title on a page with few buttons, stays on one row.
From 640 pixels up nothing changes, including at 1024 pixels with the sidebar open.
