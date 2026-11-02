---
status: accepted
date: 2026-11-02
decision-makers: user
---

# Remove the Inbox page

In the context of the `#inbox` page, which listed the sessions and notices waiting on the user beside the open item, facing a user who never opened it, we chose to delete the page, its sidebar row, its G then I and triage shortcuts, and the reply body and suggestions the roster kept only for it, over keeping it hidden or behind a setting, to drop a page and its plumbing nobody uses, accepting that one-key triage of waiting sessions is gone while the notification bell and the **Sessions** tab's count of sessions that need you stay.

## Consequences

An unread turn on the roster carries only when it ended and the first line of its last reply again, and an unread file an older server saved with more fields comes back with only those two.
A `#inbox` address falls back to the panes, as any unknown page does.
The records `2026-11-02-the-inbox-is-a-snippet-rows-split-list` and `2026-11-02-the-inbox-names-the-item-it-opens-in-the-address` are deprecated.

## Confirmation

`src/server/live-sessions.test.ts` covers an older server's unread turn coming back with only its time and first line, and `web/shortcuts.test.ts` lists no Inbox shortcut.

## Revisit when

The user asks again for one place to work through what waits on them.
