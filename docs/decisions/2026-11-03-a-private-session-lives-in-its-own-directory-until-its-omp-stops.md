---
status: accepted
date: 2026-11-03
decision-makers: agent
---

# A private session lives in its own directory until its omp stops

In the context of private sessions, which must leave nothing behind once finished, facing omp's shared sessions directory that Past sessions, search, the facts index, and omp memory all read, we chose to run each private session with omp's `--session-dir` inside a per-session directory under `private-sessions/<port>/<instance id>`, deleted when its omp stops.
We chose it over a private flag inside the session file, a `private.json` list of session ids, and a native omp purge primitive.
It keeps private files out of every reader by construction, with one directory that is both the record and the data, accepting that a private session whose omp crashes is deleted rather than resumable, and that the dashboard deletes omp's `history.db` rows itself.

## Context

omp writes every session to `~/.omp/agent/sessions/--<cwd>--/`, and its subagent transcripts and continuation copies beside it.
Past sessions, conversation search, the facts index, and omp's local memory all scan that directory, so a private file there needs a filter in each of them.
omp also keeps the user's typed prompts, titles, and recaps in `history.db` by session id, and pasted images in its shared blob store.
A server restart must not lose track of which sessions are private, and a crash in the middle of a deletion must not leave half a session.

## Options considered

- **A directory per private session, passed as `--session-dir` (chosen).** omp writes nothing to the shared directory, `/move` and `/wt` stay inside it because its last part is omp's own name for the cwd, and deleting the directory last makes a repeated purge finish what a crashed one started.
- **A private marker in the session file.** Every reader of the shared directory would need its own filter, and deletion would have to chase artifacts and copies across it.
- **A `private.json` list of session ids.** A second record that must follow the id changes of `/new` and `/move`, and that a crash before it is written loses.
- **A native omp primitive that forgets a session family.** It would own history, stats, and blobs, but omp has none today, and the feature would wait on an omp release.

## Consequences

- Private sessions never appear in Past sessions, History, search, or Resume, and cannot be forked or replayed, since omp writes a fork beside its source.
- A private session lives exactly as long as its omp process: End, `end_session`, and a crash all delete it, and it is never an interrupted session.
- The dashboard deletes the `history`, `session_titles`, and `session_recaps` rows of a private session as `omp gc` does, so an omp release that changes those tables needs this code checked.
- Pasted images stay in omp's blob store until `omp gc --blobs` sweeps them, and omp-stats keeps token counts and the file path, with no text.

## Revisit when

omp offers a way to forget a session family, including history rows and blobs, or users ask to resume a private session after a crash.
