# Server: sessions and transcripts

- `src/dashboard-session.ts`: drives one session that the dashboard started, over RPC, including serialized model changes and state refreshes; `reattach` opens one a previous server started, and `dispose` hangs up without stopping omp.
  `withSessionVisuals` adds `src/omp/session-visuals-extension.ts` to every launch but a replay's, whose requests must match the original's.
  `src/keeper.ts` is the session keeper, the detached process that holds one session's omp, lends its stdio frame by frame to one server at a time over a Unix socket, so the session outlives the server, and stops every process omp started when the session ends; `src/keeper-link.ts` is the server's side, which starts, lists, and connects to keepers, and `reattachAll` in `src/server/start.ts` attaches to them at startup.
  `src/keeper-wire.ts` holds the greeting, the stop line, the pid file's name, and `KeeperMeta`, the only words the two sides share, so the keeper's bundle holds none of the server; `src/process-census.ts` is the keeper's `ProcessCensus`, which notes the processes under omp with `ps` and stops the noted ones when the session ends, and `stopTree`, with which the server stops a stuck keeper's tree.
  Both find a process's tree with `descendants`, which leaves out omp's `__omp_worker_` workers and what runs under them, and the same file holds the `ps` row parser, `sessionGroups`, a session's processes split into omp's group and its jobs, and `terminate`, which the server's process watch shares.
  `src/prompt-turn.ts` holds its `PromptTurn`: whether the main agent's turn runs and which prompt omp admitted while idle has not shown yet, with one method per event that moves them.
- `src/guest.ts`: runs one Collab guest per terminal session.
  `src/subagents.ts` parses the host's subagent registry and its lifecycle and progress frames (`parseAgents`, `parseSubagentFrame`) for both transports, finds each subagent's transcript file, and lists every subagent transcript under a transcript's artifacts directory (`artifactsDir`, `subagentFiles`).
- `src/serial-lane.ts`: `SerialLane`, which runs work one call at a time in arrival order; both transports order a session's prompts, aborts, and flushes with it, and the routine runner serializes ticks and run-now claims.
- `src/user-requests.ts`: parses the RPC and Collab question frames into one request shape, writes the answers back, and keeps each session's pending questions.
- `src/commands.ts`: the composer's `/` and `@` completions, and the expansion of file commands and skills before a guest prompt.
- `src/tail.ts`: reads one transcript file incrementally, decodes each line through its format's `decode` from `src/session-formats.ts`, and feeds each entry to both folds below.
  `src/line-reader.ts` holds `FoldedFile`, which keeps a fold of a file's lines up to date, applying only appended complete lines and starting a fresh fold when the file shrinks.
  `src/tail.ts`, `src/media.ts`, `src/changes.ts`, `src/session-facts.ts`, and `src/foreign/usage.ts` each fold transcripts through it.
  The first two queue their reads with its `ReadQueue`, which shares one read among a burst of pokes.
- `src/session-formats.ts`: the registry of agents whose session files the dashboard lists, `SESSION_FORMATS`, each a `SessionFormat` with its root, its `fileOf`, `list`, and `read`, its line `decode`, and the `messageLine` conversation search parses.
  Formats other than omp also name the usage-file patterns and per-file folds for Analytics.
  `ompFormat` wraps omp's own listing in `src/omp/sessions.ts`, which also holds `sessionFileOf`; `formatOf` names the format of a file by the root that holds it, else omp's.
- `src/foreign/claude-code.ts` and `src/foreign/codex.ts`: the read-only readers of Claude Code's sessions under `CLAUDE_CONFIG_DIR` (else `~/.claude`) `/projects` and Codex's under `CODEX_HOME` (else `~/.codex`) `/sessions`.
  Each decodes one line into the omp entries the transcript already folds, preserving recognized blocks alongside one unread-line entry for unknown or malformed content.
  Codex titles a renamed session from `session_index.jsonl`.
  `src/foreign/files.ts` holds `ForeignFiles`, which lists both readers' files from each file's first 256 KB and last 64 KB, and reads a file again only when its size or modification time changed.
  `ClaudeCodeUsage` and `CodexUsage` in their readers fold model requests, with each format's deduplication and session attribution.
  Codex pairs response-id usage records with the following event summary and retains event-only requests and record-only compactions.
- `src/foreign/usage.ts`: `ForeignUsage`, the incremental request index for Analytics, and the request, per-file usage, fold, and pricing interfaces the readers share.
  `src/omp/stats.ts` provides its `listPrice` callback through the bundled `pi-catalog` exports loaded in `src/omp/modules.ts`.
