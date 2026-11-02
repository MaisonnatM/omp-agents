---
status: accepted
date: 2026-11-02
decision-makers: agent
supersedes: 2026-11-02-unread-turns-survive-a-restart-in-a-per-port-file
---

# Terminal unread turns come back at the first registry listing

In the context of unread turns saved in `unread/<port>.json` across a dashboard restart, facing terminal sessions whose saved turns the restart forgot and whose turns that ended while no server listened were never marked, we chose to keep the per-port file, restore the surviving dashboard sessions' turns at startup as before, and hold every other saved turn until the first registry listing that works, where each listed terminal session gets the last turn of its session file when it came after the previous server's `heardUntil`, else its saved turn.
We rejected saving each turn's source, comparing a saved turn's time with the file alone, restoring on any `add`, and a per-session record of the last turn heard.
We gain an Inbox that keeps terminal sessions' finished turns through restarts and shows those that ended while the dashboard was stopped, at the cost of one more field in the file and a roster that shows no terminal session to a page that connects before startup lists the registry.

## Context

The [per-port file record](2026-11-02-unread-turns-survive-a-restart-in-a-per-port-file.md) restored only the sessions `reattachAll` attached to, so `restoreUnread` forgot every terminal session's turn, as that record's consequences said.
Reproduced on a terminal omp joined by a server on another port: the turn it left unread showed in the roster and the file, and after a restart the roster showed `unread: null` and the file `{"turns":[]}`.
A turn that ended while that server was stopped never showed either.
The registry lists terminal sessions only after startup, a saved turn can be stale by then, since the session may have run a turn while no server listened, and only a session file says what happened meanwhile.
A socket that opened during startup listed the registry before the session files were indexed, so the file could not be found.

## Options considered

- A `heardUntil` time in the file, the time of the last save, which bounds every turn the server heard end since it saves each one at once: one field, and it also finds a turn that ended unseen in a session with no saved turn.
  Turns are held, not forgotten, until a listing that worked, and the listing prunes the sessions it does not show.
- Saving each turn's source, dashboard or terminal: forgets dashboard non-survivors at once, yet still needs a time to find a turn that ended unseen.
- Comparing a saved turn's time with its session file: misses a turn that ended unseen in a session that had none saved.
- Restoring on any `add`: tests reuse ids such as `i1`, and nothing checks that the turn still applies.
- A per-session record of the last turn heard: more state to keep in step for the same answer.

## Consequences

A terminal session's unread turn survives a restart, and one that ended while no server listened shows unread with its real end time.
A listed session with a turn running restores none, as its `turn-started` would have read it, and one whose omp cannot say whether it runs restores none for a newer turn.
Only the sessions the listing joined as guests follow this rule, so a session this server started keeps what `reattachAll` settled.
One `endedTurn` reads both gaps, and a turn stopped before anything followed its prompt now comes back unread with no reply for sessions the dashboard started too, as the live path marks an `agent_end` that carries none.
A page that connects during startup sees terminal sessions only once startup lists the registry, after the session files are indexed.
A turn that ends after that first listing and before the guest joins its room is still missed, as it was.

## Confirmation

`src/server/live-sessions.test.ts` covers the hold, the prune, the session file's newer turn, and a running host; `src/server/start.test.ts` covers the dashboard sessions.

## Revisit when

Confidence is moderate, since `heardUntil` assumes one clock and a server that saves every turn it hears.
Revisit when omp reports a turn's end to a server that joins later, or the registry lists a host's session file.
