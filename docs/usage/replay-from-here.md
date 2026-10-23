# Replay from here

- In a main session's **Trajectory**, each prompt row has **Replay from here**, separate from the button that expands its steps. Past sessions and a running source both support it. Subagents and the row before the first prompt do not.
  Claude Code and Codex sessions do not replay.
- Opening the dialog pins that prompt and its history. Later source replies do not invalidate it. If someone changes the prompt, its ancestors, or its session header, open the dialog again.
  The source session stays untouched and keeps running if it was already running.
- **Use original settings** restores the first identifiable main request's model and thinking level. You can instead select a model and a concrete thinking level.
  If the source has no request log, its earlier recorded settings supply the defaults when available. Automatic thinking needs an explicit replacement level.
  **Edit prompt** changes only the new session's first prompt. Images keep their original bytes, MIME types, and order. Missing required image blobs stop the start.
  A skill stays `/skill:<name>` and goes through omp's normal skill expansion. An ordinary prompt restores its stored text, which may already contain expanded references.
- **Start replay** creates a detached Git worktree of the source cwd's repository. It uses the newest surviving HEAD reflog entry at or before the prompt's timestamp, or current HEAD when that cannot be resolved.
  The comparison names the selected commit and its provenance. This is committed history only. Replay does not reconstruct historical dirt, copy today's uncommitted changes, stash, fetch, or install dependencies.
  An unavailable source repository is an error, not a request to choose an unrelated repository.
- The replay opens beside its source. At the four-pane limit it replaces another pane, never its source. The first prompt is sent once after omp accepts the fork and the selected settings.
  Further prompts, history edits, and settings switches wait until that first turn finishes. A page reload or server restart never automatically resends it.
- Replay has a model tool policy. Local `read`, `grep`, and `glob` remain available. Normal `edit` and `write` targets must resolve inside the replay worktree.
  Shell commands run for real in the replay worktree, unchecked, so a command can still change files outside it or reach the network.
  Eval, task, direct LSP, MCP, and unknown tools are blocked. URI devices, Git metadata, runtime configuration, source paths, symlink escapes, and hard-linked write targets are blocked for `edit` and `write`.
  A blocked source path suggests its equivalent inside the replay worktree; Replay never silently rewrites a tool call.
  Human `!` commands run in the replay composer, and local slash commands are blocked. Text and `/skill:` prompts remain available.
  This is not an OS sandbox. Reads can reach outside the worktree. Your installed extensions, startup configuration, credentials, and local dependencies must still be trusted. The dashboard's separate terminal panel is not covered by this policy.
- The replay pane's **Compare replay** remains available while it runs, after it ends, and after a page or dashboard restart. **Open original session** returns to the source even after you close its pane.
  The comparison freezes the original turn at launch and follows the replay's first prompt by entry id, not its row number. A source that was still running may have an incomplete frozen result.
  It shows ordered tool calls side by side, including repeated calls, inserted or missing calls, argument changes, blocked calls, full results, the final request's text, tokens, and cost. Partial results say so.
- **Normalized request match** means the complete logged provider-hook envelopes match after known repository-root relocation, with the per-session ids in `client_metadata` and `prompt_cache_key` set aside, and, only for an explicit model switch, top-level model routing and the generated active-model workstation line.
  Historical model mentions, dates, loaded docs, tool descriptions and schemas, other cache fields, thinking parameters, messages, images, and repairs remain substantive.
  **Mismatch** names the differing top-level fields. Both states show raw and normalized hashes and complete request bodies. Missing or corrupt logs, an unidentifiable main request, or different provider APIs say **Unknown**, never match.
  This check happens before the first supported request is sent. It describes the hook-stage body, not guaranteed wire-byte equality; provider code can still change the body afterward.
- Dashboard **Resume** regenerates the safe LSP overlay and requires a fresh protection acknowledgment before accepting prompts. The advertised model tool catalog is unchanged, so policy blocks do not themselves create a request mismatch.
  A direct terminal resume is not the same protected launch. The installed guard can restrict tools from the transcript marker, but it refuses local writes without the dashboard's safe-launch flags and cannot disable every implicit startup effect itself.
  If a failed start cannot safely remove its owned checkout, the error names the retained path. A successful replay keeps its checkout for inspection and uses the normal worktree removal checks on **End session**.
