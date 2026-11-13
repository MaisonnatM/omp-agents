---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
---

# Cmd+W closes the tab

In the context of the dashboard's Cmd+W, facing a user who wants it to close the header tab on screen without ending its session, we chose to bind Cmd+W to closing that tab and leave End session without a key, over keeping End session on Cmd+W and over moving End session to another chord.
This supersedes [End a session with Cmd+W](2026-10-30-end-a-session-with-cmd-w.md); the window menu keeps Close Window on Cmd+Shift+W.
We accept that ending a session now takes the End session button or its menu item, and that Cmd+W does nothing when the page on screen has no header tab.

## Confirmation

`web/shortcuts.test.ts` checks that Cmd+W, and Ctrl+W off macOS, runs `closeTab`.
