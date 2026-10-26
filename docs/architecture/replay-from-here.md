# Replay from here

`src/replay.ts` owns replay preparation and comparison. The dialog first reads `GET /api/replay/detail?view=<JSON View>&turnId=<prompt entry id>`.
The dashboard resolves that authorized main-session view to its known file, then reads the prompt through omp. It returns an HMAC-authenticated source token containing the file, session id, selected prompt id, and a fingerprint of the header, ancestors, and prompt.
`start` with `kind: "replay"` carries that token, the same view, the selected model and thinking level, and either a replacement prompt or `null` to retain the original.
Revalidating the token rejects a replaced or edited source without rejecting later appended responses. No browser-supplied source path is opened.

`src/omp/replay-fork.ts` uses the installed `SessionManager` to branch through the prompt's parent with artifacts copied. A null parent uses `newSession`.
The adapter exposes plain prompt data, the ancestry fingerprint, recorded settings, repair status, and narrow operations to freeze original evidence, fork, and close.
It owns native entry and branch reads, request correlation, blob persistence and loading, and interrupted-tool repair inspection.
`userTurnDraft` restores ordinary stored text or a skill invocation, and blob-aware `imageContent` restores images in order. Required missing images are errors.
The new prefix receives only omp's synthetic unresolved-tool results, never execution of inherited calls. The fork moves to the detached checkout, clears inherited additional write directories, and flushes and closes before RPC opens it.
The source is never RPC-opened.
The adapter freezes the accepted original turn and its verified complete first request body in omp's native blob store.

The checkout uses only the source cwd's current Git repository and canonical common-directory identity. A surviving HEAD reflog commit at the prompt's time is preferred; otherwise current HEAD is explicit provenance.
Neither route reconstructs historical dirty state. `Worktrees.start` serializes this checkout creation with removal, and a failed launch removes only its recorded owned root after the existing preview permits it.
The normal dashboard registry, request ledger, session transport, first-prompt path, and worktree removal checks remain the lifecycle owners.

The `omp-agents-replay` custom entry stores versioned source and checkout identities, accepted settings and prompt-change flags, repair provenance, and original blob references.
`ReplayFold` exposes it through ordinary session facts, records the first subsequent user prompt's entry id, and consumes the `omp-agents-replay-check` evidence. Later prompts never replace that target.
There is no replay registry or durable draft state machine. Native session inventory and existing transcript and trajectory streams provide live state. A restart never resends the first prompt.
Before admission, only the selected first text and exact ordered images are accepted. That turn excludes further prompts and settings or history changes until completion, including a preflight refusal reported by `prompt_result`.

`src/omp/replay-launch.ts` keeps advertised tools intact. It adds the guard and request-log extensions when absent and launches with an atomically regenerated private LSP overlay outside the writable checkout.
The overlay disables format-on-write and edit/write diagnostics and enables lazy LSP startup. Before prompting, the server waits for `omp-agents-replay-ready` with this launch's random nonce, so a stale acknowledgment cannot authorize an unprotected resumed process.
`replay-guard.ts` lets model `bash` calls run unchecked and blocks eval, task, direct LSP, MCP, and unknown tool calls. Only audited local reads and checked in-root writes run among the file tools.
Its pure policy uses omp's native edit inspector across supported grammars, including delete and move destinations. It rejects URI, database and archive mutations, lexical and canonical metadata paths, outside targets, symlink escapes, and hard links.
Blocked calls add `omp-agents-replay-block` so the ordinary tool trajectory can distinguish a policy block from another error.
This policy is not an OS sandbox or a confidentiality guarantee. Installed startup code and dependencies remain trusted, outside reads remain possible, and another process can race filesystem checks.
The dashboard rejects local slash commands, including history edits, and subagent steering prompts in a replay; human `!` commands run, and the independent terminal panel is not restricted. Dashboard resumes restore the policy and its safe-launch overlay. A direct terminal resume cannot promise the same launch configuration.

At `before_provider_request`, the guard correlates the chosen model and final user text and images with the native first prompt. A classifier that quotes that prompt is not sufficient.
The prompt must be the trailing text of the last user message, because omp prepends a dated `<system-reminder>` block to it.
The same request-log reconstruction exported by `request-log.ts` verifies the complete original body against its logged SHA-256.
The pre-send comparison includes the complete envelope, not a combination of component hashes. It permits only known root-prefix relocation, the per-session `client_metadata` and `prompt_cache_key` fields, and an explicitly selected model's top-level routing and generated workstation metadata.
Those two fields carry the session, thread, and turn ids, which every fork gets fresh, so only the raw hash still covers them.
Dates, messages, images, other cache metadata, loaded docs, tool catalog text and schemas, thinking, and unknown repair outcomes stay unchanged. Missing evidence or different APIs produces unknown, and no body is changed to manufacture equality.
The replay checkout is recorded with omp's spelling of its path: on macOS omp drops the `/private` prefix of its launch directory and refuses to open a session whose header names the other spelling.
Literal normalization-tag text cannot alias generated tags, and a structured `model` object is not erased as a routing identifier.
The hook can precede provider transformations, so the claim is hook-stage equality, not guaranteed wire equality.

`GET /api/replay/compare?view=<JSON View>` reads a replay's accepted original blobs, pinned first prompt, complete reconstructed request bodies, and full-detail trajectories.
The web dialog uses the existing trajectory stream as its refresh signal, aligns tool sequences by ordered names while retaining repeats and unmatched calls, compares unclipped arguments and the last request's full text, and displays recorded token and dollar totals.
Truncated previews never establish equality. A response without a correlated pre-send check or a request that cannot reconstruct to that check says unknown.
The source relation and comparison remain readable from the replay file after it stops or the dashboard restarts.
