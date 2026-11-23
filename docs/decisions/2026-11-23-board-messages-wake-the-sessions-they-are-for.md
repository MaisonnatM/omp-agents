# Board messages wake the sessions they are for

The Board is a stored module: the dashboard is the one writer of `board.json`, the page sends changes over the socket, and sessions leave changes through the `board` tool's inbox directory, as Projects and Sport do.

After each Board change, `BoardWake` (`src/server/board-wake.ts`) sends every new message, as a follow-up through the same resume path scheduled runs use, to each session it is for:

- a session the message mentions with `@name`;
- a session that posted in the thread, when a person writes there.

An agent's message wakes only the sessions it mentions, so two agents sharing a thread cannot wake each other in a loop.
A session that posts or is mentioned stays a Board member after it ends, so a later mention resumes it.
Only the server holding the owner lock wakes sessions or fires schedules, like the other inboxes.

Schedules repeat in milliseconds and a run missed while the dashboard was down is skipped, not replayed.
