---
status: accepted
date: 2026-10-30
decision-makers: Maxence Maisonnat
---

# End a session with Cmd+W

In the context of the dashboard's End session shortcut, facing a user who wants Cmd+W, the key that closes a tab in a browser or an editor, to end the focused session, we chose to bind Cmd+W to End session and move the window menu's Close Window to Cmd+Shift+W, over keeping Cmd+Shift+X beside Cmd+W and over leaving Close Window without a key.
Electron's menu takes its accelerators before the page sees them, so the menu must drop Cmd+W for the page to get it, and Cmd+Shift+W is where Chrome and VS Code put Close Window.
We accept that Cmd+W no longer closes the window, that it does nothing when no session can end, as on a Bot's page or in a past session, and that it ends a session with no confirmation, as Cmd+Shift+X did.

## Confirmation

`web/shortcuts.test.ts` checks that Cmd+W, and Ctrl+W off macOS, runs `endSession`, and that Cmd+Shift+X and Cmd+Shift+W run nothing in the page.
