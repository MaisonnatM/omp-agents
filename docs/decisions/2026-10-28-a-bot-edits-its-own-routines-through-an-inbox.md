---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# A Bot edits its own routines through an inbox

A Bot's `save_routine` and `delete_routine` tools never write `routines.json`; each leaves one request in `routine-inbox/`, and the server applies it.
The server stays the only writer of `routines.json`, as with `todos.json` and `notes.json`, so every page hears the change and the owner lock still decides who runs the routines.
Ownership is checked twice: the tool refuses an id that is not one of its Bot's routines, and `RoutineInbox` checks the request again against the current routines before it applies, so a request file written by hand cannot change another Bot's routine either.
A request the routines still refuse, such as a save for a Bot deleted since, moves aside as `.invalid` with its reason rather than vanishing.
With an `id`, `save_routine` changes only the fields the call passes, so the system prompt can show each routine as one short line, with its task cut to 80 characters, instead of every field in full for the Bot to pass back.
The merge happens in the tool against the `routines.json` it reads, and the request carries the whole routine, so the request file keeps the page's own `save` shape.
The tradeoff is that a change is asynchronous: the tool replies before the routine changes, a stopped dashboard applies the request only when it starts, only the server that owns the lock drains the inbox, and a page edit saved after the tool read the routine and before the request applies is overwritten.
A Bot's `set_job` tool sets its job through the same pattern: it leaves one request in `bot-inbox/`, and `BotInbox` saves the Bot with only its job changed, so the server stays the only writer of `bots.json` too.
