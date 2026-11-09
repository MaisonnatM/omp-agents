---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
---

# Settings sync carries Bots and their memory, not their conversation

In the context of Settings sync, facing a user who wants the same Bots on every machine, we chose to sync each Bot's settings and its memory as a list of facts, over syncing the Bots alone or their conversations too, so a Bot set up once and what it learned follow the user, accepting that each machine's Bot keeps its own conversation and that two machines' routines stay apart.
A conversation is a session file on one machine, so its id would open nothing elsewhere; routines stay out as before, since a routine on two machines would run twice.
Memory travels one line per entry, so facts both machines remembered merge rather than conflict.
See [Settings sync](../architecture/settings-sync.md).
