---
status: accepted
date: 2026-10-26
decision-makers: Maxence Maisonnat
---

# The dashboard runs only in the desktop app

The desktop window is the one place the dashboard runs, so the page, its shortcuts, and its notifications answer to one surface instead of a window and every browser.
No address carries the token: the server prints no sign-in address, `/?token=` signs nothing in, and the shell's main process hands `pageAccess` only to its own window's dashboard frame.
A browser tab on the dashboard's address gets the page with no token, which says to open the app.
The browser-only paths went with it: the sign-in page, and the Web `Notification` the page raised outside the app.
Automation needs no sign-in address either: the agent smoke checks and the scripts in `scripts/` write `pageAccess(token)` into the page's `localStorage` themselves.
See [SECURITY.md](../../SECURITY.md), [Desktop shell](../architecture/desktop-shell.md), and [Agent smoke checks](../agent-smoke.md).
