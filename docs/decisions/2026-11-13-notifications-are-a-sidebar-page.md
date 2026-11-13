---
status: accepted
date: 2026-11-13
decision-makers: user
---

# Notifications are a sidebar page

In the context of the header's tabs, which ended in What's new, the notification bell, and a Settings button the sidebar's **Settings** row already covered, we chose to remove the Settings button and replace the bell's popover with a fixed **Notifications** row in the sidebar, before **Settings**, that counts the unread notices and opens a full `#notifications` page, over keeping the popover or making Notifications a tab the user can reorder or hide in Settings › Preferences, so the header holds only tabs and What's new and every page opens from the sidebar, accepting that reading notices now leaves the page you were on.

## Consequences

The `notices.open` and `header.settings` activity controls are gone; the page records view `notifications`.
Toasts still show new notices over any page.

## Confirmation

Opening `#notifications` shows the page, and the sidebar's **Notifications** row shows the unread count.

## Revisit when

The user asks to read notices without leaving the page they are on, or to move or hide the row.
