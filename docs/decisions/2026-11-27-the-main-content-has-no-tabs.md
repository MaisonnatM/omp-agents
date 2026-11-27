---
status: accepted
date: 2026-11-27
decision-makers: Maxence
supersedes:
  - 2026-11-16-each-header-tab-keeps-its-own-back-and-forward
  - 2026-11-16-header-tabs-pin-and-reopen-as-capys-do
  - 2026-11-16-a-duplicated-session-tab-shows-it-twice
  - 2026-11-16-copy-url-has-no-key
---

# The main content has no tabs

In the context of the header tabs, the row of Capy-style tabs over the page, facing Maxence's request to remove the main content's tabs system and keep the details sidebar's, we chose to delete the header tabs, their stored row, and their shortcuts, over hiding the row, so one page shows at a time and Back and Forward walk the window's own history again.
We accept that a session or page no longer stays open in a tab of its own, and that Cmd+W, Cmd+T, Cmd+Shift+T, Cmd+1 to 9, Ctrl+Tab, Ctrl+Shift+P, Cmd+Alt+W, and Alt+Shift+← and → go back to the browser or do nothing.

## Consequences

- `WindowHeader` in `web/components/header-controls.tsx` keeps the top row, which drags the desktop window and shows Back and Forward while the sidebar does not hold them.
- `web/window-history.ts` steps with `history.go` and reads `navigation.canGoBack` and `canGoForward` for the buttons; the mouse's back and forward buttons still step it.
- The `omp-agents.header-tabs` entry left in a browser's localStorage is no longer read.
- The details sidebar keeps its tabs, its **+** menu, and `ClosableTab`.

## Confirmation

`bun run typecheck`, `bun run lint`, and `web/shortcuts.test.ts` pass; a smoke proof of `#settings` showed the header with Back and Forward and no tabs.
