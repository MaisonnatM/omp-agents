---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# A sport tool call leaves one request the server resolves

In the context of the `sport` tool leaving its changes in `sport-inbox/` for the server to apply, facing a `measure` with new metrics that left two files the server could apply half of, and an edit that carried the whole entry as the tool read it, so a later edit or a page change in between was silently overwritten, we chose one file per call holding `{ metrics, change }`, with an edit as `{ op, id, fields }`, which `agentSportChanges` in `src/sport-agent.ts` resolves against the state as the server applies it, over a file per change and over whole entries checked against a version.
A call then applies whole or is set aside whole, and an edit changes only the fields it names on the entry as it stands then.
We accept that the tool's check and the server's check can disagree when the state moves in between, in which case the server sets the request aside with its reason, and that an add the state already holds as it is applies again as nothing rather than being refused, so a request the server applied but could not delete does no harm.

## Confirmation

`src/server/sport-inbox.test.ts` applies two edits of one log in a row and keeps both, sets a refused request aside without its metrics, and applies a request already applied as nothing; `src/omp/sport-tool.test.ts` checks that one call leaves one request and an edit leaves only its fields.