- `src/session-entries.ts`: the vocabulary of a session file's entries, `textOf`, `oneLine`, `entryTime`, `toolCallsOf`, `toolResultOf`, `toolSummary`, `imagesOf`, and `UNREAD_LINE` with `unreadLine`, which the folds below and `src/guest.ts` read instead of walking the entry shape themselves.
- `src/transcript.ts`: folds session-file lines and live events into display items, with a dashboard session's starting prompt last; an unread line shows as a warning notice with the line's start, and a prompt the dashboard sent in the user's place as a `dashboard` item the page hides.
- `src/conversation-search.ts`: the conversation search behind `GET /api/conversations`.
  `Conversations` keeps a fold of each session's own file, not its subagents', with the prompts' and replies' item ids and text: `messageItemsOf` in `src/transcript.ts` names them as the pane's fold does, from one entry alone, decoded by the file's format, and lines that fail the format's `messageLine` go unparsed.
  `SessionFiles` hands it to `SessionFactsIndex` as one of its `OwnFileFolds`, so the index's read of each session file feeds both folds and no file is read twice; the index starts a fresh conversation when the file shrinks and forgets it once the session leaves the list.
  `Conversations.search` then matches those with `everyWord` and reads no file.
- `src/work.ts`: folds session-file lines into the files changed.
- `src/media.ts`: collects the images that a transcript's and its subagents' tools returned, and the image files the session wrote that their calls or results named, for the `media` message.
- `src/trajectory.ts`: folds a transcript's entries into turns, with their injections, requests, tool calls, and usage, for the `turns` message; `TrajectoryTail` reads the file through `FoldedFile` and `ReadQueue`.
  `src/shared/trajectory.ts` holds `Turn`, its steps, and `TokenUsage`.
- `src/replay.ts`: source pinning, original request correlation and settings, detached checkout preparation, owned failure cleanup, immutable original native blobs, `ReplayFold`, and full replay comparison.
  `src/omp/replay-fork.ts` is the installed native prompt-cut and private-fork adapter, including images, skills, unresolved calls, relocation, and additional-directory clearing.
  `src/omp/replay-launch.ts` supplies the private safe LSP overlay, protected RPC launch, resume preparation, and nonce-bound guard readiness.
  `src/shared/replay.ts` defines replay details, markers, check evidence and comparison data, plus ordered tool and complete final-text comparison.
  `templates/omp/agent/extensions/replay-guard.ts` installs the persistent model tool policy and the pre-send check.
  Its `replay/` helpers contain pure local target policy, narrow root normalization, metadata validation, complete-envelope checking, and the request-log reader that `request-log.ts` also exports.
- `src/session-facts.ts`: finds the pull requests and Linear issues each session submitted or worked on, its latest /ship step (`parseShipProgress`), the linked worktree it works in, and the branch it works on; `SessionFactsIndex.factsOf(path)` answers them as one `SessionFacts`.
  Its read of a session's own file also feeds the `OwnFileFolds` it was constructed with, and it knows nothing of what those folds keep.
  The worktree comes from the `cwd` arguments of the session's own bash calls, not its subagents', newest first: the first one in a linked worktree of the session directory's repository, other than the checkout that directory is in, passing over directories outside that repository and stopping with none at a directory that is gone.
  The branch is the one a linked worktree has checked out now, or the one a main checkout had checked out at the session's last write, from its HEAD reflog; a linked worktree's branch, or a main checkout's branch other than the default one that `origin/HEAD` names, links the pull request it heads.
  A refresh keeps git's answer for each branch to itself until the resolve publishes the whole branch at once: its name, whether its worktree is linked, its default branch from one cache per directory, and the pull request it heads.
  `git.ts`'s `worktreeAt`, the head history, and the default branch each answer a directory once per refresh, through the `CheckoutReads` it was constructed with, the repository's `git remote` only for a session whose branch links a pull request or that names one by bare number, and every per-session step of a refresh, transcript scans and git probes alike, runs at most `PROBE_PARALLEL` (16, from `src/map-limit.ts`) at a time, so a first scan of hundreds of sessions starts no burst of git processes.
  `SessionFiles` passes `CachedCheckouts` from `src/git.ts`, which keeps each answer while the files git read for it keep their inode, modification time, and size: the worktree's `HEAD`, its `logs/HEAD` for the head history, `refs/remotes/origin/HEAD` for the default branch, and a reftable repository's `reftable/tables.list` for all three, so a refresh with no checkout moved starts no `git`.
  A refresh asked for while one waits behind the running one joins the waiting one, with the newer list, so a burst of refreshes runs at most two.
  `factsOf` answers one shared empty `SessionFacts` for a session it does not know, and a known session's own arrays, so the facts of an unchanged session stay the same objects.
  A `gt submit` call's branch is the one its `--branch` names, else `branchAt` over `git.ts`'s `headHistory` of the directory it ran in: the branch that the first checkout after the call moved from, else the one checked out now.
