# Analytics

omp-stats owns omp's request history in `~/.omp/stats.db`, under omp's config root.
`src/omp/stats.ts` starts `statsLive()` on its first read, which the provider check (see [Notifications](notifications.md)) makes at startup; it syncs every session transcript, watches for changes, and resyncs every five minutes until the server stops it on shutdown.
The dashboard calls omp-stats' rollup-aware total, model, agent-type, and tool reads from the selected range's cutoff, then groups request rows by session file for the top sessions.
omp-stats' `getTimeRangeConfig` gives each range's cutoff and bucket, except `today`, which starts at the server's local midnight with hourly buckets.
`Dashboard` owns a `ForeignUsage` index in `src/foreign/usage.ts`, which refreshes Claude Code's and Codex's transcripts on each Analytics read.
Each format names its usage files, including subagents, and folds each file through `FoldedFile`, reading only appended complete lines and restarting after truncation.
Claude Code requests come from assistant records with a real model and usage.
Repeated `message.id` records count once, with the last record's usage, because content blocks repeat the request while its output grows.
Synthetic replies and `cost-state` bookkeeping do not count.
Codex requests use `token_usage_record.payload.usage` once per `response_id`, with the latest preceding model from `turn_context` or `thread_settings_applied`.
The reader assumes an ordinary response record precedes its next valid `token_count` summary, with unrelated non-usage records allowed between them.
That summary consumes the pending record and advances the event cumulative total, but adds no request when its input, cached input, output, and per-request total match the record.
An unchanged cumulative summary also consumes the pending record, so a record-only compaction still counts and cannot suppress a later event-only request.
Duplicate response ids neither count again nor re-arm a consumed pair, and equal token values alone never deduplicate separate response records or growing event-only summaries.
Unpaired `event_msg` records with `payload.type: "token_count"` and non-null `info` count when `total_token_usage.total_tokens` grows, using `last_token_usage`.
The response records' `thread_token_usage` and the events' cumulative usage can start at different points and are never compared.
Codex input excludes cached and cache-written input, which count in their own buckets, and output already includes reasoning.
Claude Code subagent files count toward the session directory that holds them.
Codex subagents count toward `thread_spawn.parent_thread_id`, else the first session metadata's `parent_thread_id`, including guardian reviewers.
A Codex subagent without either parent id counts toward its own unlisted session.
`withForeignUsage` in `src/analytics.ts` filters requests by the same cutoff and adds them to `StatsRead` totals, models, agents, per-session rows, and provider buckets.
Foreign rows carry their session id and subagent flag rather than using omp's filename convention.
Listed sessions take their title and working directory from the existing saved-session index and can open their read-only transcripts.
Cache rates are recomputed after merging, and model output rates remain omp's measurement or `null` for foreign-only models.
Tool statistics remain omp-only.
`src/analytics.ts` folds nested subagent and advisor files into their top-level session, assigns the session's working directory from the saved-session index, and orders models, workspaces, and sessions by token usage.
`src/omp/stats.ts` reads time buckets by recorded provider through omp-stats' rollup-aware `getProviderTimeSeries`, using the same source as the totals cards.
`src/analytics.ts` derives chart totals and provider totals from those rows, fills missing buckets with zeros, and starts all time at the first request.
`web/components/settings/provider-trend.tsx` renders Recharts stacked bars, bucket details, and an optional data table from that provider breakdown.
The page and an Analytics API read with no range default to `24h`.
`analyticsStore` in `web/reads.ts` uses `createPolledStore` to keep each range's last successful answer in memory and localStorage, discarding incompatible saved shapes.
Polled stores opt into persistence with one `cache: { key, decode }` configuration, and omitting `cache` keeps reads only in memory.
When the page loads, `decode` turns each kept read back into the store's answer, or answers `null` for a record that lacks any field of that answer, which the store drops and reads again; each store's decoder sits beside its answer's type in `src/shared/`.
`AnalyticsTab` shows that answer while refreshing on activation or a range change, and every two seconds during indexing or 30 seconds otherwise while active.
A failed refresh keeps the last successful answer and reports its error without replacing another range's data.
The displayed cost is omp's API-equivalent list price, not the user's subscription bill.
Foreign requests use omp's bundled `pi-catalog` model prices at each request's timestamp, including long-context tiers and Claude's five-minute and one-hour cache writes.
An unknown model costs zero but still counts requests and tokens.

## Context sources

`src/omp/context-index.ts` keeps its own index, `context-sources.db` beside `stats.db`, and never writes omp-stats' database.
A sync walks omp's sessions directory and re-reads only the files whose size or modification time changed; a file it cannot read is recorded with no requests until it changes.
For each request, the assistant entry or `model_usage` entry whose usage carries input, `attributeTurns` in `src/context-sources.ts` splits the input, cache reads and writes included, by source.
It rebuilds the request's context with omp's `buildSessionContext` from the entry's parent, counts each message with omp's `Tokenizer` for the request's model, and credits it by role: a tool result to its tool, a `skill-prompt` custom message to its skill, a rule reminder to its rule, other custom messages and reminders to injections, and the rest to the conversation.
A subagent's `session_init` records its system prompt, which `splitSystemPrompt` splits into `<file path>` blocks, the skills and rules its lists name, each MCP server's tool routes, devices, and instructions, and the remaining `§` sections.
A main session's file records only a digest of its system prompt, so the request's input left after its measured messages is credited to the system prompt and tool definitions together; a subagent's residual is its tool definitions.
Measured tokens above the billed input scale down to it, so a request's sources always add up to its input, and a `model_usage` side request is one source named by its purpose.
A fork copies its parent's entries; omp-stats counts each copied request once, for the parent, so `attributeTurns` skips a fork's requests older than its header.
The index stores one row per request and one per request and source, by integer file and source ids, so `read(cutoff)` sums exactly the requests at or after the range's cutoff, which `windowOf` in `src/omp/stats.ts` gives as for usage.
`buildContextReport` folds subagent files into their session, takes the working directory from the saved-session index or the session's own file, and narrows the sums to the chosen workspace or session.
Each request with a report starts a background sync unless one ran in the last 15 seconds; the answer carries its progress, and `ContextSources` in `web/components/settings/context-sources.tsx` reads every two seconds while it runs and every 30 seconds otherwise.
A report's totals match omp-stats' input tokens for the same files, cache reads and writes included, apart from requests either side has not synced yet.
