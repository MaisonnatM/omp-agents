---
status: accepted
date: 2026-11-13
decision-makers: user
---

# Notifications is a sidebar page and What's new a Settings section

In the context of the header's tabs, which ended in What's new, the notification bell, and a Settings button the sidebar's **Settings** row already covered, we chose to remove the Settings button, replace the bell's popover with a fixed sidebar row, **Notifications** with its unread count right under **New session**, opening a full `#notifications` page, and move What's new into Settings › General as **What's new**, over keeping the popovers or giving What's new its own sidebar row, so the header holds only tabs and the sidebar lists only pages you visit often, accepting that reading notices leaves the page you were on and that nothing flags new changelog lines.

## Consequences

The `notices.open`, `header.whats-new`, and `header.settings` activity controls are gone; the pages record views `notifications` and `settings/whats-new`.
Toasts still show new notices over any page.
The row first sat before **Settings**; the user moved it under **New session**, above the tabs, the same day.

## Confirmation

Opening `#notifications` shows the page and the sidebar's row shows the unread count; `#settings/whats-new` lists the changelog.

## Revisit when

The user asks to read notices without leaving the page they are on, or to move or hide the row.
