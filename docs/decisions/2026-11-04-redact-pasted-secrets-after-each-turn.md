---
status: accepted
date: 2026-11-04
decision-makers: agent
---

# Redact pasted secrets on disk after each turn through omp's own rewrite

In the context of secrets a user pastes into an omp session, such as live Stripe keys and a Postgres password that stayed in plain text in `~/.omp/agent/sessions/` until the whole session was deleted, facing an agent that still needs the value during the turn and a session file that omp keeps writing, we chose a starter-kit extension that, once each turn ends, replaces each secret in copies of the session's entries and asks omp's `SessionManager.rewriteEntries` to write the file, then scrubs the sidecar folder, the request-log blobs, and `history.db`.
We chose it over hiding secrets as they arrive and over omp's own `secrets` setting, to keep the value usable for the turn while nothing readable stays on disk after it, accepting that the provider and the live session still hold the value and that redacted turns no longer replay exactly.

## Context

A session file is append-only JSONL that omp's `SessionManager` owns: it rewrites the whole file atomically, under a cross-process lock, after compaction, pruning, or a title change, and it rewrites from memory a file it finds changed under it.
The same session is copied elsewhere: tool output logs and subagent session files in the folder beside it, the starter kit's request log in omp's blob store, and prompts, titles, and recaps in `history.db` with a full-text index.
The user pastes a secret so the agent can save it, test it, or use it, usually in that same turn, and sometimes in a later one.
Secrets come in two kinds: keys whose shape gives them away, and passwords that only their label marks.
omp has a `secrets` setting that swaps known secret values for placeholders before a request goes to the provider and swaps them back in what the agent receives, so the file still holds the real values.

## Options considered

- Redact at the end of each turn by replacing entry fields and calling `rewriteEntries`, chosen: omp writes the file itself, so a concurrent append is never lost and the live message objects keep the real value, at the cost of a secret staying on disk for the length of one turn and of turns whose hashes no longer match the request log.
- Redact the user's message before the agent sees it, through `input` or `before_agent_start`: nothing would reach disk, but the agent could not save or use the key at all, which is why the user pasted it.
- Turn on omp's `secrets` setting: it keeps a configured secret from the provider, which redacting the file cannot, but it needs every value listed ahead of time and leaves the real values in the file, so it complements this choice rather than replacing it.
- Rewrite the session file from outside omp, such as a cleanup after the session ends: simpler, but omp rewrites a file it finds changed from its memory, and a session the user leaves open would keep the secret on disk for days.
- Delete the turn's entries or the whole session: removes everything, including the work around the secret, which is what the user had to do by hand.

## Consequences

A key or password the user pastes is on disk only until the turn ends, or until the next turn ends when omp exits without a shutdown.
The agent still has the value for the rest of the session, and the agent instructions tell it to save a pasted secret in the same turn, since a resumed session reads only the placeholder.
The provider has already received the secret, and the session's header title, built from the name omp holds in memory, keeps whatever it held.
A request whose messages were redacted no longer rebuilds to its logged hash, so the request-log CLI lists it as `secrets redacted` and Replay from here has no original body to compare against, and a blob shared with another session is gone for that session too.
A thinking block whose text changed loses its signature, so a resumed session sends it as plain text.
Text that looks like a key but is not, such as a 40-character string next to an AWS key id, may be replaced in the saved copy.

## Confirmation

`templates/omp/redact-secrets.test.ts` scrubs a real omp session with fake keys in its entries, sidecar files, a subagent session, the request log, and a WAL-mode `history.db`, then checks the raw bytes of each, that the file resumes with the same ids and parents, and that the live message objects are unchanged.
A smoke run of `omp -p` with the extension and a fake key finds no copy of the key in the agent directory's sessions or blobs.

## Revisit when

Confidence is medium: the patterns cover the keys seen in practice and will miss new formats.
Revisit when omp offers its own redaction of saved sessions, when `rewriteEntries` or the session file's format changes, or when users need exact replay of turns that held a secret.
