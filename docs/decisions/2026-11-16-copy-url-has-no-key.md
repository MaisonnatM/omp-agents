---
status: superseded
superseded-by: 2026-11-27-the-main-content-has-no-tabs
date: 2026-11-16
decision-makers: Maxence
---

# Copy URL has no key

In the context of a header tab's Copy URL, facing Capy's Cmd+L for the tab on screen that [A duplicated session tab shows it twice](2026-11-16-a-duplicated-session-tab-shows-it-twice.md) copied, we chose to drop the key and keep Copy URL in the tab's menu only, over keeping Cmd+L, as Maxence chose.
We accept that the dashboard then differs from Capy here, against [Shortcuts follow Capy's keys](2026-11-13-shortcuts-follow-capys-keys.md).

## Context

This record overrides the consequence of the duplicated session tab record that bound Cmd+L, and leaves the rest of it in force.
Before that record, Cmd+L was one of the browser-reserved chords the dashboard leaves alone, since a browser focuses its address bar with it.

## Options considered

- Keep Cmd+L for the tab on screen, as Capy does: one key copies the address, but it takes Cmd+L from the browser.
- No key, Copy URL in the tab's menu only: chosen by Maxence.

## Consequences

- A right-click on a tab still lists Copy URL, with no key beside it.
- Cmd+L does nothing in the dashboard again, so a browser focuses its address bar; the command menu lists no Copy tab URL.

## Confirmation

`web/shortcuts.test.ts` checks that Cmd+L reaches no shortcut, with the other browser-reserved chords.

## Revisit when

Revisit if Maxence wants a key to copy the tab's address again.
