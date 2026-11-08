---
status: accepted
date: 2026-11-07
decision-makers: Maxence Maisonnat
---

# Keep training data in one server-owned JSON file

In the context of a Sport module whose plan, tests, workout log, and loads lived in hand-written Markdown files, facing loads that went stale whenever a test changed and a page and an agent that would each have to parse prose, we chose one `sport.json` that only the server writes, over the Markdown files and over a file per workout log.
The page and the agent then compute the week and each day's loads from the same newest measurement and newest log, and the file follows the reducer, socket, and moved-aside-when-unreadable model of the todo and notes files.
We accept that the plan is no longer a document the user edits by hand, and that the whole state travels over the socket on every change.

## Options considered

- Keep the Markdown files: readable and greppable, but every load is copied by hand and nothing can compute a week from them.
- One JSON file per workout log beside a plan file: smaller writes, but a week reads many files and a change spans several of them without one reducer to order it.
- One server-owned `sport.json`: one parser, one reducer, one snapshot, chosen.

## Consequences

`src/sport-parse.ts` refuses a file of the wrong shape whole and `SportFile` moves it to `sport.json.invalid`, so a bad hand edit never silently loses data.
The file is read with types alone and only changes meet the limits and the plan checks, so a rule tightened later never refuses a saved file.
The agent tool will write through the server rather than the file, as the notes inbox does.
