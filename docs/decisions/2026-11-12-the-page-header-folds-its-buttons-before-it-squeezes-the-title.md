---
status: superseded
date: 2026-11-12
decision-makers: Maxence Maisonnat
supersedes:
  - 2026-11-08-wrap-the-page-header-controls-under-the-title-on-a-phone
superseded-by: 2026-11-13-the-window-uses-an-inset-sidebar-and-a-tab-strip-across-the-top
---

# The page header folds its buttons before it squeezes the title

A 640-pixel session header then holds its title, its own buttons, and the tab menu on one row, a 480-pixel one takes two rows instead of three, and the title stays readable on each.
We accept that a header under 56rem reaches Notes, Calendar, Todo, Sport, Email, the space, and Settings one tap deeper, and that What's new shows only in a wider header.

## Context

The record this one replaces wrapped the header below `sm`, by the screen's width, and kept a page's buttons at full size.
Since then the header became a `header` container, so it follows the pane's width, and a phone already folds every tab, the space, and Settings into one menu.
In a browser the header ends with nine page buttons, about 362 pixels, beside a session's own buttons.
Beside a 480-pixel right sidebar that left the title nothing, and beside a 640-pixel one the buttons wrapped twice.

## Options considered

- Fold the buttons into the phone's tab menu once the header is under 56rem: chosen; one rule that a phone already follows, in classes only.
- Measure the row in script and move the buttons that overflow into a menu: the most buttons stay in view, but it adds a resize observer and a layout pass to a header that seven screens share.
- Keep wrapping by the screen's width: a wide screen with a wide sidebar still gets a narrow header, which is the case that broke.

## Consequences

The title keeps 16rem, or its whole width when shorter, before the buttons wrap to a right-aligned row under it, at any header width, so a short title on a page with few buttons stays on one row.
The switch's labels now show from 64rem, so a session header with labels still leaves its title room.
The desktop app's title bar is no `header` container, so it keeps every button.
A phone looks as before, the Notes page still taking a third row for its search and **New note**.

## Revisit when

Revisit if a header under 56rem needs What's new, or if the session header gains buttons enough to wrap at 56rem.
