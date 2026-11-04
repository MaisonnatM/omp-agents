# Pasted secrets

The starter kit's `templates/omp/agent/extensions/redact-secrets.ts` removes secrets from what omp keeps of a session on disk once each turn ends.
Each becomes `[redacted secret: <what it was>]`, such as `[redacted secret: stripe live secret key]` or `[redacted secret: database password]`.
Why it works this way, and what it leaves, is in the [decision record](../decisions/2026-11-04-redact-pasted-secrets-after-each-turn.md).

## What counts as a secret

`redact-secrets/redact.ts` holds the patterns.
Keys whose shape gives them away are found in any text: Stripe `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`, `pk_live_`, and `whsec_`; Anthropic `sk-ant-` and OpenAI `sk-`; GitHub `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, and `github_pat_`; GitLab, Slack, npm, Supabase `sb_secret_`, Google `GOCSPX-` and `AIza`, AWS `AKIA` and `ASIA` key ids, JWTs, and PEM private keys.
An AWS secret access key counts after a name such as `aws_secret_access_key`, or as a 40-character run with both letter cases on the same line as a key id, which leaves git hashes alone.
A database URL counts for its password only, `postgres://app:[redacted secret: database password]@host`, for Postgres, MySQL, MariaDB, MongoDB, Redis, AMQP, SQL Server, and CockroachDB.
In what the user wrote, and only there, a `password`, `passwd`, `passphrase`, `mot de passe`, or `mdp` pair counts, quoted or up to the next space, as does an upper-case name ending in a secret word, such as `ADMIN_PASSWORD=` or `SENTRY_TOKEN:`, with a value of at least 8 characters.
A value that points at a secret instead, such as `$DB_PASSWORD`, `${TOKEN}`, `<password>`, or `****`, stays.

The values that a pair or a database URL gives, when at least 8 characters long, are then replaced wherever else they show up, such as in the command the agent ran to save them or the output it read back.
`Redactor` keeps them for the life of the process, one per session, so a value the agent repeats in a later turn is caught too.

## When it runs

`agent_end` fires after each run of the agent loop, including runs omp follows with another on its own, such as a retry or a queued message; the extension acts only when `willContinue` is false, the end of the turn.
`session_shutdown` runs it again, and omp waits for that one, so `omp -p` and a session that closes finish the scrub before the process exits.
A process that dies before either leaves the secrets until the session's next turn ends, since the first run in a process looks at every entry.
Runs are queued one after another.

## The session file

The extension's `ctx.sessionManager` is omp's whole `SessionManager`, typed read-only.
For each entry holding a secret, the extension assigns a redacted copy to the field that held it, such as `entry.message`, then calls `rewriteEntries`, the call omp's own pruning makes after it changes entries in place.
omp writes the file whole through a temporary file renamed over it, under its cross-process lock on the session, and appends that land meanwhile go through the same queue, so nothing it is writing is lost.
A file written by anyone else would not survive: omp rewrites a session file it finds changed under it from memory, which would bring the secret back.

Only copies change: the live agent's message objects keep the real values, so the agent can still use what it was given until the session ends, and the provider's prompt cache stays warm.
A resumed session builds its context from the file and reads the placeholders.
A thinking block whose text changed loses its signature, so a resumed session sends it as plain text rather than a signature the provider would reject; signatures, encrypted reasoning, images, and the fields that link entries, `id`, `parentId`, `type`, and `timestamp`, are never touched.
A `WeakMap` of the entry objects already checked, with the version of the learned values they were checked against, means each turn looks only at new entries until a new value is learned.

## The sidecar folder

The folder beside the session file, `getArtifactsDir()`, holds tool output logs, subagents' outputs and their own session files, and folders of their own; the extension walks all of it, skipping dot files, which are omp's locks.
A text file is written to a temporary copy beside it and renamed over it only when its size and modification time are unchanged since it was read; otherwise the next run tries again.
A subagent's `.jsonl` file is changed line by line: a line holding a secret is written again from its parsed entry, and every other line, the 256-byte title slot and the header included, stays byte for byte.
A subagent session whose lease `isSessionLeaseHeld` reports held or unknown is left for a later run, since its own process may still append to it.
Files that hold a zero byte in their first 8 KB, such as screenshots, are skipped.

## The request log

The kit's `request-log.ts` stores each request's new messages in omp's blob store, named by their hash.
When a record's messages blob holds a secret, the extension stores a redacted copy, points the record's `messages.edits` at it, marks the record `redacted: true`, and deletes the original blob.
`rebuildRequests` in `replay/request-log-reader.ts` marks a rebuilt request `redacted` when its record is, or when the request it builds on was, and `bun request-log.ts <session.jsonl>` lists those as `secrets redacted` rather than as failures.
Their hashes no longer match, so Replay from here has no original request to compare those turns against.
Another session that recorded byte-identical messages shares the deleted blob and loses that request's rebuild.

## history.db

An interactive omp session adds each prompt to `history.db`; `omp -p` and RPC sessions do not.
The extension opens it with `bun:sqlite`, a five-second busy timeout, and `secure_delete` on, and redacts the session's rows in `history`, `session_recaps`, and `session_titles`.
A redacted prompt that matches another row's text deletes its own row instead, since `prompt` is unique.
It then rebuilds `history_fts`, which keeps its own copy of every word, as `omp gc` does after deleting rows, and checkpoints the write-ahead log with `TRUNCATE`; a reader holding the log open leaves the checkpoint for a later run.

## Not covered

- The model provider already received the secret with the turn's requests.
- The running agent keeps it in memory until the session ends or omp rebuilds its context from the file.
- The session header's title slot, which omp writes at a fixed width from the name it holds in memory, stays as written, as do a subagent file's title and header lines; omp names a session from its first prompt, so a key pasted there can show in the name.
  The `title_change` entries and `history.db`'s `session_titles` row are redacted.
- omp-stats keeps token counts and costs, never text.
- A file the agent wrote, such as the `.env` it saved the key to, is where the secret belongs.
- A password shorter than 8 characters is replaced inside the pair the user wrote, not wherever else it shows up.
- Files with a zero byte in their first 8 KB are skipped.
- A redacted turn can no longer be replayed byte for byte, and a blob another session shared is gone for it too.
- SQLite free pages and write-ahead log frames written before `secure_delete` was on can still hold old text until they are reused or the checkpoint truncates the log.
