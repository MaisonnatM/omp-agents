---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# A session moves itself through a host tool at its turn's end

In the context of a session that finds its work belongs in another repository, facing omp's `/move` being a slash command only, refused while a turn runs, we chose a `move_session` host tool that the server serves to every dashboard-started main session and fulfils by sending `/move <path>` once the turn ends idle, over a kit extension that leaves a request in an inbox as `end_session` does, and over reading a move out of the agent's reply.
The server already owns the session it moves, so no file protocol, owner lock, or request version is needed, accepting that a session in a terminal, which the dashboard cannot drive, still asks the user to type `/move`, and that the agent learns whether the move worked only from the note omp leaves.

## Options considered

- A kit extension with a `move-inbox/`: works from any session but adds a versioned file format and an owner-lock check, and still moves only sessions the dashboard drives.
- Parse a suggested `/move <path>` from the reply: text parsing that breaks on wording, and a button would still need a click.
- A host tool bound through the session's own `tool_execution_end` event: chosen, since a reattached session's tools and its `attach` come from two separate `joinFor` calls, so a closure cannot know its instance.

## Revisit when

omp gains an RPC command to move a session, or terminal sessions need to move themselves.
