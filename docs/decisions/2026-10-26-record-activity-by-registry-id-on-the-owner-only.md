---
status: accepted
date: 2026-10-26
decision-makers: Maxence Maisonnat
---

# Record activity by registry id, on the owner only

Settings › Activity keys every event by an id from a registry the code already has: the page kinds, `SETTINGS_SECTIONS`, `SHORTCUTS`, socket message types, `PUT` routes, and `CONTROLS`.
No key holds what the user sees or types, so the history is safe to keep and a feature with no use shows up by comparing the registries with the counts.
Only the server holding `server.lock` stores events, so a smoke server on the same state never counts as use.
See [Activity](../architecture/activity.md).
