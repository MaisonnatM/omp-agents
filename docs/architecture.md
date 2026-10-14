# How omp-agents works

The server's design, its protocols, and its HTTP API.
For installation, see the [README](../README.md); for the interface, see [Using omp-agents](usage.md); for where each file lives and what it does, see [Code layout](code-layout.md).

- [omp modules](#omp-modules)
- [Transcripts](#transcripts)
- [Terminal sessions](#terminal-sessions)
  - [Why the server joins every terminal session](#why-the-server-joins-every-terminal-session)
- [Dashboard sessions](#dashboard-sessions)
- [Socket requests](#socket-requests)
- [Desktop shell](#desktop-shell)
  - [Packaging and releases](#packaging-and-releases)
- [Terminal panel](#terminal-panel)
- [Plan quota](#plan-quota)
- [Analytics](#analytics)
  - [Context sources](#context-sources)
- [Routines](#routines)
  - [One server runs the unattended work](#one-server-runs-the-unattended-work)
- [Scheduled sends](#scheduled-sends)
- [Projects](#projects)
- [Pins](#pins)
- [Notifications](#notifications)
- [HTTP API](#http-api)
  - [Integrations](#integrations)
  - [MCP servers](#mcp-servers)
  - [Providers](#providers)
  - [Google Calendar](#google-calendar)
  - [New and local events](#new-and-local-events)
  - [Gmail](#gmail)
- [Front-end components](#front-end-components)

## omp modules

The server imports omp's own modules from the installed package, so it does not reimplement a protocol, the encryption, or the session-file format, and it always speaks the same version as the sessions it shows.
`src/omp/modules.ts` loads every module once and checks at startup that each export this app uses exists, naming the omp version and the missing export when one does not.
It finds the package through `omp` on `PATH`, or `OMP_PACKAGE_DIR` when set; with a Bun global install that is `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

Paths in this document that start with `pi-coding-agent/`, `pi-ai/`, `pi-catalog/`, `pi-tui/`, `pi-utils/`, or `omp-stats/` are inside that install, in `@oh-my-pi/`.
They are not in this repository.
The main ones:

- Collab: `pi-coding-agent/src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`.
- Session files: `pi-coding-agent/src/session/session-listing.ts` and `session-loader.ts`.
  `appendCustomMessageEntry` in `pi-coding-agent/src/session/session-manager.ts` gives a `custom_message` entry the timestamp of the message it records, which `#persistMessageEnd` in `agent-session.ts` passes.
- Interrupted turns: `pi-coding-agent/src/session/exit-diagnostics.ts` (`createInterruptedTurnAbortMessage`), which `endsMidTurn` in `src/omp/sessions.ts` uses to refuse forking a session that ended mid-turn.
- Images: `pi-coding-agent/src/session/blob-store.ts`, which moves a prompt's image out of the session file into `blob:sha256:<hash>`, and `getBlobsDir` in `pi-utils/src/dirs.ts`; `src/transcript.ts` and the `/api/image` route read them.
- Provider requests: `emitBeforeProviderRequest` in `pi-coding-agent/src/extensibility/extensions/runner.ts` hands each provider's request body to the extensions in load order, with the request's model as `ctx.model`, and `templates/omp/agent/extensions/request-log.ts` records it.
  The providers call it through `onPayload`; `pi-ai/src/providers/anthropic.ts` still edits the body after the hook to withhold kill-switched fields and to fit server-side compaction, Bedrock, and Vertex, and compaction, branch summaries, and titles never reach the hook.
  `pi-coding-agent/src/cli/gc-cli.ts` keeps a blob while any session file holds its `blob:sha256:` reference, and `putSync` in `blob-store.ts` refreshes a reused blob's time so a reference not yet written to disk survives `omp gc`.
- Documents: `convertBufferWithMarkit` in `pi-coding-agent/src/utils/markit.ts`, the converter behind omp's `read` of a PDF, Word, PowerPoint, Excel, or EPUB file, which `src/omp/documents.ts` calls for `PUT /api/attachment/document`.
- RPC: `pi-coding-agent/src/modes/rpc/rpc-client.ts`, `rpc-frame.ts`, and the frame types in `rpc-types.ts`.
  `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of the child's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](#dashboard-sessions).
  `get_available_models` returns omp's whole `Model` objects, with `name`, `contextWindow`, `api`, `identity`, and `serviceTiers`; `get_state` adds `fastModeEnabled` and `fastModeActive`, and `setFastMode` sends `set_fast_mode`.
  `RpcClient.prompt` resolves with the request id once omp admitted the prompt, and `onPromptResult` delivers that prompt's `prompt_result` (`rpc-prompt-results.ts`); see [Dashboard sessions](#dashboard-sessions).
  Host tools: `RpcClient`'s `customTools` option (`RpcClientCustomTool`), which `start()` sends as `set_host_tools`, so a new process for the same session gets them again; `pi-coding-agent/src/modes/rpc/host-tools.ts` runs them as strict tools, and `defaultLoadModeForToolName` in `pi-coding-agent/src/tools/essential-tools.ts` makes one without `loadMode: "essential"` only discoverable.
  A host tool stays registered through `newSession`, `switchSession`, and `/move` in one process, since omp builds `SessionTools` once per `AgentSession` (`pi-coding-agent/src/session/session-tools.ts`).
  Extensions: `omp -e <file>` (`pi-coding-agent/src/main.ts`, `additionalExtensionPaths`) loads in `rpc-ui` mode too; `pi-coding-agent/src/discovery/omp-extension-roots.ts` dedupes by path only, so the same extension at two paths loads twice.
- Restricted RPC sessions use `createAgentSession` in `pi-coding-agent/src/sdk.ts` and `runRpcMode` in `pi-coding-agent/src/modes/rpc/rpc-mode.ts`.
  The SDK's `restrictToolNames: true` admits only `toolNames` and disables MCP and ambient extension tools before discovery.
  The CLI's `--tools` does not set that policy, and `refreshMCPTools` in `pi-coding-agent/src/session/session-tools.ts` otherwise reactivates connected MCP tools.
  `appendCustomEntry` in `pi-coding-agent/src/session/session-manager.ts` persists the dashboard policy.
  The runner enables read-only LSP when selected and mirrors `main.ts`'s RPC setup, including `PI_NO_PTY`, `PI_NO_TITLE`, and `allowSessionModelFallback: false`.
  It pins declared RPC defaults through `all` and `Setting.pinDefault` in `pi-coding-agent/src/config/registry.ts`, on settings from `Settings.loadIsolated`.
- Service tiers: `serviceTierFamily` and `shouldSendServiceTier` in `pi-ai/src/types.ts`, which `fastAvailable` in `src/omp/models.ts` calls to decide, as `setFastMode` in `pi-coding-agent/src/session/model-controls.ts` does, whether `/fast` can turn on for the live model.
- Settings and discovery: `pi-coding-agent/src/config/settings.ts`, `pi-coding-agent/src/discovery/index.ts`, and `pi-coding-agent/src/task/discovery.ts`.
- Credentials: `pi-coding-agent/src/session/auth-broker-config.ts` (`discoverAuthStorage`) and `pi-ai/src/registry/oauth/index.ts` (`getOAuthProviders`).
  `connectedProviders` in `src/omp/models.ts` keeps the `/login` providers that have a credential, as omp's RPC `get_login_providers` marks them `authenticated`.
  It opens the credential store on each call and closes it, so a login in a terminal counts at the next call.
  Settings › Providers runs omp's own `/login` and `/logout` through `src/omp/providers.ts`: `AuthStorage.oauth.login` (`pi-ai/src/auth-storage.ts`) with `captureBrowserSession` from `pi-coding-agent/src/utils/browser-session.ts` for a cookie sign-in, `formatLoginIdentity` from `pi-coding-agent/src/cli/oauth-terminal.ts`, `ModelRegistry.refreshProvider` from `pi-coding-agent/src/config/model-registry.ts` afterwards, as `omp login` does, and `toLogoutAccounts` and `logoutCredential` from `pi-coding-agent/src/slash-commands/helpers/logout.ts`.
- Model selectors: `parseRetryFallbackSelector` in `pi-coding-agent/src/session/retry-fallback-chains.ts`, which only `readSelector` in `src/omp/config.ts` calls.
  `readSelector` reads a selector against the `provider/id` of the listed models, so a `:level` splits off only after an id that `omp models` lists, and returns the selector's provider, id, and suffix.
  `resolveSelector` keeps the read only when its model is listed, and `routedSelectors` names every selector of the routing: each role's, and each fallback chain's key and entries.
- Model roles: `pi-coding-agent/src/config/model-resolver.ts` (`expandRoleAlias`, `resolveRoleChain`), whose `@role` aliases `resolveRoles` in `src/omp/models.ts` follows for `GET /api/models/roles`.
  `modelEntries` reads each of the `routedSelectors` with `readSelector` and maps it to a listed model with `resolveProviderModelReference`, which follows retired variant ids such as `grok-4.7-high` and dotted spellings such as `claude-fable-5.1`.
- MCP: `pi-coding-agent/src/mcp/json-rpc.ts` (`callMCP`), `config.ts` (`loadAllMCPConfigs`), `client.ts` (`connectToServer`, `listTools`, `disconnectServer`), `oauth-credentials.ts` (`removeManagedMcpOAuthCredentials`), `oauth-discovery.ts` (`discoverOAuthEndpoints`), `oauth-flow.ts` (`MCPOAuthFlow`), and `config-writer.ts` (`addMCPServer`, `updateMCPServer`, `removeMCPServer`, `setMcpServerEnabled`, `validateServerName`, `readMCPConfigFile`), which `src/omp/mcp.ts` wraps for the tickets page, Settings › Integrations, and Settings › MCP servers.
  The MCP sign-ins and sign-outs read and write omp's credential store through the same `discoverAuthStorage`, opened and closed on each call.
  `pi-coding-agent/src/commands/token.ts` uses `refreshStoredManagedMcpOAuthCredential` from `oauth-credentials.ts` to refresh a managed token and persist its rotated refresh token before printing the access token.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory.
- Request usage: `omp-stats/src/aggregator.ts` (`getDashboardStats`, `getToolDashboardStats`, `getTimeRangeConfig`), `rollup.ts` (`getProviderTimeSeries`), `live.ts` (`statsLive`), and `db.ts` (`initDb`).
  `src/omp/stats.ts` reads omp-stats' database and starts its live sync on its first read, which the provider check makes at startup.
- Request context: `buildSessionContext` in `pi-coding-agent/src/session/session-context.ts`, the messages a request on a branch sends, `Tokenizer` in `pi-agent-core/src/tokenizer.ts`, and `resolveModelTokenizer` in `pi-catalog/src/model-tokenizer.ts`, which `src/omp/context-index.ts` uses to count each request's context sources; `getStatsDbPath` in `pi-utils/src/dirs.ts` places its index beside omp-stats' database.
- Request errors: `is402BillingCapBody` in `pi-ai/src/error/rate-limit.ts`, the test omp's credential rotation applies to a 402, which `creditRuns` in `src/omp/stats.ts` uses to tell a provider out of prepaid credits from a 402 that asks for a smaller request.
- Updates: `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts`, the `startup.checkUpdate` and `update.channel` readers in `pi-coding-agent/src/modes/settings.ts`, and `classifyModel` in `pi-catalog/src/identity/index.ts`, which `src/omp/release.ts` and `src/omp/model-updates.ts` use; see [Notifications](#notifications).

## Transcripts

Every transcript comes from the session files on this machine, not from a network connection:

- One recursive file watcher covers omp's sessions directory.
  When a file changes, every open transcript in that directory reads the bytes appended since its last read and folds the complete JSONL lines into display items.
  On macOS a burst of appends can surface only as events for omp's `.<file>.lock` sidecar, which is why a change anywhere in a directory re-reads every open transcript in it.
- A session's transcript is its `<time>_<session id>.jsonl` file.
  A subagent's transcript is `<id>.jsonl` in its parent's artifacts directory, which is the parent's transcript path without `.jsonl`.
  A subagent that outlived a `/new` or `/resume` wrote beside the session it started in, so when the expected file is missing the server looks for the newest `<id>.jsonl` in the project's sessions that changed after the subagent registered.
- A past session reads the same way, so a session that runs without publishing itself keeps updating.
- Live agent events only add what the file does not hold yet: the reply as it streams, and the running state of tool calls.
  omp keeps a message's `timestamp` when it writes the message, so the file's copy replaces the streamed copy in place, and a late event cannot undo it.
  omp writes a fresh session's file only with its first reply.
  Until then the prompt shows from its live event, except a prompt sent from the dashboard to a terminal session, whose file entry has no message timestamp to merge on.
  A `/skill:` prompt is a `custom` message of type `skill-prompt`, and omp writes its `custom_message` entry with the message's timestamp, so it merges on that.
  A queued steer or follow-up keeps the time it was sent, though the agent takes it later.
  So a message from the file never goes ahead of the file messages before it, and a live user message goes after everything already shown.
- A reply that streams and a tool call that runs change with every token.
  Each open transcript sends those changes to the page at most every 50 ms; a message that finishes, a tool call that ends, a prompt, or a notice goes out at once, together with what was held back.
- A dashboard session's view shows a prompt that omp admitted while the main agent was idle as a pending user item, after every other item, until the turn's live user message replaces it ([Dashboard sessions](#dashboard-sessions)).
  It renders as that message will: a `/skill:` prompt as the skill and its arguments, attached files by name, images inline.
  Its id is `starting:<request id>`, and the `items` message that brings the live user message lists that id in `removed`, so the page drops it and appends the real prompt in one update.
  A pending prompt is the only item that leaves a transcript, so `removed` is empty in every other `items` message.
- The same read folds each line into the view's changed files as well, from each `edit` result's `details.path` and `diff` (one per entry of `perFileResults` for a multi-file edit) and each `write` result's `details.resolvedPath`, which omp sets only for a file.
  The view's socket topic carries them as `work` messages: the whole list with the transcript, then only the files each later read changed, which the page puts in place by path.
  A subagent's view folds its own file, so it shows its own changes.
- A `task` result names the subagents it spawned in `details.progress` and `details.results`; the tool item lists their ids, which name each subagent's view.
  A running `task` reports them sooner through `tool_execution_update` events.
- Each watched view also gets a media tree (`src/media.ts`), which collects the images that tool results returned, from the view's file and from every subagent transcript, at any depth, in the directory named after it.
  About half the screenshots in a session sit in its subagents' files, so a session's view collects them all; a subagent's view collects its own and its subagents'.
  An image is a `content` block of a tool result, which omp moves to its blob store, so it reaches the page through `/api/image`; the caption is the summary of the tool call with the same id, and a user prompt's images are left out.
  It reads each file incrementally, parses only lines holding a tool call or an image block, and reads a tool result's call id without parsing the result, so a caption is dropped once its result arrives; it lists the directory again, reading the subagent files at once, after each change under it, so a subagent that starts later is found.
  The watcher's changes poke it only for its own file, that file's `.<file>.lock` sidecar, and anything under its artifacts directory, since a subagent's appends do not touch the session file, and a sibling session's writes leave it alone.
  The view's socket topic carries them as `media` messages: the whole list once the files are read, then only the images each later read added, which the page sorts in newest first.
  A file rewritten shorter, or the first read, sends the whole list again.
- A view whose **Trajectory** a socket shows also gets a trajectory tail (`src/trajectory.ts`), which folds the view's own file into turns: a turn opens at each user message or `custom_message` that the transcript shows as a prompt, so the turns match the Outline's.
  Entries that wait for the model, such as a model change, a `model_usage` side call, a `ttsr_injection`, or a hidden `custom_message`, join the turn in which the next assistant message reads them, and are left out until one does.
  Each assistant message is a request with the `usage` omp recorded on it; `model_usage` entries are only side calls such as auto-thinking and cache warming, so a turn's usage adds both.
  `watch` lists those views in `trajectories`, and the watcher's changes poke the tail as they poke the transcript.
  The socket topic `turns:<view>` carries `turns` messages: every turn once the file is read, then only the turns each later read changed, which the page puts in place by id.
  A page that stops showing the Trajectory leaves the topic, and the tail closes when no socket shows it.
- The server lists the session files through omp's session listing, the code behind omp's session picker, at startup and then once a minute, in case the watcher missed a change.
  Between listings it reads again only the session files the watcher reported, at most twice a second, so a session that streams costs one file read, not a listing of every session.
  The past list skips the empty sessions that omp's picker hides.
  The server looks up files by session id in this listing, so the page never sends a path.
  While no page is connected, it skips building the roster and the past list.
  The past list goes out whole when a page connects; after that the server compares each session with what it last sent and sends only the sessions that changed, joined, or left, so an untouched row keeps its object on the page and skips its render.
  `SessionFiles.past` hands back the same row object while the session's listed file, its facts, and its interruption are the same objects as before, and the comparison skips serializing a row it already sent as that object, so a push while one session streams serializes only that session's row.
- Whenever the list changes, the server also scans for pull requests in each session file whose modification time changed, plus the subagent files in its artifacts directory.
  Like an open transcript, each file reads only the bytes appended since its last scan.
  The first scan reads every session file, 16 sessions at a time.
  On 641 MB across 464 sessions it takes under a second, and the sidebar shows before it finishes.
  A session that names a PR by number alone costs one `git remote get-url origin` in its working directory.
  A `gt submit` call costs, once per directory it ran in, one `git remote get-url origin` and a `git reflog show HEAD` with a `git symbolic-ref HEAD`, which place the branch checked out at the call's time; the server keeps each call's branch for as long as it lists the session.
  A subagent's appends do not change the session file, so its pull requests show once the session writes again, at the latest when it receives the subagent's result.
- The same scan collects the Linear issues each session worked on, by identifier, from the arguments of its Linear MCP calls: a direct `mcp__linear_<tool>` call or a `write` to `xd://mcp__linear_<tool>`, whose `content` holds the arguments as JSON.
  `get_issue` and `save_issue` name the issue in `id`, `list_comments` and `save_comment` in `issueId`; a `save_issue` with no `id` opens one, whose identifier its result's JSON `id` names.
  A UUID is left out, since the tickets page opens an issue by identifier.
  The `/ship` state's `issue` counts too.
  Session rows carry them as `tickets`, the session's own first.
- Each read of the pull request list tells the server which branch heads which pull request in that repository.
  The server then links each session whose `git push` updated one of those branches, whose `gt submit` submitted one, or whose linked worktree has one of them checked out, to that PR, and sends the sidebar the new links.

## Terminal sessions

Sessions started in a terminal are reached through their Collab room:

- Every 1.5 seconds the server lists the local hosts through the registry, and pushes the roster when a row or the registry error changed; the past list goes out again only when a session joined or left.
  The roster goes out the way the past list does: whole when a page connects, then each push carries only the rows that changed or joined, the instance ids that left, and the registry error.
  That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would.
  The guest is how the dashboard prompts a session (`prompt` frames), stops a turn (`abort`), messages a subagent (`agent-cmd` `chat`; the host steers, prompts, or revives it), and cancels a running subagent (`agent-cmd` `kill`).
  It also carries the host's subagent registry (`agents` frames), subagent progress (`bus` frames), the host's model, thinking level, context numbers, and whether a turn runs (`state` frames), and the live agent events.
  The composer enables as soon as the host welcomes the guest.
  Nothing waits on the transcript snapshot that the host then sends.
- The host steers every `prompt` and `chat` that arrives during a turn.
  The guest therefore holds follow-ups and sends the next one when a `state` frame stops reporting `isStreaming`, or when an `agents` frame shows the subagent no longer running; it checks after every frame but the agent events, which cannot end a turn.
  It sends none after a turn that its own `abort` or a reply cut off mid-stream ended.
- The dashboard uses omp's discovery and autocomplete modules for file commands, skills, and file mentions.
  It expands file commands and skills before guest prompt delivery because Collab prompts bypass the host's slash-command pipeline.
  The host still resolves `@file` references in the selected session's working directory.
- If a host starts a new room, for example after `/new` or `/resume`, the server sees the new generation and joins the new room.
  If the link request races the switch and fails with `stale_generation`, the server lists again and retries.
  A host that leaves the registry is marked as no longer running.
- Collab has no frame that ends a host, so ending a terminal session sends `SIGTERM` to its omp process, through a writable room only.
  The guest first lists the registry again and signals only when the same `instanceId` still runs at that pid and hosts the session, so a pid that a host freed and another process reused since the last poll is never signalled.

Terminal sessions send their questions to writable guests as Collab `ui-request` frames, and the guest answers with `ui-response`.
The host races every writable guest against its own terminal dialog, and the first answer wins.
When the question ends anywhere else, the host sends `ui-request-end` and the card goes away.
After a reconnect, the host sends the questions that still wait again.
Read-only rooms receive no questions.

### Why the server joins every terminal session

Subagent status lives in the host's memory.
The session files on disk cannot tell an idle subagent from a parked one.
The guest connection is the one source the protocol offers for live status, and the host already leaves advisor rows out of it.
Joining every session keeps those rows current for sessions that you have not opened, and keeps each room ready for a prompt.

The cost is visible on each host and on its relay (`collab.relayUrl`, by default an internet relay):

- Each listed session counts `omp-agents` as one more participant for as long as the dashboard runs.
  The terminal shows that the guest joined.
- Each session sends its full transcript snapshot through the relay when the dashboard joins it, and every live event after that.
  The dashboard ignores the snapshot.
  Transcripts never travel through the relay.
- The text that says what a subagent is doing comes from live progress events.
  After the dashboard restarts, a subagent's link shows only its status until that subagent reports progress again.

Stop the dashboard to leave every room.

## Dashboard sessions

Sessions started from the dashboard are omp child processes in RPC mode with tool dialogs, spawned through omp's own `RpcClient`.
Unrestricted sessions use the installed CLI with `--mode rpc-ui`; restricted ones use `src/omp/restricted-rpc.ts` with the same SDK and RPC runner.
The desktop build ships the runner as `restricted-rpc.js` beside `server.js`; `OMP_AGENTS_RESOURCES` selects that packaged path.
Restricted launches reject extra extension arguments and host tools instead of dropping them or widening the allowlist.
The page starts one with a single `start` request whose `kind` is `new`, `fork`, or `resume`, and the server answers each with one `started` reply that carries the new session's instance id or the error.
The server picks the instance id before omp spawns, so a question that omp raises while the session opens already belongs to it.
A new session's first message rides on the `start` request: the server spawns omp, sends the message as its first prompt, and answers the page as soon as omp reports ready, with no terminal, registry, or relay involved.
**Resume** spawns the same child in the directory that the session file's header records and opens the file with omp's `switch_session` command.
A new-session `start` carries `tools`, either `null` for the normal CLI launch or a nonempty built-in tool allowlist.
The restricted runner saves it as the custom entry `omp-agents-tool-allowlist` before the first prompt.
`src/omp/tool-policy.ts` reads that entry on the saved branch's ancestor chain before a resume or fork is spawned.
This keeps the restriction through dashboard resumes, forks, and model fallbacks; a normal terminal CLI resume does not read this policy.
Prompts, Stop, live events, subagent progress, and questions stay on the pipe.
A prompt carries omp's `streamingBehavior`, `steer` or `followUp`, so omp queues it during a turn the way its terminal does.
A prompt omp refuses shows as a note in the session, and `LiveSession.prompt` rejects with `PromptRefused`, so a caller that has no one else to tell, such as the socket handler or a session's first message, skips it.
The composer's queue is omp's `queue_update` event.
A `dequeue` message takes one message back with `remove_queued_message`, and the server answers with `withdrawn`, carrying its text and images so the composer can restore both.
A `promote` message, a queued row's **Send now**, is `promote_queued_message`, which moves a follow-up into the steering queue.
An `interrupt` message, Stop, is `abort_and_restore_queue`, which aborts the turn and hands back both queues, steers first, in one `withdrawn` answer; omp's terminal Esc does the same.
omp's restore leaves out a prompt it admitted but never ran, so when the session's starting prompt got no live user message before the abort answered, the session puts that prompt first in the `withdrawn` answer ([Dashboard sessions](#dashboard-sessions)).
A session runs its prompts, interrupts, promotes, and `flush` requests one at a time, in the order the page sent them (a `SerialLane` from `src/serial-lane.ts`), because the socket handlers do not wait for each other.
When an abort follows, omp drops a prompt it has read but not yet run, so an abort that got ahead of a steer would lose it.
Enter on the empty composer sends `flush`, and the session aborts only if omp's queue, read with `get_state` at that moment, still holds a steer; omp then runs that steer as its next turn.
A steer that has left the queue is already in the turn, recorded or streamed into the response, and an abort then would cut off the reply to it, so neither the page's lagging copy of the queue nor omp's terminal rule, which also counts such a steer, decides.
A guest keeps the same order for its `prompt`, `abort`, and `flush` frames, because it expands a prompt before it sends it.
Collab has no queue frames, so a guest answers `promote` by sending the follow-up it holds as a steer, and `interrupt` by taking back the follow-ups it holds before it sends `abort`.
It flushes while the host's `state` frame counts a queued message (`queuedMessageCount`), or while this guest sent a steer that no `state` frame has counted yet.
Plain `--mode rpc` gives the session no `ask` tool.
`rpc-ui` gives it one, and omp sends the `ask` steps and extension dialogs as `extension_ui_request` frames.
omp's `RpcClient` reads those frames but only hands them to its own login flow, so the server reads a copy of the child's stdout through omp's JSONL reader and chunk decoder.
It writes the `extension_ui_response` to the child's stdin as one line, the way `RpcClient` writes its own commands.
omp sends a `cancel` frame when a question ends without an answer, for example after Stop.
A question with a timeout ends with no frame, so the server drops it at its deadline.
omp's RPC mode does not title a session from its first prompt, as its terminal does.
While a session has no title, each user message's `message_end` event makes the server send a bare `/rename` prompt, which omp runs as its own command: it titles the session from the conversation in the background and announces the title with a `session_info_update` frame.
`RpcClient` drops that frame too, so the same stdout copy reads it, and the server then reads omp's state again for the new `sessionName`.
An `agent_end` that ends the run, not one that hands over to a queued follow-up (`isTerminal: false`), makes the session report `turn-ended` with its last reply: the text of the last assistant message that has any, without the suggested prompts `splitSuggestions` takes off, or `null` when none has text; the project runner reads it ([Projects](#projects)).
Stopping the dashboard stops every session that it started.
The transcripts stay on disk, and **Resume**, or `omp --resume <session id>` in a terminal, continues one.

omp acks a `prompt` once it admitted it, but on every turn its auto-thinking classifier (`applyAutoThinkingLevel` in `pi-coding-agent/src/session/model-controls.ts`) holds `agent_start` back by about a second, and a new session's first turn can also wait on MCP discovery (`MCP_DISCOVERY_TURN_WAIT_MS` in `pi-coding-agent/src/session/agent-session.ts`).
So a prompt the main agent takes while idle becomes the session's starting prompt at its ack: the session reports `working` and tells its view, which shows the prompt as pending ([Transcripts](#transcripts)).
`DashboardSession` keeps whether a turn runs, from `agent_start` to the terminal `agent_end`, apart from the starting prompt, and reports `working` while either holds.
Both live in its `PromptTurn` (`src/prompt-turn.ts`), which moves them on each event, and the session tells the page when a move changed the starting prompt or the status.
The starting prompt ends at the live user message of its turn (`message_start` or `message_end`, or the user's `skill-prompt` custom message), at its `prompt_result`, at Stop or an edit's abort, when the session switches files, or when the process exits.
omp sends one `prompt_result` per admitted prompt once its work settled, at once for a prompt that failed or that a usage preflight or an extension stopped before a turn (`pi-coding-agent/src/modes/rpc/rpc-prompt-results.ts`), and `RpcClient.onPromptResult` hands it over by request id.
Its `prompt_result` can reach the session before the ack's await resumes, so results that come while a prompt waits for its ack count against it.
A prompt sent while a turn runs is queued as a steer or follow-up, and so is one sent while a prompt is starting, since omp counts a prompt in flight as streaming, so the session holds at most one starting prompt.
A prompt whose `agent_start` came before its ack is not held, and neither is a `/` prompt other than `/skill:`, since omp completes a builtin slash command itself, with no turn and no `prompt_result`.
A session's first message, a suggestion, and an edited prompt all take this path.

`src/server/interrupted.ts` keeps which of those sessions were interrupted, in `interrupted.json` beside the access token, and which of them were mid-turn (working or waiting on a question).
Each time a dashboard session starts, exits, or starts or ends a turn, the server writes the session ids of the ones that run and of those whose turn runs.
A session that exits without the page's `end` request joins the interrupted list, mid-turn if its turn ran.
A server that crashes writes nothing more, so at its next start it reads the ones that ran as interrupted, with the turn state they last had.
A session that runs again leaves the list, and `dismiss-interrupted` takes one out.
Each past row carries `interrupted`.
`resume-all` resumes several past sessions at once, each the way a `start` with `resume` does, then sends `continue` as a prompt to each one that stopped mid-turn.
The server answers with one `resumed-all` that names the instance id of each session that started and the errors of those that did not.
A terminal session keeps running when the dashboard stops, so the server tracks none of them.

A subagent of a dashboard session takes a message through omp's `steer_subagent` command and stops with `cancel_subagent`; both reach only a subagent that runs, so the server offers them only for rows whose status is `running`.
A prompt that starts with `!` goes to omp's `bash` command, which runs it in the session's directory and records a `bashExecution` message in the session file; the transcript shows that message as the user's command and output.
omp appends that record without the lock churn that the watcher reports on macOS, so the server re-reads the file itself once `bash` answers.
A built-in slash command runs from a plain `prompt`, and omp sends what it prints as `command_output` frames and a model switch as `config_update`.
`RpcClient` drops both, so the same stdout copy reads them: the server shows the output as a notice when the user's last prompt was a `/` command, which leaves out what the titling `/rename` prints, and reads omp's state again after a model switch.
An `edit-prompt` message rewinds a dashboard session in place: inside the same `SerialLane`, the server aborts a running turn, sends omp's `branch` command with the last prompt's entry id, and reads omp's state for the new session id and file.
omp writes the history before that prompt to a new file and keeps the old one, which then lists as a past session; a branch from the first prompt has no history, so omp writes its file only with the edited prompt's reply.
The session follows the new file the same way it follows a `/move` below, in its current directory and without waiting for that file to exist, then reports `switched`, so the server points its views at the new file before it sends the edited text as a plain `prompt`, whose events then land in the new transcript.
A Collab terminal session has no `branch` frame, so only a dashboard session offers the edit.
omp's `/move` sends `config_update` too, and the state read after it finds a new session file: the session takes its working directory from that file's header, clears its subagents when the session id changed, and reports `switched`, so the roster and the views follow the moved file.
omp writes a moved session that has no reply yet only with its first reply, so until that file exists the session keeps its old file and directory, and a later state read follows it.
The composer's directory picker sends `/move <path>` as a plain `prompt`, only to an idle dashboard session, since omp refuses to move while a turn runs.
The dashboard serializes model, effort, and fast-mode setters with state reads in a separate `SerialLane` from turn commands.
Event-driven refreshes coalesce while queued, so a read cannot overwrite a later switch, and switching stays visible until every queued model change has finished.

A `prompt` message, and a `start` of kind `new`, carry `images`, each `{ data, mimeType }` with the file's bytes in base64, as omp's `ImageContent` takes them.
`parseImages` in `src/shared/sessions.ts`, which `src/server/wire.ts` uses, accepts PNG, JPEG, GIF, and WebP, up to `MAX_PROMPT_IMAGE_BYTES` (32 MB) per prompt, and a prompt of images with no text.
The socket's `maxPayloadLength` is 64 MB so such a message fits.
A dashboard session passes the images to omp's RPC `prompt`; a terminal session's guest puts them on its Collab `prompt` frame, a held follow-up included.
omp's `steer_subagent` and Collab's `agent-cmd` `chat` take text only, so a subagent's prompt with images is refused.
omp writes a prompt's images inline into the session file and then moves each to its blob store, `~/.omp/agent/blobs/<sha256>`, leaving `blob:sha256:<hash>` in the file.
A user item's `images` holds a `data:` URL for an inline image and `/api/image?hash=<sha256>&type=<image type>` for a moved one; that route serves the blob file as `type`, which must be one of the four prompt image types, since the store keeps none.

A prompt's other files travel as text, so they reach a subagent and a terminal session's Collab frame too, neither of which takes images.
`web/components/prompt-attachments.tsx` reads each file as it attaches: a file that is UTF-8 without a NUL byte, and not a PDF, is its own text, and any other goes to `PUT /api/attachment/document`, whose body is `{ name, data }` with the bytes in base64, up to `MAX_PROMPT_DOCUMENT_BYTES` (32 MB).
The route hands the bytes and the name's extension to omp's `convertBufferWithMarkit` and answers `{ text }`, the Markdown omp reads; a format omp cannot convert, or a file it fails to read, answers 422 with omp's reason, which the composer shows in its note.
`withFiles` in `src/shared/prompt-files.ts` puts each file after the typed text in the block omp's `@file` arguments write, `<file name="…">`, its text, and `</file>`, so a leading `/skill:` or file command still expands with the files as its arguments.
`preparePrompt` in `web/prompt-attachments-model.ts` keeps the files' text under `MAX_PROMPT_FILE_CHARS`, a million characters, in attach order, both as files attach and on the files a prompt sends, after awaiting each file's read.
omp saves the prompt as that text, so `userPrompt` in `src/transcript.ts` splits the trailing blocks off again with `splitFiles`, and a user item's `files` holds their names, which the transcript shows as chips.

## Socket requests

A page tags a message it waits on with an `ack`, counted per page load, and the server answers it with `done`, carrying the error its handler threw or `null`.
`request` in `web/use-dashboard.ts` sends that way prompts, answers to questions, starts and **Resume all**, interrupts, ends, edited prompts, model, thinking, and fast switches, subagent cancels, a routine's **Run now**, and each change to the scheduled sends.
A model switch's `done` comes once omp switched, or refused, and the session read its state again; the composer's picker waits on it, and a roster row's `switching` only tells other pages that a switch runs.
A message the page does not tag, such as a pin, a todo change, or a queued row's **Send now**, is dropped when the socket is down, as before.

A socket can close after the server got a request and before its answer reached the page, and the page cannot tell that from a request the server never got, so it may not simply send it again: a prompt would reach the session twice.
So the page picks an id once per load, `crypto.randomUUID()`, and opens `/ws?page=<id>`, and `RequestLedger` in `src/server/request-ledger.ts` keeps each page's requests by `ack` across its sockets.
A request runs once, and its replies to the page that sent it (`withdrawn`, `started`, `resumed-all`) and its `done` are recorded and sent to whichever socket the page has open at the time.
Each socket the page opens sends `resume` after `watch`, with every tagged message the page still waits on.
The ledger sends the recorded replies of each request it ran, and its `done` once settled; it runs a request it never got; and it forgets every request the page no longer lists.
A reply for a live session goes only to a socket that shows it, which a resume after `watch` already knows.
Each tagged message also carries `floor`, the lowest `ack` the page still waits on, and the ledger forgets the requests below it.

The ledger first hears of a page at its `resume`, which then lists only requests the page sent before this server knew it: to a server that has since restarted, or to this one more than an hour ago, since the ledger forgets a page an hour after its last socket closed.
Each of them gets `done` with the error `FORGOTTEN`, "The server restarted or lost track of this page before it answered. Check whether it took effect.", and the ledger records that answer, so a later resume gets it again and nothing runs.
A tagged message from a page the ledger does not know yet is logged and dropped, which the page never sends, since every socket sends `resume` first.
Replies and `done` go to the page's current socket; `Peer.socket`, the socket a message came on, is only for `watch`, which sets that socket's views.
A request the page makes while disconnected rejects at once with "Not connected to the server.", and one it made before keeps waiting across the reconnect, with no time limit.
A prompt that fails comes back to the composer with its files and a note, and a failed answer lets the question card take another.
A handler's error goes to the server's log once, with its message type, on the run that threw.
A page loaded before page ids tags its requests with no `floor`, so the server drops them until the page reloads.

`ListRegistry` in `src/server/list-registry.ts` owns the whole-list snapshots for todos, routines, scheduled sends, workspaces, pins, presets, projects, and notices.
`Dashboard` registers each typed message builder once, beside its store's edit function when it has synchronous edits.
`Broadcasts.open` iterates these registrations, so a new list needs no separate opening-snapshot or push method.
`Broadcasts.pushList(kind)` uses that same builder and suppresses an identical whole-list message; roster and past messages still send their row-level deltas.
Socket edits, workspace HTTP edits, todo inbox changes, and routine pin changes go through the registry's typed `apply`.
An edit that changes the list publishes it to every listener; one that changes nothing instead resends the authoritative snapshot to its requesting peer, if there is one.
Routine and scheduled runner actions and asynchronous notice actions remain separate, publishing their list through `pushList` when they change it.

## Desktop shell

`desktop/` is the desktop app: an Electron main process, `desktop/main.ts`, in its own package, so the root `bun install` never fetches Electron.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls, so the shell runs the server as a child process on Bun and never imports it: `bun src/server.ts` from a checkout, and in the packaged app the Bun binary it ships in `Contents/Resources/server/bin/bun` on the bundled `server.js`, with `OMP_AGENTS_RESOURCES` naming that directory (`src/server/resources.ts`) so the server reads its prebuilt page and the starter kit from it.
omp's sessions run on that same Bun, through `process.execPath`.
It imports only `src/paths.ts`, `src/json.ts`, `src/server/auth.ts`, `src/server/address.ts`, `src/user-todos-parse.ts`, `src/user-todos-shared.ts`, and `src/user-todos.ts`, which use Node's modules alone; `bun build` bundles them into `desktop/dist/main.cjs`.
It reads `todos.json` through `parseUserTodoList` for the Dock badge, watching the file's directory since the server replaces the file, and its global quick-capture shortcut dispatches `QUICK_TODO_EVENT`, from `src/server/address.ts`, in the page, which `web/app.tsx` answers by opening the command palette on its **Create todo** view.
`src/server/address.ts` holds what the two processes must agree on: the port from `PORT`, the host names the server answers to, and the line it prints once it listens.

- At launch it calls `loadToken`, as the server does, so whichever runs first creates the token file, and asks `GET /?token=<token>` on the port.
  A 302 that sets the cookie can come only from an omp-agents server that holds this token, and the window uses it.
  A refused connection starts a server.
  Any other answer means the port is taken, and the window says so.
- The shell takes the server as started once it prints `listeningLine` (`omp-agents (omp v…) on http://127.0.0.1:<port>`), not once the port answers: another server that took the port while this one built its page would answer too, and the shell would then own a server that is about to fail.
- It spawns the server with `OMP_AGENTS_PARENT=stdin` and an open stdin pipe that it never writes to.
  The server calls its `shutdown()` when that pipe ends, which it does however the shell exits, `SIGKILL` included, so no server outlives the app and holds the port.
  On a normal quit, the shell sends `SIGTERM` and waits up to 10 seconds for the server to end its sessions.
- The window loads `http://127.0.0.1:<port>/?token=<token>`, a navigation that sends `Sec-Fetch-Site: none`, so `guardsFor` admits it as it admits the printed address in a browser, and the socket's `Origin` matches its `Host`.
  A custom scheme for the page would fail that check.
- `setWindowOpenHandler` denies every new window and hands `http:` and `https:` addresses to `shell.openExternal`; `will-navigate` does the same for any address outside the dashboard's origin.
  An empty `window.open`, which a browser tab opens before it knows the address, returns `null`, so the MCP sign-ins in `web/use-sign-in.ts` then open the address themselves once the server names it.
- The page runs with context isolation and the sandbox on, and no preload: it gets no Node or Electron API.
- The app keeps its data, its cookie, localStorage, window bounds, and single-instance lock, in `port-<port>` under Electron's `userData`, so a smoke run on another port is an instance of its own beside your app.
- A main-frame load of the dashboard that fails (`did-fail-load`), for example after the server the window used stopped, shows the shell's error page with **Retry** instead of Chromium's.
- The packaged app, launched by Finder or at login, gets no shell environment, so `desktop/shell-env.ts` runs the login shell (`$SHELL -ilc`) once at startup and merges its environment into `process.env` before the server starts; omp, `gh`, and `git` are then found as in a terminal.
- **Open at Login** is the packaged app's own login item (`setLoginItemSettings`); a checkout has none, and the app removes the LaunchAgents that `bun run desktop` once wrote.
- `desktop/updates.ts` updates the packaged app through electron-updater from GitHub Releases: a check 15 seconds after launch and then every 30 minutes, a download in the background, a notification, and **Restart to Install** in the app menu, which stops the server first; an update left waiting installs when the app quits.
  Squirrel.Mac installs only an update signed by the same Developer ID as the running app, so ad hoc builds check and download but never install.

### Packaging and releases

`scripts/build-desktop-artifact.ts`, modeled on T3 Code's script of the same name, builds `desktop/dist/resources` (the server bundled into `server.js` with Tailwind left out, the page prebuilt by `buildPage`, and the starter kit with its installer bundled into `install.js`), downloads the Bun of the build's own version for each architecture into `desktop/dist/bun-<arch>`, and runs electron-builder with a config it generates, which writes a DMG, a zip, their blockmaps, and `latest-mac.yml` to `desktop/release`.
It signs and notarizes when `CSC_LINK` and the `APPLE_API_KEY*` variables are set, with the hardened runtime and `desktop/entitlements.mac.plist`, which lets Bun JIT; otherwise it signs ad hoc.
`--mock-update-port <port>` points the update feed at `scripts/mock-update-server.ts`, which serves `desktop/release`, to try an update without publishing.
`.github/workflows/release.yml` runs on a `vX.Y.Z` tag matching `desktop/package.json`'s version: the checks, one build for arm64 and x64 on an Apple silicon runner, and a GitHub Release with every artifact.

## Terminal panel

The panel's shells run on the server, in pseudo-terminals from Bun's `terminal` spawn option, so the dashboard needs no native module.
`src/terminals.ts` owns them: `Terminals.open` starts `$SHELL -l` (else `/bin/sh -l`) in a directory with `TERM=xterm-256color`, without the server's `PORT` and `OMP_AGENTS_PARENT`, and a shell lives until it exits, its tab hangs up on it, or the server's shutdown calls `Terminals.dispose`.
At most `MAX_TERMINALS` (16) shells run at once; `Terminals.open` refuses another until one exits, so a page cannot fork shells without bound.
Each shell keeps its last megabyte of output in `Scrollback`, which drops whole chunks from the front, and replays it to every socket that attaches, so a reloaded page shows what the shell printed.

- `GET /api/terminals` answers the running shells as `TerminalInfo[]`, `{ id, cwd, cwdDisplay }`, from which a reloaded page reopens its tabs.
- Each tab opens its own socket, `/ws/terminal?cwd=<dir>&cols=<n>&rows=<n>` for a new shell or `/ws/terminal?id=<id>` to attach to one; `terminalSocketPath` in `src/shared/terminals.ts` builds both.
  `parseTerminalQuery` in `src/server/wire.ts` checks the query, holding the size to 1–1000; `terminalFor` in `src/server/terminal-socket.ts` resolves `cwd` through `directoryOf` and answers 404 for one that is no directory, such as a removed worktree, 404 for an unknown `id`, and 429 past the cap, all before any shell starts.
  A reloaded page reattaches to its shells by `id`, which starts none.
  The upgrade passes the same guards as `/ws`, and a shell opened for an upgrade that fails is killed.
- Binary frames carry the shell's bytes both ways.
  Text frames carry JSON control messages: the server sends `TerminalServerMsg`, `opened` with the `TerminalInfo` once and `exit` with the shell's code, then closes the socket; the page sends `TerminalClientMsg`, `resize` or `kill`, which `parseTerminalMsg` checks.
  The page shows **Starting shell…** until `opened` and a close spinner until the socket closes.
  Closing the socket detaches without ending the shell, so closing a tab, even one still starting, sends `kill`, which the page's `terminalSender` holds until the socket opens, and the tab stays until the socket closes.
- `src/server.ts` serves both socket kinds from one `Bun.serve`, its data typed as the union of `SocketData` and `TerminalSocketData`, and `isTerminalSocket` routes each handler to `src/server/terminal-socket.ts` or the `Dashboard`'s session socket.

## Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI.
omp builds those reports from its auth storage, extensions, and credential broker, so the server reads the command's output instead of rebuilding that setup.
omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code.
When the output is not a usage report, the footer shows the last line omp wrote to stderr.
`parsePlanUsage` keeps each limit's omp id and whether omp reports it `exhausted`, which, when omp gives no status, means nothing is left; a window omp lets run past its limit, as Codex's does, is not used up.
It keeps a report's `resetCredits` as omp's `availableCount`, which counts banked credits whether or not one can be redeemed now, and the soonest expiry among the credits omp counts, those neither `expired` nor `redeemed` with some left, or `null` when it is 0.

## Analytics

omp-stats owns the request history in `~/.omp/stats.db`, under omp's config root.
`src/omp/stats.ts` starts `statsLive()` on its first read, which the provider check (see [Notifications](#notifications)) makes at startup; it syncs every session transcript, watches for changes, and resyncs every five minutes until the server stops it on shutdown.
The dashboard calls omp-stats' rollup-aware total, model, agent-type, and tool reads from the selected range's cutoff, then groups request rows by session file for the top sessions.
omp-stats' `getTimeRangeConfig` gives each range's cutoff and bucket, except `today`, which starts at the server's local midnight with hourly buckets.
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

### Context sources

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

## Session presets

`src/shared/presets.ts` defines each preset and its reducer and parser, and `src/server/presets-file.ts` stores them in `presets.json`.
The first load seeds Minimal, Review, and Ship from the connected model roles; subsequent loads preserve edits and an intentionally empty list.
The roster topic carries the whole list in `presets`; a `preset` message applies one save or removal through `ListRegistry`.
The new-session picker copies a preset into the draft, while routines retain its id and resolve it at run time.
The shared preset store reloads before edits and routine lookups, and each minute refreshes the list from other servers.
`GET /api/tools` lists the installed omp built-in names from `pi-coding-agent/src/tools/builtin-names.ts` for the settings editor.
An allowlist permits tools but does not enable tools disabled in omp's config.
Sandbox state is not stored until the sandbox feature exists.

## Routines

A routine starts dashboard sessions, or runs a shell command, on one or more schedules. A schedule is every so many minutes, counted from the last run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST. The routine is due at the earliest of them. Two intervals share that last run, so the shorter one decides.
Its task is one prompt or one command.
The prompt ends with `UNATTENDED`, which tells the session not to ask questions.
A prompt routine stores a nullable preset id and reads the preset at run time for model, thinking, tools, and branch policy.
The routine's own skill overrides the preset's skill, and a removed preset fails the run.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops a routine whose task was pull requests.
A prompt task from before `pin` reads as unpinned.
The rest of the file stays.
The next save writes `schedules` and `pin`.
A file that is not a list of routines still moves aside.
`parseRoutineSpec` in `src/routines.ts` checks each routine's fields both for the file and for the socket's `routine` save, so the two hold the same limits.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, and one `outcome`: `pending` from its claim, with whether it is still `queued`; a `session` with the instance and session ids it started; or a `command` with the command's result once it ran.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, a started session a `session` (the first, of the several that a pull request routine's run started), and otherwise `pending`, queued when its `queued` is set or its `queue` list holds an entry.
A run stays queued from its claim until the drain starts its session or command.

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected, and only on the server that owns routines; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Ticks and **Run now** claims share one `SerialLane`: a tick that finds the lane busy is skipped, and a **Run now** waits its turn.
Each tick does three things, in order:

1. It claims each due slot: it saves a new queued run before it starts anything.
   Slots missed while the dashboard was closed or the Mac slept coalesce into one run at the next tick.
2. It starts the queued runs, oldest first, while fewer than 3 routine sessions are busy; a command takes no session slot, so a command run starts even when they are all busy.
   It starts each prompt session through the same `start` the page uses.
   A failed start goes to the run's errors, and the next run tries again.
   A prompt routine whose last session still runs records an error instead of starting a second one.
   A command starts through the runner's `exec`, `runShell` in `src/proc.ts`, and the drain does not wait for it, so a tick never blocks for minutes.
   `runShell` runs `/bin/sh -c` in the workspace with stderr merged into stdout, keeps the last 64 KB of output, and stops the command after 10 minutes.
   It spawns the shell in its own process group and stops the whole group with SIGTERM, since a command's own children would otherwise keep running and hold the output pipe open.
   When the command ends, the runner writes its exit code, output, and times to the run; a non-zero exit, a stop, or a failed spawn also goes to the run's errors.
   The runner keeps the routines whose command runs in memory, since a run holds one outcome and later `run-now` claims can push a running command's run out of the saved 10; a command routine whose last command still runs records an error instead of running a second one.
3. It retires finished sessions: once a session that worked is idle, the runner ends it.
   When the routine's prompt task sets `pin`, the runner first unpins the sessions of the routine's other runs and pins this one through `changePins`, then ends it, so its row moves from **Running** to **Pinned** without passing through **Past**; other pins stay.
   A session ended at the start deadline, or one that is gone, is not pinned.
   A session counts as working from the first time its row shows it working or waiting on a question, at its start, at a tick, or at any change of its row, which the server passes to `observe`.
   `observe` also ends a session as soon as its row shows the turn over, so a finished session frees its slot at once rather than at the next tick.
   Its transcript stays a past session, and **Resume** continues it.
   A session that waits on a question holds its slot.
   A session that is still in its `starting` phase 10 minutes after its start (`SESSION_START_DEADLINE_MS`) never began its turn: the runner records that on the run as an error, releases the slot, and ends the session.

Running a tick twice starts nothing new, since the slot is claimed, and a tick that comes while one runs is skipped.
A crash after a claim loses no queued run, since it is on disk. A start that had not finished waits for the routine's next slot.
After a restart the runner tracks no session, which is right, because the dashboard's sessions die with the server.
Stopping the server stops every running command, right before it exits, so the result of a command it stopped is never saved as a time-limit stop.
A run saves its command as `running` before the command starts, then as `exited`, `stopped`, or `failed` when it ends.
No command resumes after a restart: the server that owns routines turns each run still saved as `running` into `stopped` by the dashboard, with that error, when it starts or takes over (`RoutineRunner.recover`).

A `routine` socket message carries one change: `save`, `remove`, `enable`, or `run-now`, which claims a slot now, whatever the schedules, and drains it.
Every socket hears the routines after each change and each step of a run as a `routines` message on the roster topic, also sent when a socket opens.

### One server runs the unattended work

Servers on different ports share `~/.config/omp-agents`: your app and a smoke run, say.
Routines, the todo inbox, and the daily clean-up of checked todos write that directory without anyone asking, so one server at a time runs them.
`src/server/owner-lock.ts` decides which, with `server.lock`, a file that holds `{pid, port}` of the owner.
A server creates it whole through a draft file and a hard link, so a reader never sees half of it, and it takes over a lock whose process is gone or whose content is not a lock.
A process id that another program reused keeps the lock held; delete `server.lock` to release it.
At startup a server that does not own the lock logs once which port does, and the minute tick tries again.
On a takeover the server logs it, reads `routines.json`, `todos.json`, and `projects.json` again, since the previous owner kept saving them, fails the runs that were running and the scheduled sends left sending, and drains the todo inbox.
A server that exits normally deletes its lock.
The servers that do not own it still serve their pages, start sessions, and take what you do in them, such as editing a routine, a todo, or **Run now**; only the minute tick's routines and scheduled sends, the todo inbox, and the end inbox's requests for sessions started in a terminal are left to the owner.
Each server keeps its own copy of `routines.json` and `todos.json` in memory and saves whole, so the last server you edited in wins until the owner changes.
`projects.json` is the exception: every server runs its own project runner, which writes on every worker turn, so `ProjectsFile` is a `shared` `ReducerFile`, which reads the file again before it applies a change, and a change made on one server keeps what another saved.
`ScheduledFile` is shared the same way, so a send added on any server reaches the owner.

## Scheduled sends

A scheduled send is one message to a session, or one new session's start, that waits for a time; see [Send later](usage.md#send-later) for what the user sees.
`src/shared/scheduled.ts` holds its shapes, `ScheduledSend`, `ScheduledTarget`, and `ScheduledChange`, and the rules the server applies, `applyScheduled` and `isDueSend`.
A target is `{ kind: "message", sessionId, text }` or `{ kind: "start", request }`, where `request` is the `NewSessionRequest` that the new-session draft's **Start session** would send, without images.
The page resolves a plan window's reset to a time before it sends the change: `at` is the window's `resetsAt` plus `RESET_MARGIN_MS`, one minute, and `reset` only names the window for the lists.
So a send never moves when `omp usage` later reports another reset time.

`src/server/scheduled-file.ts` keeps the sends in `scheduled.json` beside the access token, as `{ sends }`, soonest first, and moves a file that holds anything else to `scheduled.json.invalid`.
A send's `state` is `waiting`, `sending` from its claim until it reaches omp, or `failed` with the error and its time; a send that reaches omp leaves the file.

`src/server/scheduled-runner.ts` sends them.
Its `tick` runs on the minute tick, before the routine runner's, only on the server that owns the unattended work, and sends each due waiting send in turn.
`sendNow` sends one at once on whichever server the page talks to, a failed one too.
Either way the runner first claims the send and writes `sending` to the file at once, so a second tick or another server never sends it twice.
A message goes through `reach`, which `Dashboard` builds once for this runner and the project runner: the live session with that session id, else that session resumed through the same `start` the page uses.
The runner sends it through its `prompt` as a `followUp`, a follow-up while its turn runs and a prompt otherwise, as a project's updates go.
A start goes through `start` as the page's would, so the todo it names is linked the same way.
A failure, such as a session that cannot resume or a start that fails, saves the error on the send, which waits for **Try again** or **Dismiss**.
A send that a stopped server left `sending` may have reached its session, so the owner fails it at its start or takeover (`ScheduledRunner.recover`) rather than sending it again.

A `schedule` socket message carries one `ScheduledChange`: `add`, whose `id` the page picks so an add sent twice adds once, `remove`, which cancels a waiting send or dismisses a failed one and leaves one under way, `take`, or `send-now`, which answers once the send went or failed.
`take` is **Edit**'s: it takes a waiting or failed send off the schedule and writes the file at once, as a claim does, so the server that sends reads it gone.
`applyScheduled` throws for a `take` of a send that is gone or under way, which may already have reached its session; the request's `done` carries that error, and the page puts the text back in the composer only after a `done` without one.
`parseScheduledSpec` in `src/shared/scheduled.ts`, which `parseScheduledChange` in `src/server/wire.ts` and `src/server/scheduled-file.ts` share, holds a message's text and a start's prompt to `MAX_SCHEDULED_TEXT`, a million characters, and refuses images, an empty text, and a start that resumes.
Every socket hears the sends after each change and each claim, send, or failure as a `scheduled` message on the roster topic, also sent when a socket opens; a change that changes nothing sends them back to its own socket alone.
Each server also reads the file and sends the list on its minute tick, so pages on a server that does not send see what the owner did.
A send is at most a minute late, and one whose time passed while no server ran goes at the first tick after one starts.
A message whose session runs live on a server that does not own the unattended work goes to a resumed copy on the owner, since each server reaches only the dashboard sessions it started.

## Projects

A project is a coordinator session that plans the work and starts worker sessions, which all share one notes directory; see [Projects](usage.md#projects) for what the user sees.
`src/shared/projects.ts` holds what the page reads and sends: `Project`, `Worker`, `ProjectUpdate`, `ProjectEdit`, `DEFAULT_PROJECT_NAME`, and `workerPhase`, which turns a worker's live status, or its absence and whether it was interrupted, into `working`, `asking`, `idle`, `interrupted`, or `ended`.
The rules only the server applies live in `src/server/projects-file.ts`: `ProjectChange`, the page's `ProjectEdit` plus the runner's changes, `applyProject`, which returns the same array for a change that changes nothing, `ProjectRole`, and `ProjectsFile.roleOf`, which finds a session's project and role by its session id.

`ProjectsFile` keeps the projects in `projects.json` beside the access token, as `{ projects }`, and moves a file that holds anything else to `projects.json.invalid`.
A project holds its `id`, `name`, workspace `cwd`, `createdAt`, `archived`, `coordinator.sessionId`, `workers`, in id order, `updates`, the ones not yet delivered, oldest first, and `nextWorker`, the number the next worker's id takes.
A worker holds its id (`w1`, `w2`, …), `title`, `sessionId`, `cwd`, `startedAt`, and `lastReply`, `{ at, text }`, with empty text for a turn that ended on none, or `null` before its first turn ends.
An update holds its id, worker id, time, and one `kind`: `finished`, whose reply is the worker's `lastReply`, `asked` with the request id and the question, or `stopped`.
The `update` change keeps one `finished` per worker: a later one replaces the earlier, since both would quote the same last reply.
The servers are the file's only writers.
The page sends `rename` and `archive` in a `project` socket message (`ProjectEdit`), and creates a project with `project-create`, `{ reqId, name, cwd, prompt, model, thinking }`, which the server answers with the same `started` reply a `start` gets; `ProjectRunner` in `src/server/project-runner.ts` makes every other change.
Every socket hears the projects after each change as a `projects` message on the roster topic, also sent when a socket opens; an edit that changes nothing sends them back to its own socket alone.
An older version kept the workspace list under the same name, so the `Dashboard` constructor first calls `adoptOldWorkspaces` from `src/server/workspaces-file.ts`, which moves a `projects.json` in that shape to `workspaces.json`, and only then builds `ProjectsFile`.
omp's `projects` extension reads the file too, and cannot import `src/`, so it declares the fields it reads by hand.

A session belongs to a project by its session id, which the file keeps, so a resume finds its role again.
The runner tracks each live project session by instance id, with its role and its current session id.
When a dashboard session reports `switched`, after a `/move` or an edited prompt, the runner applies `relink`, which points every reference to the old session id at the new one.

The starter from `src/server/start.ts` takes a `StartRequest`, which is what the page sends, and a server-only `ProjectLaunch`, which only the runner passes: `create` for a new project's coordinator, `new-worker` for a worker with its title, or `rejoin` with a role; a page's start passes `null`.
It asks the runner's `launchFor(request, launch)` how to start, which for `null` finds a `resume`'s role by its session id (`rejoin`), and none for a `new` or a `fork`.
`launchFor` answers a `ProjectJoin`: the `RpcLaunch` to spawn omp with, `PLAIN_LAUNCH` for no project, and `attach`, which the starter calls once the session is in the registry and before its first prompt.
A project session's `RpcLaunch` holds `projectsExtensionArgs()` and, for a coordinator, the four host tools of `src/server/project-tools.ts`, bound to its project.
`projectsExtensionArgs()`, in `project-runner.ts`, is `-e` with this repository's `templates/omp/agent/extensions/projects.ts` while `~/.omp/agent/extensions/projects.ts` does not exist, and nothing once it does, since omp would load the same extension at two paths twice.
Every spawn of a coordinator gets its tools, a resume included, since the process that serves host tools hands them to omp as it starts; a coordinator resumed in a terminal has none.
`attach` saves what the launch makes: `create` saves the project, its workspace the session's directory, and seeds its notes, and `new-worker` applies `add-worker`, which gives the worker the project's next id and bumps `nextWorker`.
It then flushes the file, because `JsonFile.save` writes at the end of the event-loop turn and the extension reads the file at the first prompt, and tracks the session by the role the file now gives it.
So a coordinator that fails to start saves no project, a worker that fails to start takes no id, and workers take their ids in the order their sessions start; `startWorker` reads the id back from the tracked session.
A worker starts in the directory `start_worker` names, read through `expandHome` in `src/paths.ts` and resolved against the project's workspace, else in the workspace, on omp's default model, with no branch of its own.

The coordinator's tools are strict host tools, every property required, loaded as `essential`: `start_worker` (`title`, `prompt`, `cwd`), `list_workers`, `read_worker` (`worker`), and `message_worker` (`worker`, `text`).
An error a tool throws reaches the coordinator as the tool's error, and every tool throws once the project is archived.
`message_worker` prompts the worker as a follow-up, reaching it through the same `reach` as a scheduled message, so a worker that does not run resumes first.

A worker's session reports three kinds of news, which the runner saves as updates:

1. Its `turn-ended` update saves the reply as the worker's `lastReply`, empty when it had none, and becomes `finished`.
2. Each roster change, which the server passes to `observe`, reports every question the worker waits on whose request id the runner has not reported for that live session, as `asked`, so a question is reported once.
3. Its process's exit becomes `stopped`, unless the dashboard is stopping: `Dashboard.stop` calls the runner's `stop` before it ends the sessions, since they exit with the dashboard, which is no news.

The runner saves each update in `projects.json` at once and then delivers.
When the coordinator's session runs and its status is `idle`, the runner sends every waiting update, in order, as one prompt that `updateText` builds, starting `[omp-agents] Project update.`, quoting at most `REPLY_QUOTE_CHARS` (2,000) of each finished worker's `lastReply`, and telling the coordinator that only the user answers an `asked` question, in the dashboard.
It sends it through `LiveSession.prompt` as a `followUp`, which rejects with `PromptRefused` when the session does not take the message, after showing the refusal in the session.
Once omp takes it, `delivered` removes those updates, and delivery runs again for the ones that came meanwhile; one delivery per project is in flight at a time.
When omp refuses it, the updates stay and nothing retries at once: delivery runs again when the coordinator's row changes, when its turn ends, and when it attaches, which is also how what waited while it worked, or while it was stopped, reaches it once it is idle.
Only sessions that attached through the starter are tracked, so a project's session resumed in a terminal reports nothing.

`src/server/project-notes.ts` seeds a new project's notes in `projectNotesDir(id)` from `src/paths.ts`, `$XDG_DATA_HOME/omp-agents/projects/<id>/`, else `~/.local/share/omp-agents/projects/<id>/`: `README.md` with the project's name, its goal (the coordinator's first message), and links to `testing.md`, `preferences.md`, and `research.md`, which it seeds too, and it never overwrites a file already there.
The notes live outside every repository, so every worktree shares them, and outside the access token's directory, which the file dialog refuses.

`templates/omp/agent/extensions/projects.ts` reads `projects.json` at each prompt and each `edit` or `write` call.
Both of its handlers find the role by the session id, with no rule of their own for subagents: a subagent that runs in the project session's own session, such as an advisor or a `/tan` clone, acts in its role, and a `task` subagent, which has a session of its own, has none.
Its `before_agent_start` handler adds the session's role and the notes' place to the system prompt of every prompt, so they survive compaction.
Its `tool_call` handler blocks a coordinator's `edit` and `write` calls whose `path`, or a hashline edit's `[path#TAG]` header, resolves outside the notes directory, and fails closed: a call that names no file it can read is blocked too.
Only `local://` and `artifact://` paths, the session's scratch space, pass without a check.

On a takeover, the server reads `projects.json` again, since the previous owner kept saving it; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Each server's runner follows only the sessions that server started.

## Pins

The sidebar's pins are a list of session ids that the server keeps, so the routine runner can pin with no page open and every window agrees.
`src/server/pins-file.ts` keeps them in `pins.json` beside the access token, as `{ sessions }`, and moves a file that holds anything else to `pins.json.invalid`.
A `pin` socket message carries a `PinChange`, `{ op, sessionIds }` with `op` one of `pin` and `unpin`, checked in `src/server/wire.ts`.
`applyPins` in `src/shared/pins.ts` applies it, and never toggles, so the same change sent twice pins or unpins once.
Every socket hears the pins after each change as a `pins` message on the roster topic, also sent when a socket opens; a change that changes nothing sends the pins back to its own socket alone.
The page shows a change before the server answers, and its **Pin** and **Unpin** send `pin` or `unpin` from the pins it holds.
Pins an older page kept in the browser's localStorage, under `omp-agents.pinned-sessions`, go to the server as one `pin` the first time the page hears the pins, and the key is then removed.
Each server keeps its own copy in memory, as with the workspaces, so a routine's pin shows at once on the pages of the server that owns routines.

## Notifications

`src/server/notices.ts` owns the bell's notices: what the last checks found, the status of each update a page started, and which notices the user saw, read, or cleared, which it keeps in `notices.json` beside the access token.
Each kind has its own check, and `src/server/loops.ts` runs four of them.
The update check (`UPDATE_KINDS`) runs at startup and every six hours, whether or not a page is connected, and again after each update that succeeds.
The activity check (`ACTIVITY_KINDS`) runs every two minutes while a socket listens, and when a socket opens unless it ran since the last tick that found none.
The provider check (`PROVIDER_KINDS`) runs after each `omp usage` run, at startup and every minute, whether or not a page is connected.
The event check (`EVENT_KINDS`) runs on the minute tick, whether or not a page is connected.

- `latestOmp` in `src/omp/release.ts` asks `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts` for the newest release on omp's `update.channel`, unless `startup.checkUpdate` is off.
  `installedOmp` reads the version from the installed package's `package.json` on each check, so the check is right after an update, before a restart.
- `findModelUpdates` in `src/omp/model-updates.ts` reads the global `modelRoles` and `retry.fallbackChains` entries with `resolveSelector`, and keeps the listed models that `classifyModel` in `pi-catalog/src/identity/index.ts` places in an Anthropic or OpenAI family with a revision.
  A model's line is its provider, its family, and its id with the version masked, so `claude-opus-5-5` and `claude-opus-5-6` share one.
  It offers the newest revision of each line that a connected provider lists, and leaves dated snapshots out.
- The pull requests come from `loadPullRequests` in `src/pull-requests.ts` over the known workspaces that still exist, through the pull request list's 30-second cache, so the page's polls and the check share one query.
  `moveOf` in `src/shared/moves.ts` picks each one's move, with `agentOn` over the roster, and a move in `YOUR_MOVES` is a notice.
- `waitingOnYou` in `src/slack-messages.ts` calls Slack's Web API with omp's Slack MCP sign-in through `integrationFetch("slack")`, since the MCP server's search answers in Markdown and Slack's `search.messages` needs a scope the sign-in lacks.
  `auth.test` names the user, and two `assistant.search.context` searches over the last three days, newest first, read the direct and group messages (`im,mpim`) and the channel messages that mention them (`<@ID>`), each up to five pages of 20 through `next_cursor`.
  A conversation gives one notice for the messages after the user's last one there; the user's own messages, bots, Slack's system messages, and empty ones count for nothing.
  `slackText` turns Slack's markup into plain text.
  `users.info` gives each author's 72-pixel profile picture as the notice's `avatarUrl`, which the page's `img-src` allows from `avatars.slack-edge.com`, `secure.gravatar.com`, and `a.slack-edge.com`; a lookup that fails leaves it `null`, and the page shows the initial.
  Without a Slack sign-in, which `integrationSignedIn("slack")` reads, the check finds nothing.
- The plan notices come from the plans of the last `omp usage` run, which `Broadcasts.refreshUsage` answers with, one per window whose `exhausted` is set; when that run failed, the check fails too and keeps its notices.
- `readCreditRuns` in `src/omp/stats.ts` reads the last day's requests, in order, of each provider that had an error naming `402` then, aborted requests left out.
  `creditRuns` starts a run at a failure whose error names `402` and that `is402BillingCapBody` reads as a billing cap, counts each such failure after it, and ends it at the provider's next request that worked; another error neither starts nor ends a run.
  A provider with a run open is a notice.
- The events come from `LocalEventsFile` and, once Google Calendar is signed in, `GoogleCalendarClient.events` over the next ten minutes (`EVENT_LEAD_MS`), each timed event a notice from that lead before its start until its end, dated at that lead.
  Google's events and the local ones are separate scopes: a Google read that fails keeps Google's notices as they were, and the Calendar page shows why.

A check that fails keeps what the last one found for its kind, and the marks for it, and logs each distinct error once.
A repository GitHub did not answer for keeps its pull requests' notices the same way.
A notice whose update runs or ran stays after a check stops finding it, so the page shows how the update ended.
A notice's id names what it is about, so it is a new notice when that changes, even after the user cleared the last one: `omp:<latest>`, `model:<provider>/<from>><to>`, `pull-request:<owner>/<repo>#<number>:<move>`, `slack:<channel>:<ts>` of the newest message, `plan:<provider>/<account>:<limit id>`, `credits:<provider>`, or `event:local/<id>:<start>` and `event:google/<calendar id>/<event id>:<start>`, so a moved event is news again.
A plan notice's id leaves out the reset time, which a provider may report a little differently on each run, and a credits notice's leaves out its first failure, which moves once that failure is older than the day the check reads; the window's reset or a request that works ends the notice, and the next time it comes after its marks lapse is news.
A Slack notice dates from its message, and a credits notice from the first failure the check reads.
A pull request notice dates from the check that found it, since the pull request's last update on GitHub may predate the move, except on its repository's first answer since startup, which dates each from that update, so a workspace found later or a repository GitHub answers again does not bring old pull requests as news.
The marks of a notice the checks stop finding last ten minutes, so a pull request whose checks run again, which leaves **Ready to merge** for a moment, keeps its marks, and one that comes back later is news again.
Each notice carries its scope when its check finds it, its kind, a pull request's `owner/repo`, or `event:local` or `event:google`, and a check answers for the scopes it looked at, never by reading ids back.
`notices.json` keeps each marked notice's scope under `scopes`, so a restarted server forgets the marks of a notice that is gone from an answered scope; a mark from a file without `scopes` stays until its notice is found again.

A `notice` socket message carries `{ ids, op }`, with `op` one of `update`, `seen`, `read`, and `clear`.
`update` runs on update notices and marks them seen and read.
Every socket hears the list as a `notices` message on the roster topic after each change, also sent when a socket opens.
`update` on omp runs `omp update` through `ompCommand` and succeeds when omp exits 0 and the version on disk is at least the notice's release; otherwise it fails with omp's last line of output, such as Nix's.
The server keeps the omp modules it loaded until it restarts, and `src/omp/modules.ts` names any export the new release dropped at the next start.
`update` on a model calls `upgradeModel` in `src/settings.ts`, which turns `upgradeEdits` into routing edits and writes each with `writeRouting`, under the same lock as a Settings › Models save.
A role or chain entry keeps whatever follows the model in its selector, such as `:high` or `:auto`, and each chain that names the model is written whole.

## HTTP API

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace.
The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`).
It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk.
Each file carries the SHA-256 of its text.
`GET /api/models` runs `omp models --json` for the pickers.

`GET /api/analytics?range=<range>` answers `Analytics` from omp-stats, defaulting to `7d`.
The accepted ranges are `today`, `24h`, `7d`, `30d`, `90d`, and `all`; an unknown range returns 400.
The answer includes totals, time buckets with per-provider usage, provider totals, models, workspaces, agent types, tools, the 20 sessions with the most tokens, and live indexing status.

`GET /api/analytics/context?range=<range>[&cwd=<directory>][&session=<id>]` answers `ContextReport`, the context sources over the range, defaulting to `24h`, for every workspace, one working directory, or one session; an unknown range returns 400.
It includes the requests, their input tokens and input cost, the sources by tokens, the workspaces with input in the range, the 20 sessions with the most input in the chosen workspace, and the index's progress while it syncs.

Edits go through two endpoints, each taking the same `?cwd=` and answering with the settings as they load after the write:

- `PUT /api/settings/routing` takes one change: a role's model or fallbacks, a model-keyed chain, some `retry.*` values, or the provider order.
  The server writes it through omp's own write path, the one `omp config set` uses: `Settings.loadIsolated`, the setting's `set` or `setEntry`, and `flush`.
  omp re-reads `config.yml` under its lock and writes back only the paths that changed.
  A model must be one that `omp models` lists, read by `resolveSelector` in `src/omp/config.ts`, so `provider/id:level` works even when the id holds a colon.
  A selector that the config already names passes as it is, so keeping an entry never blocks a save.
  omp checks each retry value against the setting's type and allowed values.
  If omp cannot load `config.yml`, the write is refused, because omp would move the broken file aside before it writes.
- `PUT /api/settings/file` takes `{ path, text, baseHash }`.
  The server runs discovery again for that `cwd` and writes only a path that it finds there, never one the page invents.
  `baseHash` must match the file's current hash, or `null` for a missing file.
  Otherwise the server answers 409 with `conflict: true`.
  The server resolves symlinks, writes a temporary file beside the real file with its mode, and renames it over the real file, so a symlinked file stays a link and a crash cannot leave a truncated file.
  Saves run one at a time, so two saves of the same file cannot both pass the hash check.

Every response from these endpoints is JSON.
An error is `{ error, conflict? }` with the HTTP status.
Any other `/api/` path answers a JSON 404.
The page reports a response that is not JSON with its status and text.
Every endpoint needs the access token's cookie; see [SECURITY.md](../SECURITY.md).

`GET /api/git?cwd=<directory>` answers the git checkout that the directory is in, or `null` outside one: the checked-out branch, every local branch with the worktree that has it checked out, and the main worktree.

`GET /api/system` answers the status bar's machine load: `{ cpuPercent, memoryAvailable, memoryTotal, diskAvailable, diskTotal }`.
`cpuPercent` is the busy share of every core's time since the previous read, from `os.cpus()`, and `null` when no time passed; the first read measures from the server's start.
`memoryAvailable` is `kern.memorystatus_level`, the free percentage `memory_pressure` reports, of the physical memory on macOS, since `os.freemem()` counts only never-used pages there, and `os.freemem()` elsewhere.
`diskAvailable` and `diskTotal` come from `statfs` on the home directory: the blocks free to an unprivileged user and all the volume's blocks; on macOS the free figure leaves out purgeable space, which Finder counts.

`GET /api/file?path=<absolute path>` answers a text file for the page's file dialog: `{ path, text, size, truncated }`.
The path is absolute or starts with `~`, which `expandHome` in `src/paths.ts` reads as the home directory; the page resolves a relative one against the session's directory first.
The file's real path, after symlinks, must end in one of `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot reach a key file.
It must also lie outside the directories that hold sign-ins and config, `DENIED_DIRS` in `src/text-file.ts`, compared by their real paths, or the route answers 403: omp-agents' own directory, which holds the access token, and omp's agent directory, but for its Markdown, such as `AGENTS.md` and skills.
It reads the first `MAX_TEXT_FILE_BYTES` (1 MB) and answers 415 when those bytes are not UTF-8.
It runs `git worktree list --porcelain -z`, `git for-each-ref`, and `git symbolic-ref` on each call, and reads `origin` through the pull request list's cached lookup.
Like a new session's `start`, `cwd` may name any directory.
The new-session draft reads it for its branch picker, and a live session's header reads it when it opens and when a turn starts or ends.
`GET /api/changes?session=<session id>` answers a session's [changes dialog](usage.md#session-changes) list, `SessionChanges` in `src/shared/changes.ts`, or 404 for a session it does not know.
It reads the session's checkout from its worktree, else its directory: `git diff --name-status` and `--numstat` against the merge base of `HEAD` with `origin/HEAD`, else against `HEAD`, else against the empty tree before the first commit, and `git ls-files --others --exclude-standard` for untracked files.
It folds the session's transcript with `Work` for the files its own `edit` and `write` calls changed, keeping each transcript's fold and parsing only the lines it gained since the last list, or folding it again from its first line once it shrinks, and lists those git does not name after git's.
`GET /api/changes/file?session=<session id>&path=<path>` answers one file of that list in full, `ChangedFileText`, with every line of `git diff --histogram` as numbered rows, or a note for a binary file or one over `MAX_CHANGED_FILE_BYTES` (1 MB).
It computes the list again and answers 404 for a path the list does not hold, so it reads no file the session and its checkout did not change, and passes the path with `--literal-pathspecs`, so a name such as `app/[id]/page.tsx` is not a glob.
The dialog reads both routes again whenever the session's own changes grow and when a turn starts or ends.
`GET /api/project-notes?id=<project id>` answers a project's notes, `{ dir, notes }`, each note a `ProjectNote` (`{ name, path, modifiedAt }`) for a Markdown file in the directory, `README.md` first and then by name, or 404 for a project the server does not know; the page opens a note through `GET /api/file`.
`GET /api/conversations?q=<words>` answers `ConversationSearchAnswer` from `src/shared/sessions.ts`: every saved conversation whose prompts or replies hold every word, the file changed last first, each by its latest such message, with that message's transcript item id, a snippet, and how many messages match; a blank `q` is a 400.
It waits for the transcript reads asked for so far, then reads nothing itself; the page leaves out the sessions the sidebar hides and lists the first 30.
`GET /api/pull-request/title?owner=<o>&repo=<r>&number=<n>` answers `{ title }` for a bare GitHub or Graphite PR link.
It reads only the title through `gh api graphql`, using the same validated pull request query as the details routes, and keeps each answer for 30 seconds, sharing in-flight reads.
The page's existing `useRead` drops answers for a previous link and aborts the read when the link unmounts; explicit Markdown labels do not request a title.
`GET /api/pull-request/files?owner=<o>&repo=<r>&number=<n>` answers the list on a pull request's **Code** tab, `PullRequestChanges` in `src/shared/github.ts`: its title and branches from `gh api repos/<o>/<r>/pulls/<n>`, and its files from `gh api --paginate --slurp repos/<o>/<r>/pulls/<n>/files`, which lists up to GitHub's 3000 where GraphQL's `files` stops at 100.
It reads GitHub again on each call and keeps the answer, with each file's `patch` and blob id, for the file reads for 30 seconds.
`GET /api/pull-request/file?owner=<o>&repo=<r>&number=<n>&path=<path>` answers one file of that list in full, `ChangedFileText`, and 404 for a path the list does not hold.
GitHub's patch keeps three unchanged lines around each change, so `patchRows` in `src/shared/changes.ts` fills the lines before, between, and after its hunks from the file's text at the head, which one `gh api graphql` call reads by the blob id the list names.
Both file readers answer through `fileText(path, rows, note)` in `src/shared/changes.ts`, so a file's rows and the note on why it has none take one shape.
A removed file's patch holds every line, so it reads no blob; a file GitHub sends no patch for, a binary file, and one over `MAX_CHANGED_FILE_BYTES` answer a note.
`GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>` answers the pull requests of a details' **Stack**, `StackedPullRequest[]` top first, from one `gh api graphql --paginate --slurp` read of the repository's open pull requests, forks left out, which it keeps for 30 seconds.
`stackOf` in `src/pull-request-stack.ts` follows the base branches down from the pull request and the pull requests based on its branch up, so the stack holds those that the Pull requests page does not list.
`GET /api/pull-request/options?owner=<o>&repo=<r>` answers `PullRequestOptions` for the pickers of a pull request's **Summary**: the repository's labels and the people its issues can be assigned to, whom a review can be asked of, each from `gh api --paginate --slurp` and sorted by name, kept five minutes per repository.
`PUT /api/pull-request` takes a `PullRequestEdit`, a pull request and one `change`, checked by `parsePullRequestEdit` in `src/server/wire.ts`: a label or a review request added or removed through REST, or a state of `open`, `draft`, or `closed` through the GraphQL mutations `stateSteps` orders, a closed pull request reopening before its draft flag changes.
A `merge` change, `{ method, head }`, runs GraphQL's `mergePullRequest` with that method and `expectedHeadOid: head`, so GitHub refuses the merge once the branch moved past the commit the page showed.
The pull request's answer carries that commit as `headOid` and the methods its repository allows as `mergeMethods`.
It answers the pull request as `GET /api/pull-request` reads it after the change, read again from GitHub, and the details then refresh the pull request list.
One change goes per call, so two changes made at once each keep the other.
The details send their changes one at a time through `useEditableRead` in `web/editable-read.ts`, which the issue detail's fields share.
Each answer carries how many writes had answered when it was asked, so an answer to an earlier change, or a read sent before a write answered, never hides a later change.

`GET /api/source-control` answers a `SourceControlAnswer` from `SourceControl` in `src/source-control.ts`: whether `gh` and `gt` are installed and signed in, the automatic pull setting, and each repository the visible workspaces are in, keyed by its main checkout, with its own choice and its last pull since the server started.
`gh` is signed in when `gh api user` answers a login, and `gt` when Graphite's `user_config` holds an `authToken`.
`PUT /api/source-control` takes an `AutoPullChange`, `{ op: "default", on }` or `{ op: "repo", repo, on }` with `on: null` dropping a repository's own choice, checked by `parseAutoPullChange` in `src/server/wire.ts`, and answers the same as the `GET`.
A change that changes the setting saves `source-control.json` beside the access token and, on the server that holds the owner lock, pulls at once.
A pull, from that change or from the pull loop every five minutes, waits for the one under way, then runs `pullDefaultBranch` on each repository whose pulls are on.
It reads the default branch from `origin/HEAD`, fetches it, and moves the local branch only when it is behind `origin`'s with no commits of its own: through `merge --ff-only` in the worktree that has it checked out, skipped when that worktree has changes to tracked files, else through `update-ref`.

`GET /api/worktrees` lists the worktrees of every repository a session ran in, or of `?cwd=` when that directory is in a repository.
Each row names the registered path, branch, lock, whether the directory is missing, the newest session file there, and why removal is refused.
`GET /api/worktrees/metrics?repository=&path=` reads approximate allocated disk use, the last commit time, and the modified and untracked counts for one registered checkout.
`PUT /api/worktrees/removal` previews a removal or performs one whose confirmation still matches that preview.
Removal uses `git worktree remove` without `--force`, so Git keeps the branch and still refuses a dirty or locked checkout.
A missing directory is removed the same way, which drops only that registration.
A start that creates a branch's worktree and registers its session excludes a removal, and so does a removal that has begun: a removal waits for the starts under way, reads the live and saved sessions once, then checks and removes each confirmed checkout in turn.
Starts that create no worktree, such as a resume or a routine's session, stay parallel and wait only while a removal runs.

`PUT /api/workspaces` takes a `WorkspaceChange`, `{ op, cwd }` with `op` one of `add`, `hide`, and `show`, checked by `parseWorkspaceChange` in `src/server/wire.ts`.
`add` resolves `cwd` through `directoryOf` in `src/paths.ts`, which expands `~`, and answers 400 when it is not a directory; `hide` and `show` take an absolute path.
`applyWorkspace` in `src/shared/workspaces.ts` applies one change: adding also shows a hidden directory, and a directory in both lists is hidden, so **Show** offers an added one again.
A change that changes the list saves `workspaces.json` and sends every socket a `workspaces` message, its `list` of added and hidden directories, each with its `cwdDisplay`, also sent when a socket opens.
A request's `?cwd=` may name an added directory, as the settings under **This workspace** and a workspace's pull request list do; the every-workspace pull request list and the worktrees inventory read only the directories sessions ran in.
The page lists added directories after those sessions ran in, and drops a hidden directory, not the directories inside it, from its pickers, session lists, counts, and search, as it does `/tmp`.

`GET /api/models/connected?cwd=<directory>` answers `{ models }`: the models that `omp models` lists from the providers you are connected to, for the new-session draft's model menu.
Each model is `{ provider, id, name, contextWindow, curated, thinkingLevels }`; `curated` marks the ones that the directory's `modelRoles` or `retry.fallbackChains` name, as omp resolves each selector, and `thinkingLevels` are the ones omp's catalog lists (`modelEntries` in `src/omp/models.ts`).
The models of the providers that `modelProviderOrder` names come first, in that order, and the rest keep omp's order.
A live session's `list-models` answer builds the same entries from the models that its omp RPC process offers and the config of the session's directory.
A `start` of kind `new` carries a `model`, `null` for omp's default; the server sends omp `set_model` once it is ready and before the first prompt, and a model that omp refuses fails the start.

`GET /api/models/roles?cwd=<directory>` answers `{ roles }`, each `{ role, model, thinking }`; the new-session draft reads the `default` role's model from it to name the model omp starts on.
Like `/api/git`, `cwd` may name any directory.
`connectedRoles` in `src/omp/models.ts` loads `modelRoles` with omp's read-only loader for that directory, so a project's `.omp/config.yml` overrides count, and reads each role's selector against `omp models`: a `:level` suffix becomes `thinking`, and `@role` or `*` takes the named role's model and level unless it adds its own.
Roles that name a model by a fuzzy pattern, or one on a provider you are not connected to, are left out.
A `start` of kind `new` and a `set-model` each carry a `thinking`, `null` to keep omp's level; the server sends omp `set_thinking_level` after `set_model`.

A dashboard session's row carries `fast`, `{ enabled, active }` from omp's state, or `null` while its model has no priority tier.
`set-fast` with `enabled` sends omp `set_fast_mode`, and the session then reads omp's state again; omp refuses to enable it for a model without the tier, which shows as a note.

`GET /api/skills?cwd=<directory>` answers `{ skills }`, each `{ name, description }`: the skills that `/skill:<name>` invokes in a session started in that directory, from the same discovery as the composer's `/` completions (`listSkills` in `src/commands.ts`), and none when omp's `skills.enableSkillCommands` is off.
Both leave out a skill whose frontmatter `name` holds whitespace, such as `Poteto Mode`: omp reads a `/skill:` name up to the first space, so no prompt can invoke it.
The settings page lists them to pin one, and the new-session draft reads them to show whether the pinned skill exists there.
The page keeps the pin in localStorage (`web/pinned-skill.ts`).
A `start` of kind `new` carries a `skill`, `null` for none: the draft sends the pin unless you turned it off there, and a quick action always sends it.
Once the server knows the directory omp runs in, worktree included, `withPinnedSkill` puts `/skill:<skill> ` before the first prompt, so omp's RPC prompt invokes the skill with the prompt as its arguments.
A directory without that skill, or a prompt that starts with `/`, keeps the prompt as typed.

A `start` of kind `new` carries a `subject`, `null` for none: a quick action sends the pull request or Linear issue it works on, and one on a todo sends no subject and names the todo in `todoId` instead.
`LiveSessions` keeps it by instance id, and `rows()` puts it first among the session's `pullRequests` or `tickets` until the session's tool calls name it, so the roster links the session to its subject from the start, before omp writes the session file.
The link goes when the session ends.

A `start` of kind `new` carries a `branch`, `null` for the directory as it is.
For an existing branch, the server runs omp in the worktree that has it checked out, or in the starting directory when that worktree is the directory's own (`git rev-parse --show-toplevel`); with no such worktree it runs `git worktree add <dir> <branch>`.
For a new branch, it runs `git check-ref-format --branch` and then `git worktree add -b <branch> <dir> <base>`.
`<dir>` is `worktreeDir` in `src/shared/git.ts`, beside the main worktree.
The server refuses a `<dir>` that already exists, because `git worktree add -b` creates the branch before it checks the path.
A branch that git refuses answers the `start` with git's reason, and no omp spawns.
A failed start makes the draft read the checkout again, so a branch that the start created shows as an existing one.

`GET /api/tickets`, or `GET /api/tickets?fresh` to skip the server's 30-second cache, answers the tickets page with `{ tickets }`.
A failed read is the API's usual `{ error }` with status 500, and the page keeps showing the last tickets it has with the error above them.
The server reads Linear through Linear's MCP server, with the OAuth sign-in that omp keeps for it, through `src/omp/mcp.ts`: it loads omp's own MCP config for the enabled server whose `url` has the `mcp.linear.app` host, and gets an access token for its `auth.credentialId`, or for the id omp files a sign-in for that URL under, from `omp token <credentialId>`, which refreshes the token through omp's credential owner.
The token stays in memory for five minutes and is dropped when Linear answers 401, which the page reports as a hint to reconnect Linear in Settings › Integrations or run `/mcp reauth <name>`; it is never logged.
Linear's GraphQL API refuses that token, so the server calls the MCP endpoint's `list_issues` tool through omp's `callMCP`, a stateless JSON-RPC `tools/call` POST.
It asks for each open state type in full, following the cursor, and for completed, canceled, and duplicate issues updated in the last seven days, in parallel, then drops repeats by identifier.
Each issue carries its `parentId`, the parent's identifier, from which the page nests a listed sub-issue under its listed parent.
`list_issues` and `get_issue` name an issue's labels without their colors, so the server reads each team's labels with `list_issue_labels`, by the team key that prefixes the identifier, and keeps them for five minutes; `?fresh` reads them again too.

`GET /api/ticket?id=<identifier>`, such as `?id=ENG-2368`, answers the tickets page's main content with that issue in full: the row's fields, the assignee, the team's id, the description, who opened it and when, the links Linear attaches to it, its comment threads, its parent, and its sub-issues.
The server calls `get_issue`, `list_comments`, and `list_issues` with `parentId` for the sub-issues, in parallel, through the same MCP sign-in, with no cache, so each opening reads the issue again.
For a sub-issue it then reads the parent with `get_issue`, asking only for the fields its row shows.
It rewrites Linear's `<issue>` mentions as markdown links, its `<linear-image>` tags as image links, its `<linear-embed node-type="video">` tags as `<video>` elements, and other `<linear-embed>` tags as links.
It threads the comments by `parentId`, oldest first.
An identifier that is not a team key, a dash, and a number answers 400.

Linear hands out its files as `uploads.linear.app` addresses whose `signature` JWT expires five minutes after the read.
`loadTicketDetail` reads the raw texts of `get_issue` and `list_comments`, and `rememberUploads` in `src/linear-uploads.ts` keeps the latest signed address of each upload path found in them, in memory, under the issue they were read for.
It drops an address once it expires, and the oldest past 256 addresses, since signing one anew costs one read of its issue.
`linearMarkdown` is a pure text rewrite: it turns each upload address in the description and comments into `GET /api/ticket/media?issue=<identifier>&path=<upload path>`.
That route fetches the kept address, passing the `Range` header on, and streams Linear's answer back with its type, length, range, and validators.
When the kept address is within 30 seconds of expiring, missing after a restart, or refused by Linear, the route reads the issue again and remembers its uploads anew, which signs every file in it; requests for one issue within 10 seconds share that read.
Only paths that a read of the issue named are fetched, so the route reaches nothing but Linear's own uploads, and a path that one issue names is not served under another's identifier.
It serves each file with `Content-Security-Policy: sandbox` and `nosniff`, and anything other than an image, a video, or audio as an attachment, since a file that someone uploaded to Linear is served from the dashboard's origin.
The page's CSP stays `'self'` for media.
`message-markdown.tsx` lets Linear's text load images and play `<video>` only from that route.

`GET /api/ticket/options?team=<team id>` answers `TicketOptions` for the issue detail's field pickers: the team's workflow states (`list_issue_statuses`) as `{ status, statusType }` in the order Linear lists them, the workspace's active members (`list_users`), the team's and the workspace's live labels (`list_issue_labels`), and the names of the team's projects (`list_projects`, 50 a page), each paged to its end.
The issue detail's status picker orders the states with the same `statusOrder` as the tickets page's groups.
The server keeps each team's answer for five minutes.
`PUT /api/ticket` takes a `TicketEdit`, `{ id, state?, assignee?, priority?, labels?, project?, dueDate? }`, checked by `parseTicketEdit` in `src/server/wire.ts`, where `state` and `project` name the status and the project as the issue shows them, `assignee` is a user's id, `null` clears a field, and `labels` replaces the whole set by name.
It calls `save_issue` with those fields, drops the cached tickets list, and answers the issue as `GET /api/ticket` reads it after the change.
The issue detail shows a change at once and sends its changes one at a time, and once every change sent has answered, it reads the issue again if Linear refused one.

`PUT /api/todo/ticket` takes a `TodoTicketRequest`, `{ todoId, team }`, checked by `parseTodoTicket`, and `createTicketForTodo` in `src/server/todo-ticket.ts` opens an issue from that top-level todo's title and notes, assigned to the viewer, then links it to the todo through the same list change a socket `user-todo` makes.
It answers 409 without opening an issue when the todo is not a top-level todo outside the archive, has no title, or already links an issue.
Once the issue exists, it answers a `TodoTicketAnswer`: `{ identifier, linked: true }` when the server's todo list holds the link, else `{ identifier, linked: false, error }`, such as when the todo was removed while Linear opened the issue.
Linear and `todos.json` are not one transaction, so the page shows an unlinked issue by its identifier and offers to link it rather than open another.

### Integrations

`MCP_SERVICES` in `src/shared/accounts.ts` holds the services whose MCP server the **Integrations** page signs omp in to, keyed by the ids in `MCP_INTEGRATIONS`.
`integrationOn(host)` there names the service whose server is on a host, which is how the MCP servers page tells an integration's server from one it manages itself.
Linear, Slack, Google Calendar, and Gmail are the four.
Each names its label, the host omp's server for the service is on, and the name and URL of the server a sign-in adds when omp has none.
Each also names its `client`, where its sign-in gets its OAuth client: `none` for Linear, which registers its own, `slack-app` for Slack, and `google-oauth` for Google Calendar and Gmail.
Its `requireRefresh` says whether a sign-in refuses a grant without a refresh token, which only Slack's does.
`src/integrations.ts` reads both fields for every service rather than naming one, keeps a sign-in per service, and the page adds each service's brand mark and what it gives.
`SLACK_USER_SCOPES` is the chat, history, search, and user set a dedicated Slack app may grant.
Canvas, list, file, reaction, and channel-creation scopes are not requested.

`GET /api/integrations` answers `{ integrations }`, one `McpIntegration`, `{ id, connection, signIn, setup }`, under each service's id.
`setup` is the one its `client` decides, through `clientSetup` in `src/mcp-clients.ts`: `null` for Linear, which registers its own OAuth client, without reading `mcp.json`.
For Slack it is a `SlackSetup` with the client ID, whether a client secret is stored, the redirect URI, the callback port, the scope string, and `configured`.
For Google Calendar and Gmail, the `GOOGLE_SERVICES` in `src/shared/accounts.ts`, the services whose `client` is `google-oauth`, it is a `GoogleSetup` with the client ID, whether a client secret is stored, the callback port, and `configured`.
The client secret is absent from that body.
`GET /api/settings` does not read `mcp.json` either.
Its file list comes from omp's context, prompt, command, rule, skill, hook, and agent discovery.
Before the app is saved, Slack's setup uses callback port 3000 and the full scope list, with `configured: false`.
`configured` is true only when the user MCP file has a client ID, a client secret, a nonempty subset of `SLACK_USER_SCOPES`, an HTTPS redirect, and a callback port.
An HTTPS loopback redirect must use a different port from the local HTTP callback.
Google Calendar's and Gmail's setups use callback port 3119 until a client is saved, and are `configured` only when their server has a client ID, a client secret, and a callback port.

`connection` is `absent` while omp's user-level MCP config has no enabled server on the service's host, and `signed-out` while omp's credential store, read again on each call, holds no OAuth sign-in for it.
A Slack, Google Calendar, or Gmail server that already has a sign-in is still probed when the saved client settings are incomplete.
`listMcpTools` in `src/omp/mcp.ts` discovers their tools through omp's client, with the configured transport and headers and the same token as the tickets' calls, following every cursor.
`remoteStatusOf` in `src/mcp-status.ts` turns the outcome into one `McpRemoteStatus` from `src/shared/mcp-status.ts`, which both sections share: `ready` with each tool's name and description, `refused` on discovery's `McpUnauthorized` while omp holds a sign-in, or `failing` with any other error and the HTTP status the server answered, `null` when it answered none.
Every service requires a sign-in, so a service that has none is `signed-out` without listing its tools.
One cache keeps discovery lists for a minute and never a failure, keyed by server name, expanded config, credential id, and whether discovery sends omp's token; `?fresh` lists again.
Config writes invalidate that name, and sign-in, sign-out, and discovery or service API 401 invalidate every list using that credential id plus its token.
While a service's sign-in waits on the browser, `hold` on its `SignIn` answers the connection last read, without listing the tools again.
The page shows the **Tickets** tab while Linear's connection is `ready`, `refused`, or `failing`, and the **Inbox** tab while Gmail's is, and keeps the last read in localStorage.
`integrationsStore` in `web/reads.ts` drops a cached answer in which an integration has no connection, or a `ready` one lists its tools as anything but objects, as answers did before tools carried descriptions.
Each gated tab names its service as the `integration` of its row in `SIDEBAR_TABS` in `web/routing.ts`, and `tabsSignedOut` in `web/sidebar-tabs.ts` turns those rows into the tabs omp holds no sign-in for. `useSidebarTabs` keeps the layout, the signed-out set, and the tabs the bar shows, which Cmd+1 through Cmd+7 go to, and the tab row fits its width by how many tabs show.
The dashboard calls Linear only while its connection is `ready` or `failing`: the tickets page shows Linear's integration row instead of the issues otherwise, and the Todo page's **Create Linear ticket** and the Calendar's tickets wait on it too.

`PUT /api/integrations/slack/client` takes `{ clientId, clientSecret?, redirectUri, callbackPort, scope }`.
`parseSlackClient` accepts a nonempty subset of `SLACK_USER_SCOPES`, with commas or whitespace as separators, and an HTTPS redirect.
It answers 400 for an HTTP redirect, an unknown scope, a bad port, or an HTTPS loopback redirect that reuses the callback port.
The save writes the existing user server on `mcp.slack.com`, or a new `slack` server, through omp's locked config writer.
The writer keeps owner-only file permissions and leaves every other server, top-level list, header, timeout, `callbackPath`, and `prompt` in place.
An omitted or empty client secret stays only when the client ID is unchanged.
A new client ID without a new secret is a 400 and does not write.
Saving cancels a Slack sign-in that is waiting.
Changing the client ID or the secret also removes the OAuth credentials omp manages for that server.
Credentials are removed before changing the app identity, so a failed config write cannot leave the old app signed in under the new settings.
If that write fails, the old settings remain, but Slack needs a new sign-in.
Config and credentials have separate native owners, not a shared transaction.
Saving scopes changes the next authorization request, not an existing grant.
Sign-out and a later sign-in leave the saved app in the file.

`PUT /api/integrations/google-calendar/client` and `PUT /api/integrations/gmail/client` take `{ clientId, clientSecret?, callbackPort }` of a Google OAuth client of type Web application, and one client may serve both.
`parseGoogleClient` answers 400 for a client ID that does not end in `.apps.googleusercontent.com` or a bad port.
`saveGoogleClient(id, input)` in `src/integrations.ts` writes the existing user server on the service's host, `calendarmcp.googleapis.com` or `gmailmcp.googleapis.com`, or a new `google-calendar` or `gmail` server, the way Slack's save does.
It sets the scope to the service's `GOOGLE_SCOPES` in `src/shared/accounts.ts`, events, the calendar list read-only, and free/busy for Google Calendar and `gmail.modify` alone for Gmail, `prompt: "consent"` so Google issues a refresh token, the callback port, and the redirect `http://localhost:<port>/callback`, which the client must list as an authorized redirect URI.
A sign-in to Google Calendar or Gmail first rewrites a saved server's `oauth.scope` that differs from `GOOGLE_SCOPES`, through `planGoogleScope`, so a client saved when Gmail asked only for `gmail.readonly` asks for the wider grant on its next **Reconnect**.
The same secret, client-change, and credential rules as Slack's apply.

`PUT /api/integrations/sign-in`, with `{ id }`, starts a sign-in the way omp's `/mcp reauth` does.
Linear still reads the OAuth endpoints from metadata, registers a client when the authorization server offers registration, and listens on `localhost:3000`.
Slack, Google Calendar, and Gmail refuse to start until `setup.configured` is true, so they do not open an authorization URL that has no client ID.
The flow then receives the saved client ID, client secret, scope, redirect, callback port, callback path, and prompt.
It answers the integration once the flow has the service's authorization address, as `signIn: { phase: "waiting", url }`, which the page opens in a new tab.
When the browser comes back, the server stores the tokens under the server's credential id, where `omp token` finds them.
The stored client secret is the one dynamic registration issued, or the configured secret when registration did not issue one.
That is the secret a later refresh sends.
A Slack grant with no refresh token is not stored.
The Slack app has to enable token rotation, which Slack does not let an app turn back off.
omp otherwise treats a missing token lifetime as one hour, so a refresh-less grant would stop working with no error at save time.
The server adds the service's HTTP server to the user `mcp.json` only when discovery found no enabled server on the service's host.
A new sign-in abandons the one under way.
A failure, or no return within five minutes, shows as `signIn: { phase: "failed", error }` until the next sign-in.
`createSignIn` in `src/sign-in.ts` holds that state, and the status `hold` repeats, for every MCP integration.

`PUT /api/integrations/sign-out`, with `{ id }`, abandons a sign-in under way and removes the sign-ins omp manages for the server, as omp's `/mcp unauth` does: omp's `removeManagedMcpOAuthCredentials` removes them under the server's credential id and the ids it files a sign-in for the URL under.
`mcp.json` keeps the server and, unlike `/mcp unauth`, its `auth` block.
A sign-in that omp does not manage stays, and the route answers an error that says so.
`parseIntegrationId` in `src/server/wire.ts` checks both bodies.

### MCP servers

`GET /api/mcp-servers` answers `McpServersAnswer` from `src/shared/mcp-servers.ts`: `servers`, one `McpServerRow` for every server omp loads for you, and `configPath`, omp's user `mcp.json`.
`listMcpServers` in `src/omp/mcp.ts` reads them with `loadAllMCPConfigs`, project configs off, and adds the servers omp's user file disables, which that call drops.
Each row has the server's name, transport, URL with `${VAR}` references expanded, host, command, `source` (the config file and whether the page may change it: only omp's own user file), whether omp holds a sign-in for its URL, `status`, `signIn`, and `catalogId`, the catalog entry on its host.

`status` is `disabled`, `integration` for a server on one of `MCP_SERVICES`' hosts, whose status [Integrations](#integrations) reads, `local` for a command, which only an omp session starts, or the outcome of listing the server's tools.
`listMcpTools` in `src/omp/mcp.ts` is the same discovery operation Integrations uses: it connects through omp's own client, `connectToServer` and `listTools`, so streamable HTTP and SSE servers both work, with the server's headers and a Bearer token when omp holds a sign-in, then disconnects.
A 401, a `http_status` failure from the HTTP transport or an `HTTP 401:` error from the SSE one, throws `McpUnauthorized`, distinct from service HTTP API authorization's `McpRefused`.
`remoteStatusOf` reads discovery's 401 as `signed-out` when omp holds no sign-in and `refused` when it does; any other failure is `failing` with its message and HTTP status, as an integration's is.
A server need not require a sign-in, so one that has none is still listed without a token.
An address that does not parse is `failing` with a `null` status.
Integration-host rows delegate to Integrations without probing a second time.
`McpServerStatus` adds `disabled`, `local`, and `integration` to `McpRemoteStatus`, and an integration's `McpConnection` adds `absent` and the server, so each answer carries only the kinds its section can reach.
While a server's sign-in waits on the browser, `hold` on its `SignIn` answers the status last read.

`PUT /api/mcp-servers/add` takes `{ catalog }`, an id in `MCP_CATALOG` from `src/shared/mcp-catalog.ts`, or `{ name, url, transport?, header? }`, checked by `parseMcpServerAdd` in `src/server/wire.ts`: the address must be HTTPS or loopback HTTP, the transport `http` or `sse`, and a header a token name with a value.
A catalog entry refuses a server already on its host and takes its id as the name, or the first of `id-2`, `id-3`, … that is free; an OAuth entry then starts its sign-in, and the route answers the new row, whose `signIn` the page opens.
A server by address must have a name omp's `validateServerName` accepts and no other server has, and is written with its header in `headers`; it starts no sign-in.
Both go through omp's `addMCPServer` into the user `mcp.json`.

`PUT /api/mcp-servers/sign-in` and `PUT /api/mcp-servers/sign-out`, with `{ name }`, sign in and out as the integrations' routes do, with a `createSignIn` per server name; they refuse a local server and an integration's.
`PUT /api/mcp-servers/enabled`, with `{ name, enabled }`, calls omp's `setMcpServerEnabled`, as `/mcp enable` and `/mcp disable` do, and `PUT /api/mcp-servers/remove`, with `{ name }`, calls `removeMCPServer`, as `/mcp remove` does, keeping omp's sign-in; both refuse a server from any file but omp's user `mcp.json`.
A refusal, such as a taken name, is `McpServerRejected`, which the routes answer as a 400 with its message.

### Providers

`GET /api/providers` answers `ProvidersAnswer` from `src/shared/providers.ts`: `providers`, one `ModelProvider` for each provider omp files `/login` credentials under, and `login`, the sign-in the page last started.
`listProviders` in `src/omp/providers.ts` groups omp's available `getOAuthProviders` entries by `storeCredentialsAs ?? id`, so `openai-codex-device` joins `openai-codex` and `zai-coding-plan` joins `zai` as further `methods`.
Each provider's `accounts` are its stored credential rows as `/logout` lists them, and `envKey` names the environment variable omp reads its key from when `keys.source` finds nothing stored.
The store opens and closes on each read, so a `/login` in a terminal shows at the next one; the page reads every minute, and every second while a sign-in runs.

`PUT /api/providers/login`, with `{ method }`, the `/login` entry, starts that sign-in on the server and answers the providers and the new `login`.
`createProviderLogins` in `src/provider-logins.ts` keeps one sign-in at a time: a new one aborts the one under way, and one not done within five minutes fails.
While it runs, `login` is `{ phase: "running", url, instructions, progress, prompt }`, from the flow's `onAuth`, `onProgress`, and `onPrompt` callbacks; the page shows the address as a link rather than opening it, since a device-code sign-in shows its code first.
`prompt` is `{ id, message, placeholder, secret, allowEmpty }`, and `PUT /api/providers/login/answer`, with `{ prompt, value }`, resolves the `onPrompt` call that asked it, or answers 409 once the flow no longer waits on that question.
For the paste-code providers, omp asks for the code or redirect address while its local callback also listens, and whichever comes first finishes the sign-in.
A sign-in ends as `{ phase: "done", identity }`, after `ModelRegistry.refreshProvider` re-reads the provider's models, or `{ phase: "failed", error }`, and stays until the next one starts or `PUT /api/providers/login/cancel`, which also aborts one under way.
A flow that stores nothing, such as Ollama's with an empty key, fails, as `omp login` reports it.

`PUT /api/providers/sign-out`, with `{ provider, credentialId }`, removes that row through omp's `logoutCredential`, which refreshes the provider's models, and answers the providers after.
`parseLoginMethod`, `parseLoginAnswer`, and `parseProviderSignOut` in `src/server/wire.ts` check the bodies.

### Google Calendar

`src/google-calendar.ts` reads and writes Google Calendar's REST API (`https://www.googleapis.com/calendar/v3`) with the token omp holds for its Google Calendar MCP server, so the Calendar page needs no sign-in of its own.
Google Calendar's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested the same scopes.
`integrationFetch(id)` in `src/integrations.ts` is the `SignedFetch` both Google clients call, and the Slack check too.
It is `signedFetch` in `src/signed-fetch.ts`, which knows nothing of omp, over `mcpBearer` in `src/omp/mcp.ts`, the token omp holds for its server for service `id`.
`signedFetch` sends that token with a GET, or, given an `ApiWrite`, with a POST of its `body` as JSON or a DELETE.
A 401 throws the bearer's refusal: `mcpBearer`'s forgets the token and the tool list and throws `McpRefused`.
Any other failure throws an `ApiError` from `src/signed-fetch.ts` with the answer's status and the API's `error.message`.
An empty answer, such as a 204, is `null`.
`GET /api/google` answers the calendars checked in your Google Calendar's list (`calendarList`, `selected`), each with its id, the name you gave it or else its own, its color, its `group`, its `writable` flag, its `shown` flag, and the error of its last read.
`group` is `mine` for a calendar whose `accessRole` is `owner`, Google Calendar's **My calendars**, and `other` for the rest, its **Other calendars**.
`writable` is true for an `accessRole` of `owner` or `writer`, the calendars a new event may go in.
`shown` is false for a calendar unchecked in the Calendar page's sidebar.
`PUT /api/google/calendars` takes `{ id, shown }`, checked by `parseCalendarShown` in `src/server/wire.ts`, saves the choice in `calendars.json`, and answers the calendars as `GET /api/google` does.
`src/server/calendars-file.ts` keeps the `hidden` calendar ids there, and `GoogleCalendarClient` reads that set on each call.
With no calendar checked in Google Calendar, the events read is an error that asks you to check one there; with every checked calendar hidden in the sidebar, it answers no events.
`GET /api/calendar/events?from=<ISO time>&to=<ISO time>` reads at most 62 days, and reads the list and each shown calendar's events at most once a minute, unless `fresh` asks again; a hidden calendar's events are not read.
Each calendar's `events` read uses `singleEvents=true`, so Google expands repeating events with their removed and moved repeats, and follows `nextPageToken` to the last page.
Canceled events, events you declined, working-location events, and events with no length are left out, and Google's exclusive all-day end becomes the last included day.
An event carries its calendar's id, Google's event id, which differs for each repeat, and its calendar's `writable` flag, and it links to the event in Google Calendar.
One calendar that cannot be read keeps its error for the Integrations row while the others still answer; only when none can is the answer an error.
The Calendar page reads the open month's events through `calendarEventsStore` in `web/reads.ts` every minute while Google Calendar's connection is `ready` or `failing`, and puts a multi-day event on each day it covers.
The Calendar tab's sidebar reads the calendars through `googleStore`, and a checkbox's `PUT` reads both stores again, so the open month changes at once.
Each successful calendar save merges that calendar's confirmed visibility into `googleStore` before rereading, so an aborted or failed refresh cannot undo it.
The server deletes the `google.json` that an older version kept the calendars' secret iCal addresses in when it starts.

### New and local events

`PUT /api/calendar/events/new` takes a `NewEvent`, `{ title, when, calendar }`, checked by `parseNewEvent` in `src/server/wire.ts`, and answers a `NewEventAnswer`, `{ kept }`: the event as kept on this computer, or `null` for one added to Google Calendar.
The title is trimmed, nonempty, and at most 500 characters; `when` is `{ allDay: true, firstDay, lastDay }` with `YYYY-MM-DD` days, the last not before the first, or `{ allDay: false, start, end }` in epoch milliseconds with the end after the start.
`calendar`, a `NewEventCalendar`, is `{ kind: "local" }` or `{ kind: "google", calendarId }`.
A Google calendar goes through `GoogleCalendarClient.create`, which refuses a calendar not checked in your Google Calendar's list or not `writable`, and otherwise posts the event to the calendar's `events` with its `summary` and `start` and `end`: `{ date }` for an all-day event, whose end Google takes as the day after the last, or `{ dateTime }` in ISO time.
It then forgets that calendar's kept event reads, which the client keeps per calendar, so the next read shows the event.
This computer adds the event to `events.json` beside the access token, through `LocalEventsFile` in `src/server/local-events-file.ts`, with a `crypto.randomUUID()` id; a file it cannot read moves to `events.json.invalid`.
`parseEventWhen` in `src/shared/calendar.ts` checks an event's `when` both for `parseNewEvent` and for each event that file keeps.
`GET /api/calendar/local` answers every kept event, since only what you typed by hand is there, and the page lays out the days of the month it shows.
`PUT /api/calendar/events/delete` takes an `EventRef`, checked by `parseEventRef`: `{ kind: "local", id }` deletes that kept event if it is still there, and `{ kind: "google", calendarId, eventId }` goes through `GoogleCalendarClient.delete`; it answers `{}`.
`GoogleCalendarClient.delete` refuses a calendar not checked in your Google Calendar's list or not `writable` before asking Google, as `create` does, and otherwise sends a DELETE to the event's address under the calendar's `events`, without `sendUpdates`.
The client counts an `ApiError` of 404 or 410 as deleted, since Google answers 410 for an event deleted a moment ago and 404 once it is purged, so deleting twice ends the same way.
A repeat's event id deletes only that repeat; the client then forgets that calendar's kept event reads, so the next read leaves the event out.
The Calendar page reads the kept events through `localEventsStore` in `web/reads.ts` every minute, with or without Google Calendar.
The page owns what a write changes: it adds the kept event that `PUT /api/calendar/events/new` answers to that store, or reads the month of an event added to Google Calendar again; after a delete it takes a kept event out of `localEventsStore`, or reads the open month's events again, and the delete button stays busy until that read settles.

### Gmail

`GmailClient` in `src/gmail.ts` reads Gmail's REST API (`https://gmail.googleapis.com/gmail/v1/users/me`) with the token omp holds for its Gmail MCP server, through `integrationFetch("gmail")` as `GoogleCalendarClient` reads through `integrationFetch("google-calendar")`, so the Inbox page needs no sign-in of its own.
Gmail's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested `gmail.modify`.
The client reads, replies, and moves conversations to Trash; it never deletes mail for good, labels it otherwise, or marks it read.
`GET /api/gmail/inbox` answers an `InboxAnswer` from `src/shared/gmail.ts`, `{ address, threads }`: the signed-in address from `profile`, and a `MailThread` for each of the inbox's latest 50 threads (`threads?labelIds=INBOX&maxResults=50`), in Gmail's order.
Each thread is read with `format=metadata` and only its `From` and `Subject` headers, eight at a time.
A `MailThread` holds the thread id, the display name of the last message's sender or else its address, the first message's subject, the thread's snippet with its HTML entities decoded, the last message's `internalDate`, whether any message carries the `UNREAD` label, the number of messages, and a link that opens the thread in Gmail under the inbox's address.
A thread without an id, messages, or an arrival time is left out, and one that cannot be read fails the whole answer with Google's message, so the list never has a silent gap.
The client keeps the answer for a minute, unless `fresh` asks again.
The signed-in address is kept for a minute too, so opening a conversation right after the inbox's read reads no profile.
The Inbox page and its sidebar tab read it through `gmailStore` in `web/reads.ts` every minute while Gmail's connection is `ready` or `failing`; otherwise the page shows Gmail's integration row.

`GET /api/gmail/thread?id=<thread id>[&fresh]` answers a `ThreadAnswer`, `{ id, subject, url, messages }`, from `GmailClient.thread`, which reads `threads/<id>?format=full`; a request without an id is a 400.
Drafts are left out as the inbox leaves them out, the subject is the first message's, and the link is the inbox's.
Each `MailMessage` holds its id, the people its `From`, `To`, and `Cc` headers name, split at commas outside quoted names and angle brackets, its `internalDate`, its `UNREAD` label, its snippet with entities decoded, its body, and its attachments.
An HTML body is only `{ kind: "html" }` in the answer: `GmailClient` keeps the HTML beside the conversation's read, by message id, and the page loads it on its own, so the conversation's JSON stays small.
The body comes from a walk of the message's MIME tree: in `multipart/alternative` the `text/html` version wins over `text/plain`, any other multipart reads as its first part with a body, and a part that names a file is never a body.
Each text part is decoded from base64url in the `charset` its `Content-Type` names, and in UTF-8 when no decoder knows that charset.
Every part that names a file becomes an attachment, with its name, MIME type, and size; nothing downloads it.
A message without an id or an arrival time is left out, and each conversation is kept for a minute per id.
The page keeps the conversations it read in memory only, by id, through `readMailThread` and `useMailThread` in `web/reads.ts`, since bodies are large and private.
It reads a conversation once, reads the next and previous ones of the list ahead while one shows, and reads one again from Gmail on **Refresh**, or when the inbox lists a message that arrived after the last read.

Each `MailMessage` also holds the people its `Reply-To` names, so the page addresses a reply itself: `recipientsOf` in `src/shared/gmail.ts` answers as Gmail does, to the `Reply-To`, else the sender, or to the recipients of a message you sent; replying to all copies everyone else in its `To` and `Cc`, and your address is never a recipient.
The page's editor, `MailEditor` in `web/components/inbox/mail-editor.tsx`, is Lexical with rich text, lists, links, and history; it sends the HTML `$generateHtmlFromNodes` writes and the root's text content.
The draft it shows has one owner, `useMailDraft` in `web/mail-draft.ts`: a `MailDocument` of people, subject, and the editor's document as JSON, `""` while it holds no text, which changes only on the events `mailDraftAfter` takes, such as editing a field, choosing **Reply** or **Reply all**, and beginning or ending.
`useReplyDraft` captures a reply's people from the conversation's last message when the reply begins and again only when you choose the other mode, so a refreshed or newly arrived message leaves the draft as it is.
The hook keeps the draft in localStorage under `omp-agents.mail-draft.thread.<thread id>`, or `omp-agents.mail-draft.new` for a new mail, while any field differs from how it began, as `draftUnchanged` compares them, and removes it once none does.
`decodeMailDraft` in `web/mail-draft.ts` reads a kept draft at that boundary: a draft with a missing or mistyped field, or a body Lexical cannot restore, reads as none.
Sending goes through the same hook, as `sendMailDraft` in `web/mail-draft.ts` runs it: the draft's phase moves from editing to sending, in which `mailDraftAfter` refuses every edit and the editor disables its fields, toolbar, and Lexical's editable, so the document submitted is the one shown.
A failed delivery moves it back to editing with the error, and a delivered one closes the draft first and only then removes its localStorage copy, so a removal that throws is logged and leaves the mail sent instead of offering to send it again.
`PUT /api/gmail/reply` takes a `MailReply`, `{ thread, to, cc, bcc, html, text }`, and `PUT /api/gmail/send` a `MailSend`, `{ to, cc, bcc, subject, html, text }`, checked by `parseMailReply` and `parseMailSend` in `src/server/wire.ts`: at most `MAX_RECIPIENTS` people, each with a valid address, at least one of them, a text that is not blank, bodies of at most `MAX_MAIL_BODY` characters, and a subject of at most 1000 with its line breaks dropped; each answers `{}`.
`GmailClient.reply` reads the conversation again with `format=metadata` and the `Subject`, `Message-ID`, and `References` headers, and answers its last message other than a draft.
`mailOf` writes the RFC 2822 message: `To`, `Cc`, and `Bcc`, RFC 2047 encoded words for a name or subject outside ASCII, and a `multipart/alternative` body of base64 UTF-8 `text/plain` then `text/html`; `replyOf` adds `Re: ` before a subject that lacks it and `In-Reply-To` and `References` from the answered message so Gmail threads it.
The client sends it as base64url `raw` to `messages/send`, with the conversation's `threadId` for a reply.
`PUT /api/gmail/trash` takes a `MailTrash`, `{ thread }`, and `GmailClient.trash` posts `threads/<id>/trash`; Gmail keeps it 30 days.
Each write drops the kept inbox and that conversation, so the next read asks Gmail.
Google's 403 for insufficient scopes becomes an error that says to sign in to Gmail again in **Settings › Integrations**.

`GET /api/gmail/message?thread=<thread id>&id=<message id>` serves a message's HTML as a document of its own, built by `mailDocument` in `src/server/mail-document.ts`, from `GmailClient.messageHtml`, which reads the conversation's kept read, so opening a conversation asks Gmail nothing more.
A request without both ids is a 400, and a message the conversation does not hold, or whose body is not HTML, is a 404.
`mailDocument` drops every tracking pixel from the message, through Bun's `HTMLRewriter`: an `<img>` whose width and height, each the smallest of its attribute and its inline `width`/`max-width` or `height`/`max-height` in pixels, are both at most 3px.
An image that declares only one side, a larger side, or a size in other units stays, so a 1×20 spacer keeps the layout it holds.
The page frames that address, not a `srcdoc`: a `srcdoc` document inherits the page's `Content-Security-Policy` from `web/index.html`, whose `img-src` no message can widen, so a message's images never loaded.
Widening the page's own policy is no answer, since it guards the whole dashboard, rendered transcripts too.
The frame keeps `sandbox="allow-same-origin"` and nothing else.
Without `allow-scripts` the message's scripts and event handlers never run, and the sandbox also blocks its forms, its popups, and a `<meta http-equiv="refresh">`, so it cannot navigate the frame.
That makes `allow-same-origin` safe, and the page needs it to size the frame to the message, to open the message's links in a new tab with no opener or referrer, and to pass keys pressed inside it on to the page's shortcuts.
`MailFrame` sizes the frame once the message's document is parsed, not on `load`, which waits for every image: a tracking pixel whose server never answers kept a message zero pixels tall.
A `ResizeObserver` then grows the frame as images arrive.
The document's response carries the policy `sandbox allow-same-origin; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:`, so a message loads images, styles, and fonts and nothing else.
Its `sandbox` directive keeps scripts off even when the address opens in a tab of its own.
The response also sends `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`, and the document's head, which comes before the message's markup, holds `<meta name="referrer" content="no-referrer">` too.
The frame's request is a same-origin GET with the login cookie, so it passes the API's guards like any other read.
Remote images still load, so a sender who tracks opens with them sees the dashboard's request, without a referrer.
The frame sits on white in both themes, since mail is written for white.

## Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, **Inbox**, and **Settings** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
User and assistant turns use `chat-message`, tool calls use `thinking-steps`, and the composer uses `input-message`.
The model's thinking text uses that same group.
`thinking-indicator` shows while the agent works.
`Button`'s `loading` prop preserves its label's width, shows a spinner, disables the control, and sets `aria-busy`.
`InputMessage` takes `sending` and `stopping` for its send and Stop controls.
shadcn's `message-scroller` follows streaming content, preserves the reader's scroll position, and supplies the jump-to-latest button.
The model, thinking, and workspace pickers use shadcn's `popover` and `command` combobox pattern, and the Calendar page's day cards shadcn's `hover-card`.
Fluid's sidebar rail, mobile drawer, cookie, and toggle shortcut are removed from the vendored sidebar, which keeps only the bordered panel.
The dashboard sizes and toggles each sidebar in `web/components/sidebar-panel.tsx`, which gives each its own width and open state, because Fluid's provider held only one of each.
Sidebar widths and the split between panes share `web/components/drag-separator.tsx`: `useDragSeparator` owns the pointer capture, arrow keys, and double-click reset, and `Separator` is the element.
Each call site still clamps its own domain, pixels for a sidebar and a ratio for a split.

The sidebar rows' menus use Base UI's `ContextMenu` for right-click and its `Menu` for the **⋯** button, wrapped in `web/components/ui/menu.tsx` with the look of the `popover` and `command` items.
Both share Base UI's menu items, so each row builds one item list and both menus render it.
The wrapper also opens the context menu on the context-menu key and Shift+F10 at the focused row, because not every platform sends a `contextmenu` event for them.

Every fixed list of choices uses shadcn's Base UI `select`, vendored as `web/components/ui/select.tsx` with the menu's popup and row look, in place of the browser's `<select>`.
`FormDialog` is Base UI's `Dialog`, so a `Select` in its form opens and takes focus there; Esc in one of the form's Radix pickers closes only the picker.

Toasts use Base UI's `Toast` through one manager in `web/components/toaster.tsx`, since the page has no Fluid or shadcn toast; they stack at the bottom right in the `popover` look.

Questions use `web/components/question-card.tsx`, the dashboard's own card in the look of Fluid's `ask-user-questions`, which `web/components/user-request.tsx` fills from omp's request.
A select is one row per omp option, and a confirm is **Yes** and **No** rows, both in `question-options.tsx`, which reuses Fluid's hover highlight and merged selection backgrounds; an input or an editor is a free-text field.
A select's checked rows come from the request, since omp sends a multi-select pick back as a new request with the row checked.

Changes the dashboard makes to Fluid's components are listed in `web/components/ui/PATCHES.md`, each with its reason, so an upgrade is a merge that checks each entry.
The dashboard keeps them mechanical where it can.
`InputMessage`'s text field is `PromptEditor` instead of a `<textarea>`, and gets an `onKeyDown` and `onPaste` passthrough, so the completion list and the composer shortcuts see a key before the submit handling and a pasted file attaches, and a `stopShortcut`.
It also gets two slots, `beforeEditor` and `afterActions`: `composer-queue.tsx` renders the queued rows that omp or the server holds into the first, and `composer-suggestions.tsx` into the second the prompts that the last turn's reply ends on, which `splitSuggestions` in `src/transcript.ts` splits off the reply into the assistant item's `suggestions`.
Its own queue, history recall, and suggested prompts are removed, since those slots replace them.
`ChatMessage` gets `files`, the names of the files a sent prompt carried as text, and `images`, the addresses of the images it carried.

Markdown uses `react-markdown`, `remark-gfm`, and `rehype-highlight` (`web/components/message-markdown.tsx`).
In agent text, raw HTML is escaped, unsafe link schemes are filtered, and an image renders as a link unless it is a `data:` URL.
In agent text, `remarkFilePaths` in `web/file-paths.ts` turns a path to a text file into a link, and that link, like a `file://` one, renders as a `FileLink` from `web/components/file-link.tsx`, which opens the file dialog through the dashboard context.
A `file://` address whose escapes do not decode renders as a link with no address, and text from GitHub keeps no `file://` path, since it renders through the default filter.
A relative path resolves against `FileBaseContext`: the pane's session directory, or the directory of the file the dialog shows.
Text from GitHub, which means pull request descriptions and comments, and Linear issues' text, renders its raw HTML through `rehype-raw` and then `rehype-sanitize` with its default schema, which follows GitHub's, plus a `<video>` with only a `src`.
It keeps images only from GitHub's image hosts and the route for a Linear issue's files, and plays a video only from that route.
`web/index.html` sets the page's `Content-Security-Policy`.
