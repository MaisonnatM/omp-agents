---
status: accepted
date: 2026-11-13
decision-makers: user
---

# Notifications and What's new are sidebar pages

In the context of the header's tabs, which ended in What's new, the notification bell, and a Settings button the sidebar's **Settings** row already covered, we chose to remove the Settings button and replace the bell's and What's new's popovers with fixed sidebar rows, **Notifications** with its unread count and **What's new** with a dot for unseen lines, before **Settings**, each opening a full page, `#notifications` and `#whats-new`, over keeping the popovers or making them tabs the user can reorder or hide in Settings › Preferences, so the header holds only tabs and every page opens from the sidebar, accepting that reading notices or the changelog now leaves the page you were on.

## Consequences

The `notices.open`, `header.whats-new`, and `header.settings` activity controls are gone; the pages record views `notifications` and `whats-new`.
Toasts still show new notices over any page.

## Confirmation

Opening `#notifications` and `#whats-new` shows each page, and the sidebar's rows show the unread count and the unseen dot.

## Revisit when

The user asks to read notices without leaving the page they are on, or to move or hide the row.
