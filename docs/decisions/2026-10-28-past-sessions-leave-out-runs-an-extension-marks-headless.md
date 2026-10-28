---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# Past sessions leave out runs an extension marks headless

In the context of the past sessions, which listed the one-shot `omp -p` runs that other sessions start, facing omp writing no mark of its run mode in a session file, we chose an extension that appends an `omp-agents.headless` entry in `print` and `json` mode over guessing from a file's shape, to hide exactly those runs, accepting that runs from before the extension was installed still show.

## Context

Task subagents write under their parent's directory and never list, but an `omp -p` run writes a top-level session file like any interactive session.
Its header and entries match an interactive session's: no title only means omp skipped auto-titling, which a dashboard session before its rename shares.

## Options considered

- Guess from the file, such as no title and no `title_change`: hides dashboard and terminal sessions that never got a title.
- Append a marker entry from an extension at `session_start` when `ctx.mode` is `print` or `json`, read in the facts scan: chosen.

## Consequences

- `SessionFactsScan` folds the entry into `headless`, `SessionFactsIndex.headless` answers it, and `SessionFiles.past` drops such a row.
- A marked row shows from startup until the first facts scan reads its file, then leaves with that scan's push.

## Confirmation

`omp -p` with the extension installed writes one `omp-agents.headless` entry, and `src/server/session-files.test.ts` lists a marked session out of the past list.

## Revisit when

omp records the run mode in the session header, which the listing could read without the extension.
