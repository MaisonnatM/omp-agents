# How omp-agents works

The server's design, its protocols, and its HTTP API.
For installation, see the [README](../README.md); for the interface, see [Using omp-agents](usage.md).

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
- Documents: `convertBufferWithMarkit` in `pi-coding-agent/src/utils/markit.ts`, the converter behind omp's `read` of a PDF, Word, PowerPoint, Excel, or EPUB file, which `src/omp/documents.ts` calls for `PUT /api/attachment/document`.
- RPC: `pi-coding-agent/src/modes/rpc/rpc-client.ts`, `rpc-frame.ts`, and the frame types in `rpc-types.ts`.
  `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of the child's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](#dashboard-sessions).
  `get_available_models` returns omp's whole `Model` objects, with `name`, `contextWindow`, `api`, `identity`, and `serviceTiers`; `get_state` adds `fastModeEnabled` and `fastModeActive`, and `setFastMode` sends `set_fast_mode`.
  Host tools: `RpcClient`'s `customTools` option (`RpcClientCustomTool`), which `start()` sends as `set_host_tools`, so a new process for the same session gets them again; `src/modes/rpc/host-tools.ts` runs them as strict tools, and `defaultLoadModeForToolName` in `src/tools/essential-tools.ts` makes one without `loadMode: "essential"` only discoverable.
  A host tool stays registered through `newSession`, `switchSession`, and `/move` in one process, since omp builds `SessionTools` once per `AgentSession` (`src/session/session-tools.ts`).
  Extensions: `omp -e <file>` (`src/main.ts`, `additionalExtensionPaths`) loads in `rpc-ui` mode too; `src/discovery/omp-extension-roots.ts` dedupes by path only, so the same extension at two paths loads twice.
- Service tiers: `serviceTierFamily` and `shouldSendServiceTier` in `pi-ai/src/types.ts`, which `fastAvailable` in `src/omp/models.ts` calls to decide, as `setFastMode` in `pi-coding-agent/src/session/model-controls.ts` does, whether `/fast` can turn on for the live model.
- Settings and discovery: `pi-coding-agent/src/config/settings.ts`, `pi-coding-agent/src/discovery/index.ts`, and `pi-coding-agent/src/task/discovery.ts`.
- Credentials: `pi-coding-agent/src/session/auth-broker-config.ts` (`discoverAuthStorage`) and `pi-ai/src/registry/oauth/index.ts` (`getOAuthProviders`).
  `connectedProviders` in `src/omp/models.ts` keeps the `/login` providers that have a credential, as omp's RPC `get_login_providers` marks them `authenticated`.
  It opens the credential store on each call and closes it, so a login in a terminal counts at the next call.
- Model roles: `pi-coding-agent/src/config/model-resolver.ts` (`expandRoleAlias`, `resolveRoleChain`), whose `@role` aliases `resolveRoles` in `src/omp/models.ts` follows for `GET /api/models/roles`.
  `modelEntries` reads each role and fallback selector with `parseRetryFallbackSelector` and maps it to a listed model with `resolveProviderModelReference`, which follows retired variant ids such as `grok-4.7-high` and dotted spellings such as `claude-fable-5.1`.
- MCP: `pi-coding-agent/src/mcp/json-rpc.ts` (`callMCP`), `config.ts` (`loadAllMCPConfigs`), `oauth-credentials.ts` (`removeManagedMcpOAuthCredentials`), `oauth-discovery.ts` (`discoverOAuthEndpoints`), `oauth-flow.ts` (`MCPOAuthFlow`), and `config-writer.ts` (`addMCPServer`, `updateMCPServer`, `readMCPConfigFile`), which `src/omp/mcp.ts` wraps for the tickets page and Settings › Integrations.
  The MCP sign-ins and sign-outs read and write omp's credential store through the same `discoverAuthStorage`, opened and closed on each call.
  `pi-coding-agent/src/commands/token.ts` uses `refreshStoredManagedMcpOAuthCredential` from `oauth-credentials.ts` to refresh a managed token and persist its rotated refresh token before printing the access token.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory.
- Request usage: `omp-stats/src/aggregator.ts` (`getDashboardStats`, `getToolDashboardStats`, `getTimeRangeConfig`), `rollup.ts` (`getProviderTimeSeries`), `live.ts` (`statsLive`), and `db.ts` (`initDb`).
  `src/omp/stats.ts` reads omp-stats' database and starts its live sync only after the Settings page's Analytics section first reads it.
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

Sessions started from the dashboard are omp child processes in RPC mode with tool dialogs (`--mode rpc-ui`, NDJSON over stdio), spawned through omp's own `RpcClient` from this same package's CLI.
The page starts one with a single `start` request whose `kind` is `new`, `fork`, or `resume`, and the server answers each with one `started` reply that carries the new session's instance id or the error.
The server picks the instance id before omp spawns, so a question that omp raises while the session opens already belongs to it.
A new session's first message rides on the `start` request: the server spawns omp, sends the message as its first prompt, and answers the page as soon as omp reports ready, with no terminal, registry, or relay involved.
**Resume** spawns the same child in the directory that the session file's header records and opens the file with omp's `switch_session` command.
Prompts, Stop, live events, subagent progress, and questions stay on the pipe.
A prompt carries omp's `streamingBehavior`, `steer` or `followUp`, so omp queues it during a turn the way its terminal does.
The composer's queue is omp's `queue_update` event.
A `dequeue` message takes one message back with `remove_queued_message`, and the server answers with `withdrawn`, carrying its text and images so the composer can restore both.
A `promote` message, a queued row's **Send now**, is `promote_queued_message`, which moves a follow-up into the steering queue.
An `interrupt` message, Stop, is `abort_and_restore_queue`, which aborts the turn and hands back both queues, steers first, in one `withdrawn` answer; omp's terminal Esc does the same.
A session runs its prompts, interrupts, promotes, and `flush` requests one at a time, in the order the page sent them (`TurnGate` in `src/turn-gate.ts`), because the socket handlers do not wait for each other.
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
An `edit-prompt` message rewinds a dashboard session in place: inside the same `TurnGate`, the server aborts a running turn, sends omp's `branch` command with the last prompt's entry id, and reads omp's state for the new session id and file.
omp writes the history before that prompt to a new file and keeps the old one, which then lists as a past session.
The session reports `switched`, so the server points its views at the new file before it sends the edited text as a plain `prompt`, whose events then land in the new transcript.
A Collab terminal session has no `branch` frame, so only a dashboard session offers the edit.
omp's `/move` sends `config_update` too, and the state read after it finds a new session file: the session takes its working directory from that file's header, clears its subagents when the session id changed, and reports `switched`, so the roster and the views follow the moved file.
omp writes a moved session that has no reply yet only with its first reply, so until that file exists the session keeps its old file and directory, and a later state read follows it.
The composer's directory picker sends `/move <path>` as a plain `prompt`, only to an idle dashboard session, since omp refuses to move while a turn runs.
The dashboard serializes model, effort, and fast-mode setters with state reads in a separate `TurnGate` from turn commands.
Event-driven refreshes coalesce while queued, so a read cannot overwrite a later switch, and switching stays visible until every queued model change has finished.

A `prompt` message, and a `start` of kind `new`, carry `images`, each `{ data, mimeType }` with the file's bytes in base64, as omp's `ImageContent` takes them.
`src/server/wire.ts` accepts PNG, JPEG, GIF, and WebP, up to `MAX_PROMPT_IMAGE_BYTES` (32 MB) per prompt, and a prompt of images with no text.
The socket's `maxPayloadLength` is 64 MB so such a message fits.
A dashboard session passes the images to omp's RPC `prompt`; a terminal session's guest puts them on its Collab `prompt` frame, a held follow-up included.
omp's `steer_subagent` and Collab's `agent-cmd` `chat` take text only, so a subagent's prompt with images is refused.
omp writes a prompt's images inline into the session file and then moves each to its blob store, `~/.omp/agent/blobs/<sha256>`, leaving `blob:sha256:<hash>` in the file.
A user item's `images` holds a `data:` URL for an inline image and `/api/image?hash=<sha256>&type=<image type>` for a moved one; that route serves the blob file as `type`, which must be one of the four prompt image types, since the store keeps none.

A prompt's other files travel as text, so they reach a subagent and a terminal session's Collab frame too, neither of which takes images.
`web/components/prompt-attachments.tsx` reads each file as it attaches: a file that is UTF-8 without a NUL byte, and not a PDF, is its own text, and any other goes to `PUT /api/attachment/document`, whose body is `{ name, data }` with the bytes in base64, up to `MAX_PROMPT_DOCUMENT_BYTES` (32 MB).
The route hands the bytes and the name's extension to omp's `convertBufferWithMarkit` and answers `{ text }`, the Markdown omp reads; a format omp cannot convert, or a file it fails to read, answers 422 with omp's reason, which the composer shows in its note.
`withFiles` in `src/shared/prompt-files.ts` puts each file after the typed text in the block omp's `@file` arguments write, `<file name="…">`, its text, and `</file>`, so a leading `/skill:` or file command still expands with the files as its arguments; the composer keeps the files' text under `MAX_PROMPT_FILE_CHARS`, a million characters.
omp saves the prompt as that text, so `userPrompt` in `src/transcript.ts` splits the trailing blocks off again with `splitFiles`, and a user item's `files` holds their names, which the transcript shows as chips.

## Desktop shell

`desktop/` is the desktop app: an Electron main process, `desktop/main.ts`, in its own package, so the root `bun install` never fetches Electron.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls, so the shell runs the server as a child process, `bun src/server.ts`, and never imports it.
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
- **Open at Login** (`desktop/login-item.ts`) writes a LaunchAgent, `~/Library/LaunchAgents/dev.omp-agents.desktop.port-<port>.plist`, through `plutil`, and removes it when cleared.
  Electron's `setLoginItemSettings` registers the bundle alone, and a bundle launched without arguments runs Electron's default app, not `desktop/`; the agent runs the bundle's binary with `desktop/` as its argument, as `desktop/launch.ts` does.
  launchd reads the file at the next login, so ticking the box starts nothing now; `RunAtLoad` without `KeepAlive` lets Cmd+Q quit for good.
  The agent carries only the environment variables that the server and omp read to find `bun`, `omp`, and their files, so no secret a shell exports lands in the plist.

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
  Closing the socket detaches without ending the shell.
- `src/server.ts` serves both socket kinds from one `Bun.serve`, its data typed as the union of `SocketData` and `TerminalSocketData`, and `isTerminalSocket` routes each handler to `src/server/terminal-socket.ts` or the `Dashboard`'s session socket.

## Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI.
omp builds those reports from its auth storage, extensions, and credential broker, so the server reads the command's output instead of rebuilding that setup.
omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code.
When the output is not a usage report, the footer shows the last line omp wrote to stderr.

## Analytics

omp-stats owns the request history in `~/.omp/stats.db`, under omp's config root.
`src/omp/stats.ts` starts `statsLive()` on the first Analytics read; it syncs every session transcript, watches for changes, and resyncs every five minutes until the server stops it on shutdown.
The dashboard calls omp-stats' aggregate and tool reads for the selected range, then groups request rows by session file for the top sessions.
`src/analytics.ts` folds nested subagent and advisor files into their top-level session, assigns the session's working directory from the saved-session index, and orders models, workspaces, and sessions by token usage.
`src/omp/stats.ts` reads time buckets by recorded provider through omp-stats' rollup-aware `getProviderTimeSeries`, using the same source as the totals cards.
`src/analytics.ts` derives chart totals and provider totals from those rows, fills missing buckets with zeros, and starts all time at the first request.
`web/components/settings/provider-trend.tsx` renders Recharts stacked bars, bucket details, and an optional data table from that provider breakdown.
The page and an Analytics API read with no range default to `24h`.
`analyticsStore` in `web/reads.ts` uses `createPolledStore` to keep each range's last successful answer in memory and localStorage, discarding incompatible saved shapes.
`AnalyticsTab` shows that answer while refreshing on activation or a range change, and every two seconds during indexing or 30 seconds otherwise while active.
A failed refresh keeps the last successful answer and reports its error without replacing another range's data.
The displayed cost is omp's API-equivalent list price, not the user's subscription bill.

## Routines

A routine starts dashboard sessions, or runs a shell command, on one or more schedules. A schedule is every so many minutes, counted from the last run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST. The routine is due at the earliest of them. Two intervals share that last run, so the shorter one decides.
Its task is one prompt or one command.
The prompt ends with `UNATTENDED`, which tells the session not to ask questions.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops a routine whose task was pull requests.
A prompt task from before `pin` reads as unpinned.
The rest of the file stays.
The next save writes `schedules` and `pin`.
A file that is not a list of routines still moves aside.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, and one `outcome`: `pending` from its claim, with whether it is still `queued`; a `session` with the instance and session ids it started; or a `command` with the command's result once it ran.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, a started session a `session` (the first, of the several that a pull request routine's run started), and otherwise `pending`, queued when its `queued` is set or its `queue` list holds an entry.
A run stays queued from its claim until the drain starts its session or command.

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected, and only on the server that owns routines; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
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
On a takeover the server logs it, reads `routines.json`, `todos.json`, and `projects.json` again, since the previous owner kept saving them, fails the runs that were running, and drains the todo inbox.
A server that exits normally deletes its lock.
The servers that do not own it still serve their pages, start sessions, and take what you do in them, such as editing a routine, a todo, or **Run now**; only the minute tick, the todo inbox, and the end inbox's requests for sessions started in a terminal are left to the owner.
Each server keeps its own copy of `routines.json` and `todos.json` in memory and saves whole, so the last server you edited in wins until the owner changes.
`projects.json` is the exception: every server runs its own project runner, which writes on every worker turn, so `ProjectsFile.apply` reads the file again before it applies a change, and a change made on one server keeps what another saved.

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
A worker starts in the directory `start_worker` names, resolved against the project's workspace when relative and kept for the starter when it starts with `~`, else in the workspace, on omp's default model, with no branch of its own.

The coordinator's tools are strict host tools, every property required, loaded as `essential`: `start_worker` (`title`, `prompt`, `cwd`), `list_workers`, `read_worker` (`worker`), and `message_worker` (`worker`, `text`).
An error a tool throws reaches the coordinator as the tool's error, and every tool throws once the project is archived.
`message_worker` prompts the worker as a follow-up, and resumes it first through the same starter when it does not run.

A worker's session reports three kinds of news, which the runner saves as updates:

1. Its `turn-ended` update saves the reply as the worker's `lastReply`, empty when it had none, and becomes `finished`.
2. Each roster change, which the server passes to `observe`, reports every question the worker waits on whose request id the runner has not reported for that live session, as `asked`, so a question is reported once.
3. Its process's exit becomes `stopped`, unless the dashboard is stopping: `Dashboard.stop` calls the runner's `stop` before it ends the sessions, since they exit with the dashboard, which is no news.

The runner saves each update in `projects.json` at once and then delivers.
When the coordinator's session runs and its status is `idle`, the runner sends every waiting update, in order, as one prompt that `updateText` builds, starting `[omp-agents] Project update.`, quoting at most `REPLY_QUOTE_CHARS` (2,000) of each finished worker's `lastReply`, and telling the coordinator that only the user answers an `asked` question, in the dashboard.
It sends it through `LiveSession.followUp`, which, unlike `prompt`, rejects when omp does not take the message.
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
Each kind has its own check, and `src/server/loops.ts` runs two of them.
The update check (`UPDATE_KINDS`) runs at startup and every six hours, whether or not a page is connected, and again after each update that succeeds.
The activity check (`ACTIVITY_KINDS`) runs every two minutes while a socket listens, and when a socket opens unless it ran since the last tick that found none.

- `latestOmp` in `src/omp/release.ts` asks `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts` for the newest release on omp's `update.channel`, unless `startup.checkUpdate` is off.
  `installedOmp` reads the version from the installed package's `package.json` on each check, so the check is right after an update, before a restart.
- `findModelUpdates` in `src/omp/model-updates.ts` reads the global `modelRoles` and `retry.fallbackChains` with `parseRetryFallbackSelector`, and keeps the listed models that `classifyModel` in `pi-catalog/src/identity/index.ts` places in an Anthropic or OpenAI family with a revision.
  A model's line is its provider, its family, and its id with the version masked, so `claude-opus-5-5` and `claude-opus-5-6` share one.
  It offers the newest revision of each line that a connected provider lists, and leaves dated snapshots out.
- The pull requests come from `loadPullRequests` in `src/pull-requests.ts` over the known workspaces that still exist, through the pull request list's 30-second cache, so the page's polls and the check share one query.
  `moveOf` in `src/shared/moves.ts` picks each one's move, with `agentOn` over the roster, and a move in `YOUR_MOVES` is a notice.
- `waitingOnYou` in `src/slack-messages.ts` calls Slack's Web API with omp's Slack MCP sign-in through `readWithMcpSignIn`, since the MCP server's search answers in Markdown and Slack's `search.messages` needs a scope the sign-in lacks.
  `auth.test` names the user, and two `assistant.search.context` searches over the last three days, newest first, read the direct and group messages (`im,mpim`) and the channel messages that mention them (`<@ID>`), each up to five pages of 20 through `next_cursor`.
  A conversation gives one notice for the messages after the user's last one there; the user's own messages, bots, Slack's system messages, and empty ones count for nothing.
  `slackText` turns Slack's markup into plain text.
  Without a Slack sign-in the check finds nothing.

A check that fails keeps what the last one found for its kind, and the marks for it, and logs each distinct error once.
A repository GitHub did not answer for keeps its pull requests' notices the same way.
A notice whose update runs or ran stays after a check stops finding it, so the page shows how the update ended.
A notice's id names what it is about, so it is a new notice when that changes, even after the user cleared the last one: `omp:<latest>`, `model:<provider>/<from>><to>`, `pull-request:<owner>/<repo>#<number>:<move>`, or `slack:<channel>:<ts>` of the newest message.
A Slack notice dates from its message.
A pull request notice dates from the check that found it, since the pull request's last update on GitHub may predate the move, except on its repository's first answer since startup, which dates each from that update, so a workspace found later or a repository GitHub answers again does not bring old pull requests as news.
The marks of a notice the checks stop finding last ten minutes, so a pull request whose checks run again, which leaves **Ready to merge** for a moment, keeps its marks, and one that comes back later is news again.

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
The accepted ranges are `24h`, `7d`, `30d`, `90d`, and `all`; an unknown range returns 400.
The answer includes totals, time buckets with per-provider usage, provider totals, models, workspaces, agent types, tools, the 20 sessions with the most tokens, and live indexing status.

Edits go through two endpoints, each taking the same `?cwd=` and answering with the settings as they load after the write:

- `PUT /api/settings/routing` takes one change: a role's model or fallbacks, a model-keyed chain, some `retry.*` values, or the provider order.
  The server writes it through omp's own write path, the one `omp config set` uses: `Settings.loadIsolated`, the setting's `set` or `setEntry`, and `flush`.
  omp re-reads `config.yml` under its lock and writes back only the paths that changed.
  A model must be one that `omp models` lists, read by omp's `parseRetryFallbackSelector`, so `provider/id:level` works even when the id holds a colon.
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
The path is absolute or starts with `~/`; the page resolves a relative one against the session's directory first.
The file's real path, after symlinks, must end in one of `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot reach a key file.
It must also lie outside the directories that hold sign-ins and config, `DENIED_DIRS` in `src/text-file.ts`, compared by their real paths, or the route answers 403: omp-agents' own directory, which holds the access token, and omp's agent directory, but for its Markdown, such as `AGENTS.md` and skills.
It reads the first `MAX_TEXT_FILE_BYTES` (1 MB) and answers 415 when those bytes are not UTF-8.
It runs `git worktree list --porcelain -z`, `git for-each-ref`, and `git symbolic-ref` on each call, and reads `origin` through the pull request list's cached lookup.
Like a new session's `start`, `cwd` may name any directory.
The new-session draft reads it for its branch picker, and a live session's header reads it when it opens and when a turn starts or ends.
`GET /api/changes?session=<session id>` answers a session's [changes page](usage.md#session-changes) list, `SessionChanges` in `src/shared/changes.ts`, or 404 for a session it does not know.
It reads the session's checkout from its worktree, else its directory: `git diff --name-status` and `--numstat` against the merge base of `HEAD` with `origin/HEAD`, else against `HEAD`, else against the empty tree before the first commit, and `git ls-files --others --exclude-standard` for untracked files.
It folds the session's transcript with `Work` for the files its own `edit` and `write` calls changed, keeping each transcript's fold while its size and modification time stay the same, and lists those git does not name after git's.
`GET /api/changes/file?session=<session id>&path=<path>` answers one file of that list in full, `ChangedFileText`, with every line of `git diff --histogram` as numbered rows, or a note for a binary file or one over `MAX_CHANGED_FILE_BYTES` (1 MB).
It computes the list again and answers 404 for a path the list does not hold, so it reads no file the session and its checkout did not change, and passes the path with `--literal-pathspecs`, so a name such as `app/[id]/page.tsx` is not a glob.
While the changes page of a live session shows, the page watches that session's view, so its `work` messages reach the page, which reads both routes again whenever the session's changes grow.
`GET /api/project-notes?id=<project id>` answers a project's notes, `{ dir, notes }`, each note a `ProjectNote` (`{ name, path, modifiedAt }`) for a Markdown file in the directory, `README.md` first and then by name, or 404 for a project the server does not know; the page opens a note through `GET /api/file`.
`GET /api/conversations?q=<words>` answers `ConversationSearchAnswer` from `src/shared/sessions.ts`: every saved conversation whose prompts or replies hold every word, the file changed last first, each by its latest such message, with that message's transcript item id, a snippet, and how many messages match; a blank `q` is a 400.
It waits for the transcript reads asked for so far, then reads nothing itself; the page leaves out the sessions the sidebar hides and lists the first 30.
`GET /api/pull-request/files?owner=<o>&repo=<r>&number=<n>` answers the list on a pull request's **Code** tab, `PullRequestChanges` in `src/shared/github.ts`: its title and branches from `gh api repos/<o>/<r>/pulls/<n>`, and its files from `gh api --paginate --slurp repos/<o>/<r>/pulls/<n>/files`, which lists up to GitHub's 3000 where GraphQL's `files` stops at 100.
It reads GitHub again on each call and keeps the answer, with each file's `patch` and blob id, for the file reads for 30 seconds.
`GET /api/pull-request/file?owner=<o>&repo=<r>&number=<n>&path=<path>` answers one file of that list in full, `ChangedFileText`, and 404 for a path the list does not hold.
GitHub's patch keeps three unchanged lines around each change, so `patchRows` in `src/shared/changes.ts` fills the lines before, between, and after its hunks from the file's text at the head, which one `gh api graphql` call reads by the blob id the list names.
A removed file's patch holds every line, so it reads no blob; a file GitHub sends no patch for, a binary file, and one over `MAX_CHANGED_FILE_BYTES` answer a note.
`GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>` answers the pull requests of a details' **Stack**, `StackedPullRequest[]` top first, from one `gh api graphql --paginate --slurp` read of the repository's open pull requests, forks left out, which it keeps for 30 seconds.
`stackOf` in `src/pull-request-stack.ts` follows the base branches down from the pull request and the pull requests based on its branch up, so the stack holds those that the Pull requests page does not list.
`GET /api/pull-request/options?owner=<o>&repo=<r>` answers `PullRequestOptions` for the pickers of a pull request's **Summary**: the repository's labels and the people its issues can be assigned to, whom a review can be asked of, each from `gh api --paginate --slurp` and sorted by name, kept five minutes per repository.
`PUT /api/pull-request` takes a `PullRequestEdit`, a pull request and one `change`, checked by `parsePullRequestEdit` in `src/server/wire.ts`: a label or a review request added or removed through REST, or a state of `open`, `draft`, or `closed` through the GraphQL mutations `stateSteps` orders, a closed pull request reopening before its draft flag changes.
It answers the pull request as `GET /api/pull-request` reads it after the change, read again from GitHub, and the details then refresh the pull request list.
One change goes per call, so two changes made at once each keep the other.
The details send their changes one at a time through `web/use-queued-save.ts`, which the issue detail's fields share.
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
`list_issues` and `get_issue` name an issue's labels without their colors, so the server reads each team's labels with `list_issue_labels`, by the team key that prefixes the identifier, and keeps them for five minutes; `?fresh` reads them again too.

`GET /api/ticket?id=<identifier>`, such as `?id=ENG-2368`, answers the tickets page's main content with that issue in full: the row's fields, the assignee, the team's id, the description, who opened it and when, the links Linear attaches to it, and its comment threads.
The server calls `get_issue` and `list_comments` in parallel, through the same MCP sign-in, with no cache, so each opening reads the issue again.
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

### Integrations

`MCP_SERVICES` in `src/shared/accounts.ts` holds the services whose MCP server the **Integrations** page signs omp in to, keyed by the ids in `MCP_INTEGRATIONS`.
Linear, Slack, and Google Calendar are the three.
Each names its label, the host omp's server for the service is on, and the name and URL of the server a sign-in adds when omp has none.
`src/integrations.ts` keeps a sign-in per service, and the page adds each service's brand mark and what it gives.
`SLACK_USER_SCOPES` is the chat, history, search, and user set a dedicated Slack app may grant.
Canvas, list, file, reaction, and channel-creation scopes are not requested.

`GET /api/integrations` answers `{ integrations }`, one `McpIntegration`, `{ id, connection, signIn, setup }`, under each service's id.
`setup` is `null` for Linear, which registers its own OAuth client.
For Slack it is a `SlackSetup` with the client ID, whether a client secret is stored, the redirect URI, the callback port, the scope string, and `configured`.
For Google Calendar it is a `GoogleSetup` with the client ID, whether a client secret is stored, the callback port, and `configured`.
The client secret is absent from that body.
`GET /api/settings` does not read `mcp.json` either.
Its file list comes from omp's context, prompt, command, rule, skill, hook, and agent discovery.
Before the app is saved, Slack's setup uses callback port 3000 and the full scope list, with `configured: false`.
`configured` is true only when the user MCP file has a client ID, a client secret, a nonempty subset of `SLACK_USER_SCOPES`, an HTTPS redirect, and a callback port.
An HTTPS loopback redirect must use a different port from the local HTTP callback.
Google Calendar's setup uses callback port 3119 until a client is saved, and is `configured` only when its server has a client ID, a client secret, and a callback port.

`connection` is `absent` while omp's user-level MCP config has no enabled server on the service's host, and `signed-out` while omp's credential store, read again on each call, holds no OAuth sign-in for it.
A Slack or Google Calendar server that already has a sign-in is still probed when the saved client settings are incomplete.
Otherwise `checkMcpServer` in `src/omp/mcp.ts` lists the server's tools with `tools/list`, following `nextCursor`, through the same token as the tickets' calls.
`connectionOf` in `src/integrations.ts` turns the outcome into `ready` with the tool names, `refused` when the server throws `McpRefused` on a 401 that asks for a new sign-in, or `failing` with any other error.
The server keeps each list for a minute and never a failure; `?fresh` lists again, and a sign-in, a sign-out, or a 401 on a tickets call drops it.
While a service's sign-in waits on the browser, its connection is the one last answered, without listing the tools again.
The page shows the **Tickets** tab while Linear's connection is `ready`, `refused`, or `failing`, and keeps the last read in localStorage.
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

`PUT /api/integrations/google-calendar/client` takes `{ clientId, clientSecret?, callbackPort }` of a Google OAuth client of type Web application.
`parseGoogleClient` answers 400 for a client ID that does not end in `.apps.googleusercontent.com` or a bad port.
The save writes the existing user server on `calendarmcp.googleapis.com`, or a new `google-calendar` server, the way Slack's does.
It sets the scope to `GOOGLE_CALENDAR_SCOPES` (events, the calendar list read-only, and free/busy), `prompt: "consent"` so Google issues a refresh token, the callback port, and the redirect `http://localhost:<port>/callback`, which the client must list as an authorized redirect URI.
The same secret, client-change, and credential rules as Slack's apply.

`PUT /api/integrations/sign-in`, with `{ id }`, starts a sign-in the way omp's `/mcp reauth` does.
Linear still reads the OAuth endpoints from metadata, registers a client when the authorization server offers registration, and listens on `localhost:3000`.
Slack and Google Calendar refuse to start until `setup.configured` is true, so they do not open an authorization URL that has no client ID.
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
`createSignIn` in `src/sign-in.ts` holds that state for every MCP integration.

`PUT /api/integrations/sign-out`, with `{ id }`, abandons a sign-in under way and removes the sign-ins omp manages for the server, as omp's `/mcp unauth` does: omp's `removeManagedMcpOAuthCredentials` removes them under the server's credential id and the ids it files a sign-in for the URL under.
`mcp.json` keeps the server and, unlike `/mcp unauth`, its `auth` block.
A sign-in that omp does not manage stays, and the route answers an error that says so.
`parseIntegrationId` in `src/server/wire.ts` checks both bodies.

### Google Calendar

`src/google-calendar.ts` reads Google Calendar's REST API (`https://www.googleapis.com/calendar/v3`) with the token omp holds for its Google Calendar MCP server, so the Calendar page needs no sign-in of its own.
Google Calendar's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested the same scopes.
`readWithMcpSignIn` in `src/omp/mcp.ts` sends the server's token; a 401 forgets the token and the tool list and throws `McpRefused`, and any other failure throws Google's `error.message`.
`GET /api/google` answers the calendars checked in your Google Calendar's list (`calendarList`, `selected`), each with its id, the name you gave it or else its own, its color, its `group`, its `shown` flag, and the error of its last read.
`group` is `mine` for a calendar whose `accessRole` is `owner`, Google Calendar's **My calendars**, and `other` for the rest, its **Other calendars**.
`shown` is false for a calendar unchecked in the Calendar page's sidebar.
`PUT /api/google/calendars` takes `{ id, shown }`, checked by `parseCalendarShown` in `src/server/wire.ts`, saves the choice in `calendars.json`, and answers the calendars as `GET /api/google` does.
`src/server/calendars-file.ts` keeps the `hidden` calendar ids there, and `GoogleCalendarReader` reads that set on each call.
With no calendar checked in Google Calendar, the events read is an error that asks you to check one there; with every checked calendar hidden in the sidebar, it answers no events.
`GET /api/calendar/events?from=<ISO time>&to=<ISO time>` reads at most 62 days, and reads the list and each shown calendar's events at most once a minute, unless `fresh` asks again; a hidden calendar's events are not read.
Each calendar's `events` read uses `singleEvents=true`, so Google expands repeating events with their removed and moved repeats, and follows `nextPageToken` to the last page.
Canceled events, events you declined, working-location events, and events with no length are left out, and Google's exclusive all-day end becomes the last included day.
An event's id is its calendar's id and Google's event id, and it links to the event in Google Calendar.
One calendar that cannot be read keeps its error for the Integrations row while the others still answer; only when none can is the answer an error.
The Calendar page reads the open month's events through `calendarEventsStore` in `web/reads.ts` every minute while Google Calendar's connection is `ready` or `failing`, and puts a multi-day event on each day it covers.
The Calendar tab's sidebar reads the calendars through `googleStore`, and a checkbox's `PUT` reads both stores again, so the open month changes at once.
Each successful calendar save merges that calendar's confirmed visibility into `googleStore` before rereading, so an aborted or failed refresh cannot undo it.
The server deletes the `google.json` that an older version kept the calendars' secret iCal addresses in when it starts.

## Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, and **Settings** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
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

Toasts use Base UI's `Toast` through one manager in `web/components/toaster.tsx`, since the page has no Fluid or shadcn toast; they stack at the bottom right in the `popover` look.

Questions use `web/components/question-card.tsx`, the dashboard's own card in the look of Fluid's `ask-user-questions`, which `web/components/user-request.tsx` fills from omp's request.
A select is one row per omp option, and a confirm is **Yes** and **No** rows, both in `question-options.tsx`, which reuses Fluid's hover highlight and merged selection backgrounds; an input or an editor is a free-text field.
A select's checked rows come from the request, since omp sends a multi-select pick back as a new request with the row checked.

## Code layout

The server lives in `src/`:

- `src/server.ts`: the entry point.
  Builds the page, loads the access token, builds the `Dashboard`, starts the HTTP and WebSocket server on its routes and socket handlers, then starts it.
  `PORT` sets the port, 4317 by default.
  On `SIGINT`, `SIGTERM`, or the desktop shell's pipe ending, `shutdown()` awaits `Dashboard.stop` before it stops the server and exits; the process's `exit` handler calls `Dashboard.exited`, which writes what the stores have not and releases the owner lock, however the process exits.
- `src/server/dashboard.ts`: `Dashboard`, the composition root: it builds the stores, `LiveSessions`, `Views`, `Notices`, `Broadcasts`, the inboxes, `Worktrees`, the starter, `RoutineRunner`, `ProjectRunner`, `Loops`, and the socket handler in dependency order, each handed the parts above it, and owns the live-update switch, the registry listing, the file rescans, the activity check, and the owner lock's takeover.
  Two edges point down, closing the only cycles: a live session's update reaches the parts built after `LiveSessions`, and a notice change reaches the `Broadcasts` that reads the notices; no constructor calls either.
  Nothing follows the registry, watches a directory, or publishes before `start(server)`; `stop()` first stops the loops and both inboxes, so no tick publishes while the rest shuts down, then ends the sessions started here, hangs up on the shells, stops omp-stats, flushes the stores, and aborts the routine commands still running.
- `src/server/http.ts`: the request checks (`Host`, `Origin`, `Sec-Fetch-Site`, the token cookie) and the JSON answer helpers.
  `/api/` requests and sockets are admitted by the cookie alone, so a stray `?token=` on a signed-in request changes nothing; only `/` reads `?token=`, to set the cookie.
  `src/server/auth.ts` keeps the token file and parses the cookie, `src/server/address.ts` names the port, host, and listening line that the desktop shell shares, and `src/server/page.ts` bundles `web/index.html` in memory and serves it only to a signed-in browser.
- `src/server/routes.ts`: the `/api/` endpoints, in four groups (sessions, integrations, pull requests, and files), each handed only its part of `RouteEnv`.
  Every read goes through `get`, and every write through `write(parse, run, refuse?)`, which checks the origin and the JSON body, answers a body `parse` refuses with its response, and maps an error `run` throws through `refuse`, else to a 500.
  `src/server/wire.ts` parses every socket message and request body into typed values; every parser returns a `Parsed<T>`, `{ ok }` or `null`, and the two OAuth client parsers `{ error }` in place of `null`, a reason the page shows.
- `src/terminals.ts`: the terminal panel's shells, each in a pseudo-terminal with its scrollback; `src/server/terminal-socket.ts` handles the `/ws/terminal` sockets that attach to them, and `src/shared/terminals.ts` holds the shapes and messages the page shares.
- `src/server/socket.ts`: handles each socket message.
  A `ClientFrame` may carry a per-page `ack` counter, validated by `wire.ts`.
  Once its handler settles, the server sends `done` with that counter and a nullable error.
  Untagged messages retain their existing replies.
  `src/server/start.ts` starts, forks, and resumes dashboard sessions for the page's `start` and `resume-all` requests.
  `src/server/session-end.ts` ends a session for the page's `end` message and for the end inbox: `endSession` stops it, then calls `Worktrees.removeCheckout` on its worktree from `SessionFacts`, else its cwd, and logs the blockers of a checkout that stays, which **Settings → Worktrees** still lists.
- `src/server/live-sessions.ts`: the one registry of running sessions, terminal and dashboard alike, each behind the `LiveSession` interface in `src/live-session.ts`.
  Each session's `row()` returns a `LiveRow`, what its transport knows; `rows()` adds `cwdDisplay`, the session's facts, and the subject a quick action started it on, to make the roster rows.
  The registry indexes its sessions by session id for `bySessionId`, and rebuilds the index when a session joins or leaves or a dashboard session reports `switched`.
  `add` refuses a session whose `finished()` already holds, such as a dashboard session whose omp exited as it spawned, and `start.ts` answers that start with an error.
  After each registry poll, `follow` hands every session the listed hosts and removes the ones that report `finished(now)`; a terminal guest decides there when to rejoin, so the registry reads no result from `follow`.
- `src/server/loops.ts`: the registry, rescan, usage, routine minute, notice, and activity loops, each started through `repeat`, which waits for a tick to finish before it schedules the next and logs a tick that throws, so no loop overlaps itself or dies on one failure.
  `Loops.stop` stops every loop, closes the recursive watcher, and drops a pending re-read; a file change reported after it is ignored.
- `src/server/session-files.ts`: the session files on disk, re-read file by file as the watcher reports them, and the past list.
  `src/server/interrupted.ts` keeps which dashboard sessions were interrupted.
  `src/server/views.ts` points each open view at its file and keeps its tail and media tree together for their shared lifecycle: a view nobody shows any more, or one whose file changes, has its tail and media tree closed, so a read still in flight and the tail's held-back updates publish nothing.
- `src/shared/`: every type that crosses the socket or the HTTP API, one file per domain.
  `protocol.ts` holds `ServerMsg` and `ClientMsg`; `sessions.ts` the roster and past rows (`RosterHost`, `PastSession`), views, user requests, and starts; `transcript.ts` the transcript items, changed files, and images; `github.ts` the pull request and pull request list shapes; `tickets.ts` the Linear issues; `accounts.ts` the MCP integrations and their OAuth client setups, the Google calendars, and calendar events; `git.ts` the checkouts and branches; `models.ts` the models, routing, plan usage, and omp's files; `notices.ts` the bell's notices; and `analytics.ts` the Analytics section.
  `newSessionRequest` in `sessions.ts` builds a new-session start with every option not given defaulted, for the socket's parser, the routine runner, and their tests.
  The routine shapes (`Routine`, `RoutineRun`, `RoutineChange`) live in `src/routines.ts`, which the socket messages import.
  `selectorOf` names a model as `provider/id`, which both session transports and the model picker use, and `pullRequestUrl` a pull request's GitHub page, which the server's prompts and the page's links share.
  `prompt-files.ts` holds the files a prompt carries as text: `withFiles` and `splitFiles`, which put them after the typed text and take them back off, `plainText`, which tells a text file, and the limits and body of `PUT /api/attachment/document`.
- `src/omp/`: the facades over omp's modules: `modules.ts` loads them, `install.ts` finds the package and its CLI and reads its `package.json` with `readManifest`, and `collab.ts`, `rpc.ts`, `sessions.ts`, `stats.ts`, `config.ts`, `discovery.ts`, `mcp.ts`, `models.ts`, `model-updates.ts`, `release.ts`, `prompts.ts`, and `documents.ts` wrap one area each.
- `src/analytics.ts`: folds omp-stats' per-file request rows into sessions and workspaces, joining saved-session titles and working directories without reading transcripts.
- `src/proc.ts` runs subprocesses, and `runShell` a routine's shell command, `src/json.ts` narrows untyped JSON (`isObject`, `str`, `oneOf`, `isTexts`, `errorText`), `src/fs.ts` replaces a file through a temporary one beside it and holds `JsonFile`, the load/save store behind `interrupted.json`, `todos.json`, `routines.json`, `workspaces.json`, `pins.json`, `calendars.json`, `projects.json`, and `notices.json`, whose `save` writes once per event-loop turn however many changes arrive in it, and which `flushJsonFiles` writes at once as the server stops or exits; `src/paths.ts` names these files beside the access token, and the old `google.json` the server deletes.
- `src/dashboard-session.ts`: drives one session that the dashboard started, over RPC, including serialized model changes and state refreshes.
- `src/guest.ts`: runs one Collab guest per terminal session.
  `src/subagents.ts` parses the host's subagent registry and its lifecycle and progress frames (`parseAgents`, `parseSubagentFrame`) for both transports, finds each subagent's transcript file, and lists every subagent transcript under a transcript's artifacts directory (`artifactsDir`, `subagentFiles`).
- `src/turn-gate.ts`: `TurnGate`, which both transports use to run a session's prompts, aborts, and flushes in the order the page sent them.
- `src/user-requests.ts`: parses the RPC and Collab question frames into one request shape, writes the answers back, and keeps each session's pending questions.
- `src/commands.ts`: the composer's `/` and `@` completions, and the expansion of file commands and skills before a guest prompt.
- `src/tail.ts`: reads one transcript file incrementally and feeds each entry to both folds below; `src/line-reader.ts` holds the incremental `LineReader` and the `ReadQueue` that serializes its reads, which `src/media.ts` shares.
- `src/session-entries.ts`: the vocabulary of a session file's entries, `textOf`, `oneLine`, `entryTime`, `toolCallsOf`, `toolResultOf`, `toolSummary`, and `imagesOf`, which the folds below and `src/guest.ts` read instead of walking the entry shape themselves.
- `src/transcript.ts`: folds session-file lines and live events into display items.
- `src/conversation-search.ts`: the conversation search behind `GET /api/conversations`.
  `SessionFactsIndex` folds each session's own file, not its subagents', through `foldConversationLine` as it reads it, keeping the prompts' and replies' item ids and text: `messageItemsOf` in `src/transcript.ts` names them as the pane's fold does, from one entry alone, and the tool-result lines go unparsed.
  `searchConversations` then matches those with `everyWord` and reads no file.
- `src/work.ts`: folds session-file lines into the files changed.
- `src/media.ts`: collects the images that a transcript's and its subagents' tools returned, for the `media` message.
- `src/session-facts.ts`: finds the pull requests and Linear issues each session submitted or worked on, its latest /ship step (`parseShipProgress`), and the linked worktree it works in; `SessionFactsIndex.factsOf(path)` answers them as one `SessionFacts`.
  The worktree comes from the `cwd` arguments of the session's own bash calls, not its subagents', newest first: the first one in a linked worktree of the session directory's repository, other than the checkout that directory is in, passing over directories outside that repository and stopping with none at a directory that is gone.
  `git.ts`'s `worktreeAt`, the repository's `git remote`, and the head history each answer a directory once per refresh, and every per-session step of a refresh, transcript scans and git probes alike, runs at most `PROBE_PARALLEL` (16, from `src/map-limit.ts`) at a time, so a first scan of hundreds of sessions starts no burst of git processes.
  `factsOf` answers one shared empty `SessionFacts` for a session it does not know, and a known session's own arrays, so the facts of an unchanged session stay the same objects.
  A `gt submit` call's branch is the one its `--branch` names, else `branchAt` over `git.ts`'s `headHistory` of the directory it ran in: the branch that the first checkout after the call moved from, else the one checked out now.
- `src/pull-requests.ts`: maps each workspace to its GitHub repository, reads the pull request list with one `gh api graphql` call per repository, and reads one pull request's details with one more.
  A row's `conflicts` is true when GraphQL's `mergeable` is `CONFLICTING`.
  A row and the details read `checks`, `conflicts`, and `unresolved` from the same GraphQL fields, so `readyToMerge` in `src/shared/moves.ts` takes either.
  The details also read the last 100 commits with the pull requests GitHub links each to, and keep a commit linked to none or to this one, since a branch that merged its trunk lists the trunk's commits too.
- `src/git.ts`: the git checkout of a directory, the worktree a directory is in (`worktreeAt`), the branch a worktree had checked out at a given time (`headHistory`, `branchAt`), and the worktree a new session's branch runs in.
  It also holds the git helpers that `src/worktrees.ts` shares: `git`, `canonical`, `commonDir`, and `worktreesOf`, which parses `git worktree list --porcelain -z`.
- `src/worktrees.ts`: the worktree inventory and the checks before a checkout is removed; `Worktrees.start` and `Worktrees.remove` order starts against removals; `removeCheckout` removes the linked worktree a directory is in, or returns `null` for a main checkout or a directory outside git, waiting up to 15 seconds for a session that just ended to leave it: it polls only which live sessions occupy the checkout, then runs the full preview once.
  The inventory and the snapshot of what uses the checkouts resolve each distinct directory once, and run those realpaths and the per-directory and per-repository git probes `PROBE_PARALLEL` (16) at a time.
  The inventory then reads every repository's checkouts from one queue, four at a time, with one `git rev-parse` for their identity, and `previewAll` previews several targets from one snapshot of what uses them, four at a time; `src/map-limit.ts` holds `mapLimit`, the ordered, bounded `Promise.all` they share.
- `src/text-file.ts`: reads a text file by absolute path for `GET /api/file`, within the extensions, size, and encoding that route allows, and outside the sign-in and config directories in `DENIED_DIRS`.
  `src/worktrees-shared.ts` holds the shapes the page and the routes share.
- `src/changes.ts`: the changes page's reads for `GET /api/changes` and `GET /api/changes/file`, a session's checkout diff merged with its own changed files, the last scan of each place kept for three seconds so that reading a file does not list every change again, and each session transcript folded into its changed files once, by the lines it gained since; `src/shared/changes.ts` holds the shapes the page shares, `parseFullDiff`, which numbers the rows of a whole-file diff, and `patchRows`, which fills GitHub's patch out to the whole file.
- `src/pull-request-files.ts`: the reads of a pull request's **Code** tab for `GET /api/pull-request/files` and `GET /api/pull-request/file`, from GitHub's REST API and one GraphQL blob read.
  `src/pull-request-stack.ts` reads the stack for `GET /api/pull-request/stack`.
  `src/pull-request-edit.ts` makes a change from the **Summary**'s pickers for `PUT /api/pull-request` and lists their choices for `GET /api/pull-request/options`.
- `src/tickets.ts`: the Linear side of the tickets page: the `list_issues` queries, their paging, and parsing the issues out of the tool's text, one issue in full for the main content, the options of its field pickers, and the `save_issue` call they make.
  `src/linear-uploads.ts` keeps the signed addresses of an issue's files and serves them.
  `src/mcp-clients.ts` plans a Slack or Google Calendar OAuth client save, the setup each form shows and the server entry the save writes, from omp's MCP servers that `src/omp/mcp.ts` reads and writes.
  `src/integrations.ts` finds omp's server for each MCP integration, checks it, and runs the sign-ins and sign-outs that Settings › Integrations starts; see [Integrations](#integrations).
- `src/google-calendar.ts`: `GoogleCalendarReader`, the calendars checked in your Google Calendar and the events in a span of those the Calendar page shows, read from Google's Calendar API with omp's Google Calendar sign-in.
  `src/server/calendars-file.ts` keeps the ids of the calendars unchecked in the Calendar tab's sidebar in `calendars.json` beside the access token, and moves a file it cannot read to `calendars.json.invalid`.
- `src/sign-in.ts`: `createSignIn`, the one-at-a-time sign-in with a five-minute timeout behind `src/integrations.ts`.
- `src/cache.ts`: keeps answers for a time to live, 30 seconds for the pull request list's and the tickets', so several tabs share one query; `dropWhere` forgets the keys a predicate names, which `src/commands.ts` uses when a session ends.
- `src/user-todos-shared.ts`: the Todo page's types, which the server, the page, and the extension that reads `todos.json` all follow: `UserTodoList`, `UserTodo`, `UserTodoLink`, `UserTodoChange`, and the statuses (`TODO_STATUSES`, `isClosed`), priorities (`TODO_PRIORITIES`, Linear's scale, as tickets use), and assignees (`TODO_ASSIGNEES`: `user` or `agent`).
  `templates/omp/agent/extensions/todos.ts` cannot import them, so it declares the shape it reads by hand.
- `src/user-todos.ts`: the rules of the Todo page's list, `applyUserTodo`, which the server applies to its file and the page to what it shows before the server answers, and `addTodo`, which builds an `add` with every field filled.
  The list is `UserTodoList`: categories, top-level todos, and the archive that `clear-done` fills, latest first.
  **Clear done** sends `clear-done` for the list it shows, and the server's minute tick in `src/server/dashboard.ts` sends one with `before` for every todo closed over `DONE_KEPT_HOURS` ago; the socket and the todo inbox drop a `before` they receive.
  A todo has a title, markdown notes, a status, a priority, an assignee (`null` for none), a close time (`doneAt`), a due day, and when it was added (`createdAt`, `null` for a todo from before that field); a top-level one also has a category or none, todos of its own, which share its category, links (`UserTodoLink`: a session, a pull request, or a Linear issue), and `addedBy`, the session whose agent added it.
  `set-assignee` sets or clears the assignee at either level; it records who should do the todo and starts nothing, and the todo inbox drops an assignee an agent's `add` carries.
  `doneAt` is set exactly while the status is `done` or `canceled`, which `applyUserTodo` and the parser keep true, so the desktop shell, the calendar, and the extension still read an open todo as one with no `doneAt`.
  `set-status` sets the status and, on closing, `doneAt` to its `at`; closing a top-level todo closes its open todos with the same status and time, and reopening one leaves its todos as they are.
  `set-priority` sets the priority, `move` reorders, `restore` puts back what `remove` took at its index for the page's **Undo**, and `unarchive` and `empty-archive` act on the archive.
  Every list keeps its open todos before its closed ones, at both levels: `applyUserTodo` orders the todos after each change through `inStatusOrder`, and loading the file does too.
  `moveTo` in `web/todo-views.ts` refuses a move to a place with no todo of the same status beside it, and the page adds a todo after the last one of the status it is typed in.
  `src/server/user-todos-file.ts` keeps the list in `todos.json` beside the access token.
  `src/user-todos-parse.ts` reads the list and its changes from JSON for the file, the socket, the todo inbox, and the desktop shell: a file from before any of those fields reads with none of them, a todo with no status as `done` when it has a `doneAt` and `todo` otherwise, and a change from a page or an agent is held to the length limits, a `restore` too.
  A `user-todo` socket message carries one change, and every socket hears the list after it as a `user-todos` message on the roster topic, also sent when a socket opens; a change that changes nothing sends the list back to its own socket alone.
  A `start` of kind `new` may name a `todoId`; once omp starts, `src/server/start.ts` links the todo to the new session through `StartEnv.linkTodo`, before it sends the first message, and `src/server/dashboard.ts` applies the changes `startChanges` in `src/user-todos.ts` returns: the link, and `set-status` `in-progress` for a `backlog` or `todo` todo.
- `src/shared/workspaces.ts`: the Settings › Workspaces list, `WorkspaceList` of added and hidden directories, its `WorkspaceChange`, and `applyWorkspace`, which the server applies to its file.
  `src/server/workspaces-file.ts` keeps the list in `workspaces.json` beside the access token and moves a file it cannot read, or one that holds a relative path, to `workspaces.json.invalid`.
  At startup, before either file loads, the `Dashboard` constructor calls its `adoptOldWorkspaces`, which moves `projects.json`, where an older version kept the list, to `workspaces.json` when it holds a workspace list and `workspaces.json` does not exist; a `projects.json` in any other shape stays where it is.
  The move links the new name, then unlinks the old one, so it never replaces a `workspaces.json` that a server beside it wrote, and any other failure is logged rather than stopping the server.
- `src/shared/pins.ts`: the sidebar's pins, their `PinChange`, and `applyPins`, which the server applies to its file and the page to the pins it shows before the server answers; see [Pins](#pins).
  `src/server/pins-file.ts` keeps them in `pins.json` beside the access token and moves a file it cannot read to `pins.json.invalid`.
- `src/shared/notices.ts`: the bell's `Notice`, an update (a newer omp or a `ModelUpdate`) with its `NoticeStatus`, a pull request with your move, or a Slack message, with its seen and read flags, and the socket's `NOTICE_OPS`.
  `src/server/notices.ts` checks for them and runs the updates through `src/omp/release.ts` and `src/settings.ts`; `src/omp/model-updates.ts` finds the newer models and the routing edits that switch to them, and `src/slack-messages.ts` the Slack messages that wait on you; see [Notifications](#notifications).
- `src/shared/moves.ts`: a pull request's moves, `moveOf`, which picks one from its facts and from where the running sessions on it stand (`agentOn`), and `YOUR_MOVES`, the ones that wait on you, which the Pull requests page and the bell share.
- `src/server/json-inbox.ts`: `JsonInboxDir<T>`, the directory of one-JSON-file requests that `todo-inbox.ts` and `end-inbox.ts` both read.
  Each inbox gives it a `parse` that turns a file into a request, or says why it is not one, and an `apply` that returns whether the file is done.
  A drain reads the files oldest name first, moves a file that does not parse, or whose `apply` throws, to `<name>.invalid` with a logged reason, deletes a file once `apply` returns true, and leaves one that returns false for the next drain.
  A drain lists and reads through `node:fs/promises`, so a burst of requests never blocks the event loop, reads the files it claimed at once, and applies them in name order.
  Overlapping drains never apply a file twice, a drain never rejects, `watch()` creates the directory and drains when it changes, and `stop()` closes the watcher.
  An inbox may take an `active` check; while it is false every file stays untouched, invalid ones included.
- `src/server/owner-lock.ts`: `OwnerLock`, the `server.lock` that picks the server that runs routines and the todo inbox; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
- `src/server/todo-inbox.ts`: applies the changes that omp's `user_todo` tool (`templates/omp/agent/extensions/todos.ts`) leaves in `todo-inbox/` beside `todos.json`, one JSON file each, written under a `.tmp` name then renamed, and drains only on the server that owns the lock.
  `parseAgentChange` reads each file in the extension's own format: an `add` becomes a `todo` of no priority added at that time, and a `toggle` that checks becomes `set-status` `done` at its time.
  The inbox takes `add`, and `set-status` `done`, deletes each file it applies, and moves any other to `<name>.invalid` with a logged reason, so the server stays the only writer of `todos.json` and an agent cannot undo what you did.
  The extension's `before_agent_start` handler reads `todos.json` at each prompt and adds to the system prompt the title and id of the open top-level todo that links to its session, and of each other open one whose `addedBy` is its session, so the agent checks them off once done.
  `add` returns the open todo its session already added with the same title instead of adding it again.
- `src/server/end-inbox.ts`: ends the sessions that omp's `end_session` tool (`templates/omp/agent/extensions/end-session.ts`) asks to end, one `<session id>.json` each in `end-inbox/` beside `todos.json`.
  The tool writes its request at `agent_end`, after the turn that called it, and deletes it at the next `agent_start` or `session_shutdown`, so a request names a session that idles.
  The inbox drains when the directory changes and after each registry poll, finds the live session through `LiveSessions.bySessionId`, ends it through `endSession`, the path **End session** takes, so the session is not marked interrupted and its worktree goes too, then deletes the request.
  A request is `{ v: 1, sessionId }`; `END_REQUEST_VERSION` is the version this server reads, a request without `v` reads as version 1, and one of any other version moves to `<name>.invalid`, so a later change to the request's shape has a version to key on.
  A request whose session this server does not host yet stays for a later drain, and so does one for a session started in a terminal while another server owns the lock, since every server follows those; a file that is not a request, or whose name is not its session id, moves to `<name>.invalid`.
- `src/tickets.ts` also lists the workspace's Linear teams with their keys (`loadTeams`, `GET /api/linear/teams`) and opens an issue (`createTicket`, `PUT /api/ticket/new`), assigned to the viewer unless the draft names another assignee or `null`, with any fields the draft sets, from a todo or from the new-issue dialog (`web/components/tickets/new-ticket.tsx`), which `App` opens through `openNewTicket` in the dashboard context.
  The dialog's pills are the shared `FieldPicker` and `DuePicker` from `web/components/field-picker.tsx` with `look="chip"`, and `web/components/tickets/team-select.tsx` remembers the last team used, for the dialog and the todo's team select alike.
  `attachToTicket` (`PUT /api/ticket/attachment`) attaches a file in base64 to an existing issue: Linear's `prepare_attachment_upload` signs a storage URL, the server sends the bytes there with the signed headers, then `create_attachment_from_upload` links the file to the issue.
- `src/routines.ts`: the routine types and the rules of routines: `nextRunAt`, `nextDueAt`, `isDue`, `applyRoutine`, which applies an edit, and a command's length, time, and output limits; see [Routines](#routines).
  `src/server/routines-file.ts` keeps them in `routines.json`, and `src/server/routine-runner.ts` claims their runs, starts and ends their sessions, and runs their commands.
- `src/shared/projects.ts`: the project shapes the page reads, `ProjectEdit`, and `workerPhase`; see [Projects](#projects).
  `src/server/projects-file.ts` holds the server's rules, `ProjectChange` and `applyProject`, and keeps the projects in `projects.json`, `src/server/project-runner.ts` starts the coordinators and workers through `ProjectLaunch`, follows their sessions, and delivers the workers' updates, `src/server/project-tools.ts` holds the coordinator's host tools and the update message, and `src/server/project-notes.ts` seeds and lists a project's notes for `GET /api/project-notes`.
  `templates/omp/agent/extensions/projects.ts` is the omp extension that tells a project's session its role and keeps the coordinator's edits to the notes.
- `src/pull-request-actions.ts`: the pull request actions, which pull requests each applies to and its prompt, which the Pull requests page's quick actions use.
- `src/usage.ts`: runs `omp usage --json` and parses it into plan windows.
- `src/system-load.ts`: reads the machine's CPU percent, available memory, and free disk space for `GET /api/system`; `src/shared/system.ts` holds the shape the page shares.
- `src/settings.ts`: builds the settings page's model routing and file list, and checks and saves its edits.
  An edit it refuses throws its `Rejected`, which `src/server/routes.ts` answers with the error's status.
- `src/test-env.ts`: points `PI_CODING_AGENT_DIR` at a temporary directory.
  `bunfig.toml` preloads it for tests, so they never touch `~/.omp/agent`.

The page lives in `web/`.
`src/server/page.ts` bundles `web/index.html` and `web/main.tsx` with `Bun.build`, and `bun-plugin-tailwind` compiles Tailwind v4:

- `web/app.tsx`: the page shell.
  It builds the two dashboard contexts and lays out the sidebars, the page, the command palette, and the dialogs, and leaves each slice of state to a hook of its own.
  `web/use-workspace-scope.ts` holds the visible sessions, the workspaces, the selected workspace, which localStorage keeps, and its pull request poll.
  `web/use-focused-session.ts` holds the focused pane's session, the document title, and the sidebar following a `/move`.
  `web/use-session-lists.ts` holds the Sessions tab's lists and search, and pins and unpins through the server's pins, and `web/use-sidebar-tab.ts` the tab and `showTab`.
  `web/use-overlays.ts` holds the shortcuts dialog, the command palette, the file dialog, and the new-ticket dialog.
  `web/use-transcript-display.ts` holds how transcripts show tool calls and thinking, and `web/use-page-shortcuts.ts` the page-wide shortcuts and the commands the palette runs.
  `web/components/app-sidebar.tsx` wires the roster to the page, `web/components/page-switch.tsx` picks the page or the panes, and `web/components/pane-grid.tsx` lays out the panes.
  `#pull-requests` alone shows the Pull requests page, and the sidebar's Pull requests tab then lists its sections.
- `web/use-dashboard.ts`: the socket, the page state, and the URL hash.
  One exhaustive switch in the socket's `onmessage` sends each server message to the pane store or the reducer, and the hash is read once into a `Route` (a page, a `#session/<id>` link, or the panes).
  `web/starts.ts` holds the sessions the page is starting, whether new, forked, resumed, resumed all at once, or started by a quick action on a pull request, a Linear issue, or a todo, which runs in the background.
  `request` resolves or rejects on `done`, and rejects every outstanding request when the socket closes without replaying it.
  Ending sessions stay in a separate set until their requests settle, even if they have already left the roster.
- `web/use-action.ts`: guards a control against repeated activation, exposes its pending state, and shows failures through the toast manager.
- `web/pane-store.ts`: each open view's transcript, changed files, images, and completions, outside the page state.
  A component reads one field through a selector hook (`useTranscript`, `useChangedFiles`, `useMedia`, `useComposerData`, `useTurnCount`, …), built on `useSelect` in `web/keyed-store.ts`, which `web/polled-store.ts` shares, one snapshot and subscription per key, and renders again only when that field changes, so a streamed token renders the transcript and what reads `items`, and not the pane, the composer, or the details.
  `toBlocks` in `web/transcript-view.ts` keeps the blocks that a token leaves alone as the same objects, and the transcript's rows are memoized on them.
  It and the page state apply the server's list updates, the roster's and the past sessions', through `applyDelta` in `web/keyed-list.ts`, which keeps every entry an update leaves alone as the same object.
- `web/dashboard-state.ts`: the page state and its reducer, which `web/use-dashboard.ts` runs.
- `web/routing.ts`, `web/sessions.ts`, `web/labels.ts`, `web/pull-requests-model.ts`, `web/tickets-model.ts`, `web/routines-model.ts`, `web/calendar-model.ts`, and `web/transcript-view.ts`, and `web/document-title.ts` (the tab and window title): the pure transforms from server messages to what the page renders, and the hash routes.
  `src/shared/every-word.ts` holds `everyWord` and `searchWords`, the one search rule the sidebar's sessions, the Files tab, the Todo page, the model search, the `@` menu, the command palette's todos, tickets, and pull requests, and the server's conversation search share: every word typed, in any order and any case.
- `web/changes-model.ts`: the changes page's explorer tree, the diff's folded runs, and the file view's gutter marks; `web/code-highlight.ts` cuts `lowlight`'s syntax colors into lines.
- `web/file-paths.ts`: which paths in agent text name a text file, and the absolute path each resolves to.
  `web/delimited.ts` parses a TSV or CSV file into rows.
  `web/components/file-link.tsx` holds the link that opens such a path, and `web/components/file-dialog.tsx` the dialog that shows the file.
  That dialog and the Files tab's dialog of a file's changes share `ViewerDialog` from `web/components/viewer-dialog.tsx`: the header with its actions and close button, and the body that takes focus and scrolls.
  `sessionsOn` in `web/sessions.ts` picks the running sessions that work on a pull request or an issue, which the Pull requests page and the tickets page show.
  `web/pull-requests-model.ts` holds the pull requests' moves in one table, `MOVES`, with each move's verb, its section, and the quick action that makes it, over `moveOf` in `src/shared/moves.ts`.
  It also holds which sections start folded, sorts rows by move and keeps each stack's rows together by the chain of base branches, and says what the details' Status shows.
  `PullRequestOrder` there is the order you chose, the repositories, the sections, the sort, and the manual order of pull requests, which `placedManual` updates after a drop; a stack moves as one `unit`.
  `web/routines-model.ts` words a routine's schedule, task, next run, and last run, and turns the routine editor's form into the routine it saves.
  `web/calendar-model.ts` lays a month's routine runs, past and planned, its due todos and tickets, and Google events out by day.
  `web/days.ts` names a local day as todos, tickets, and the calendar do, `YYYY-MM-DD`, and walks the days between two of them.
- `web/page-icons.ts`: the icon of each dashboard page, which its sidebar tab and every link into the page show.
  `web/routing.ts` owns the sidebar tab vocabulary, the settings sections, and the page/hash routes; `web/components/workspace-picker.tsx` owns the directory picker and the workspace rows it shares with the sidebar's workspace picker.
- `web/components/settings/settings-nav.tsx`: the Settings sidebar's links, one per section of `SETTINGS_SECTIONS` in `web/routing.ts`, grouped by scope into **General** and **This workspace**.
  The open section is in the hash, `#settings/<section>/<encoded cwd>`; `settings-page.tsx` keeps inactive panels mounted to preserve unsaved drafts, and shows the workspace picker on the **This workspace** sections only.
  `preferences-tab.tsx` holds the dashboard's browser-local choices, and `routing-tab.tsx` the Models section: roles, model chains, provider order, and retries.
  `workspaces-tab.tsx` lists the workspaces with **Hide**, the hidden ones with **Show**, and adds a directory by path through `PUT /api/workspaces`; the list it shows comes back as the `workspaces` socket message.
- `web/components/settings/analytics-tab.tsx`: the Settings section for request usage, including time-range buttons, a token chart, breakdowns, and the top sessions; it polls only while it shows.
  `provider-trend.tsx` renders the stacked provider chart and bucket-data table; `analytics-format.ts` shares number and cost formatting across the section.
- `web/model-menu.ts`: what the model menu derives from the model list and plan usage, the context variants of a model, a provider's quota for the account with the most left, and the search's word match.
  The menu itself is `web/components/model-picker.tsx`, built on the submenu, switch, and radio rows of `web/components/ui/menu.tsx`; `Plans` in `web/components/plan-usage.tsx` hands it the last `omp usage` run.
- `web/mentions.ts`: the composer's `@` menu as a pure function of the draft, the `@` token, the page's lists, and omp's file completions: its categories and their references, the query a token asks, and the rows and sections it shows.
  `web/completion-trigger.ts` reads the token and its prefix from the draft, and `useCompletion` in `web/components/completion-popup.tsx` builds the menu and asks the server only for files.
  `useSearchSources` in `web/reads.ts` gives the menu and the command palette the tickets, polled only while asked for, and the sidebar workspace's pull requests.
- `web/prompt-tokens.ts`: the references a prompt carries as text, which the composer and the transcript draw as chips, read back from what the `/` completion and the `@` menu insert; `remarkPromptChips` marks them in a sent prompt for `MessageMarkdown`.
  `web/components/prompt-chip.tsx` draws one chip, and `web/components/prompt-editor.tsx` is the composer's text field, a Lexical editor whose chips are atomic nodes over the prompt's text, so the draft stays a string.
- `web/components/status-bar.tsx`: the window's bottom strip, with `PlanUsageList` from `web/components/plan-usage.tsx` on the left, and on the right the **Terminal** button and the machine's CPU, available memory, and free disk space from `GET /api/system`.
- `web/components/terminal/terminal-panel.tsx`: the terminal panel under the panes, its tabs, height, and open state, `useTerminalPanel`, which saves the last two in localStorage, and the restore from `GET /api/terminals`.
  `terminal-view.tsx` draws one tab with xterm.js over its `/ws/terminal` socket, fits it to the panel, follows the page's theme, and passes the toggle chord, and every Cmd chord on macOS, to the page's shortcuts.
  `terminal-socket.ts` sends its commands and retains a kill requested while the socket connects, sending it when the socket opens.
- `web/quick-actions.ts`: the quick actions of the Pull requests page, the tickets page, and the open todo, which pull requests, issues, and todos each applies to, and the start, with its prompt, that runs it; the pull request actions themselves come from `src/pull-request-actions.ts`.
  Tickets and todos share the **Work on it** and **Plan it** labels and descriptions in `WORK_ACTIONS`, and each keeps its own rules, which of its items an action applies to and the prompt it sends.
  `startTarget` turns what a quick start works on into the `subject` or `todoId` its `start` message carries, and `quickOn` picks the quick start that works on an item, whose failure that item's details show.
  `web/components/quick-actions.tsx` holds their row menu, the buttons on a pull request's, an issue's, or a todo's details, and the note that says why a start failed.
  `web/components/session-chip.tsx` holds the chip that names a session on a row or in the details, with the status dot of a running one.
- `web/api.ts`: the page's HTTP client, `errorText`, which says what any failure was, and `socketUrl`, the address of the dashboard's and a terminal's WebSocket, `wss:` when the page is on HTTPS.
  `settingsUrl` names a settings route for one workspace, or for the user's own files.
- `web/reads.ts`: the server reads that components hold.
  `useRead` reads one URL, such as the pull request or the Linear issue the main content shows, the settings page's model catalog, or the new-session draft's model list.
  A version change retains the last answer and exposes `refreshing` until the new read settles, including a failed read.
  A URL change never returns the previous URL's answer.
  `useReplaceableRead` shows the version a save answered until that URL is read again.
  The polled stores, made by `web/polled-store.ts`, are shared by a sidebar list and its page, kept in localStorage, and re-read every minute while the page is open: one for the pull requests, with one entry per workspace, one for the tickets, with one entry, since Linear is not per workspace, one for the MCP integrations, one for the Google calendars shown, and one for the Calendar page's Google events, with one entry per month.
  A read in flight belongs to its entry: a new read of an entry replaces only the read of that entry in flight, and the components that poll one entry share one timer, which starts with the first and stops with the last.
  Its `update` applies a saved change to the current answer and aborts older reads before they can replace that answer.
  `web/app.tsx` polls the pull requests instead, on every page once the sessions are listed, for the Pull requests tab's count, and the sidebar's pull request list reads that entry.
  The composer's `@` menu reads the pull request entry that `pullRequestsScope` in the status context names, the one `web/app.tsx` polls, so it starts no poll of its own and never reads the all-workspaces entry, which asks GitHub about every repository, in place of the selected workspace's.
  `web/components/tickets/ticket-fields.tsx` holds the issue detail's field pickers and sends their changes through `useQueuedSave` from `web/use-queued-save.ts`, which shows a change at once and sends each after the ones before it; the picker button and its searchable list, and the due date's, live in `web/components/field-picker.tsx`, which the Todo page and a pull request's details share, with an open state its owner can hold so a key opens it, and digits that pick a choice.
- `web/use-git-checkout.ts`: reads a directory's git checkout for the new-session draft's branch picker.
  `web/components/git.tsx` holds the branch picker, the repository and branch in a header's meta line, and `BranchName`, the branch that copies itself on click, which the pull requests and tickets also show.
  `web/use-copy.ts` copies text to the clipboard and holds the copied state behind a button's check mark.
  `web/use-default-model.ts` reads the model that the `default` role names, which the draft's model picker shows until a pick.
  `web/use-skills.ts` reads a directory's skills, and `web/pinned-skill.ts` keeps the skill pinned for new sessions.
  `web/components/skill-picker.tsx` is the skill picker that the settings' pinned skill and the routine editor share.
  The checkout, the default model, and the skills are each one `useRead`.
- `web/shortcuts.ts`: the keyboard shortcut table, which both the key listeners and the shortcut dialog read.
  One `keydown` listener on the window serves every `useShortcuts` registration, which `createShortcutStack` orders: the registration that mounted last tries a key first, and the first handler that takes it ends the press, so a page's own bindings come before `web/use-page-shortcuts.ts`'s, which `web/app.tsx` mounts first, and a handler that returns `false` lets the key fall to the one below.
  Shortcuts with a `command` title are also the command palette's commands, and `web/app.tsx` hands the palette the same handlers it registers.
- `web/command-palette.ts`: the command palette's model, which renders nothing: its items and their actions, the reducer over its stack of views and its action panel, and the ranking, which multiplies cmdk's match score by a frecency boost kept in localStorage.
  `SECTIONS` there says how each section lists: always, only for a search or under Suggestions with every word required, as the todos, tickets, and pull requests do, in the server's order after those, as the conversation matches do, or after every match, as what the search becomes; `web/palette-records.ts` builds the records' and the matches' items, each opening the page that shows it, a todo through the `?open=` of its list's hash.
  `useConversationHits` in `web/reads.ts` asks `GET /api/conversations` through `useRead` once typing pauses for 200 ms; `highlightOnFound` moves the highlight from what the search becomes to the first item when the matches arrive.
  A match opens its session through `web/message-reveal.ts`, a `keyedStore` by view, which the pane's `Transcript` reads to scroll once to the message after the transcript has loaded.
  `web/components/command-palette/` draws it, opened from the sidebar header or with Cmd+K: the dialog and its list, the action panel that Cmd+K opens on the highlighted entry, and the footer.
  It mounts only while open, so a closed palette builds no list and polls nothing; it asks for the Linear tickets while Linear answers.
  `web/session-actions.ts` lists what can be done to a session, which both a sidebar row's menu and the palette offer.
- `web/theme.ts`: the light, dark, or system theme, which `web/main.tsx` applies before the first render and the settings page changes.
- `web/scroll-fade.ts`: sets the `.scroll-fade` edge opacities from JS in browsers without scroll-driven animations, such as Firefox, which `web/main.tsx` starts before the first render; elsewhere `web/globals.css` drives them with scroll timelines.
- `web/stored-state.ts`: `useStoredState`, a value kept in localStorage that removes its default rather than store it, which holds the theme, the sidebars, the split ratios, the session details tab, the sidebar's workspace, the pinned skill, the pull request list's order, and how often and how lately each command palette entry ran; and `useStoredKeys`, a set of keys on top of it, which holds the sessions pinned in the sidebar and the Pull requests and tickets pages' folded sections.
  Every component that holds the same key sees a change at once, so the Pull requests page and its sidebar index share their folds and order.
  A component keeps one key for as long as it is mounted.
  `sidebarSessions` in `web/sessions.ts` splits the sessions into the sidebar's project groups and its pinned, running, interrupted, and past lists, which the page also walks for the previous and next session keys; a project's sessions leave the other lists, and it lists them even under `/tmp`.
  `projectSession` there finds a project's session in the live or past list with its view, phase, and directory, for the sidebar's groups and the Projects page alike, and `waitsOnYou` tells a live session that waits on you, for the waiting count and each project's group.
  `discoverableSessions` leaves sessions under `/tmp` out of those lists and the workspace picker, and `workspaceSwitch` keeps a started session's workspace only when that directory is discoverable.
- `web/components/roster.tsx`: the left sidebar's tabs, its tickets list, and the workspace picker; `web/components/pull-requests/pull-requests-nav.tsx` is its Pull requests tab, and `web/components/section-link.tsx` the section link that the tickets list and the Pull requests page's section index share.
  `web/components/session-list.tsx` is its Sessions tab, which lists the first 100 past sessions until you ask for more, and `web/components/project-group.tsx` the group of one project in it, each worker's row named by the title its coordinator gave it.
  `web/components/sidebar-search.tsx` is the search field that the Sessions tab and the right sidebar's Files tab share.
  `web/components/session-row.tsx` holds `PastRow` and `HostRow`, memoized on the row's session, so a roster push or a search keystroke renders only the rows it changed; the row's menu items read the dashboard contexts only once the menu opens, and their ages count up on the page's one minute timer.
  `web/components/todo/categories.tsx` holds its Todo tab: **All**, **Today**, **Needs you**, **From agents**, **Archive**, then the categories, and `web/components/calendar/calendar-nav.tsx` its Calendar tab: the calendar, the Google calendars under **My calendars** and **Other calendars**, each a checkbox that shows or hides its events, and then the routines by name.
- `web/components/toaster.tsx`: `toasts`, the page's one Base UI toast manager, which shows a toast from anywhere without rendering its caller again, and `Toaster`, which `web/main.tsx` mounts at the bottom right.
  `web/components/notices.tsx` holds `NoticesBell`, the roster header's bell, its source filters, and its list, and `useNoticeToasts`, which `web/app.tsx` calls so a notice no page has shown toasts once, even with the sidebar hidden.
- `web/components/todo/`: the Todo page.
  `page.tsx` is the page and its lists, **Archive** included, which `LIST_KINDS` marks read-only: its rows put a todo back or delete it for good, and its header offers **Empty** where the others offer **Clear done**.
  Every other list groups its top-level todos by status, in `STATUS_GROUPS` order, under fold headers whose folds `useFolds` keeps; `split.tsx` puts the list on the left and the open todo's `detail.tsx` on the right, at a list width stored in localStorage.
  `row.tsx` holds a todo's row, with its priority and status buttons, category badge, work-state dot, due day and assignee buttons, link icons, and the day it was added, an archived todo's row, and the row of a todo not added yet; `fields.tsx` holds the status, priority, assignee, and due day pickers, as a row's icon or a labeled property button, and `input.tsx` the input a title is typed into, whose Cmd+Enter starts a session from the todo.
  As icons, the priority, assignee, and due day pickers show nothing while their field is unset, or for a closed todo's due day, until their key opens them, so a row and a sub-todo follow the same rule.
  `editing.ts` holds `useTodoEditing`, which of those inputs is open, the status a new todo takes, and what its keys do, and deleting with its **Undo** toast; `search.tsx` is the search field.
  `detail.tsx` is the open todo: a bar with its place, its status, and the ↑, ↓, and **×** buttons, its title, its property pickers, and notes, which `web/components/notes-editor.tsx` shows formatted and edits in place, then for a top-level todo its sub-todos, an agent card with the work state, live agent question, the **Work on it** and **Plan it** quick actions, and **Start session**, its links with **Create Linear ticket**, and when it was added and by which session.
  `links.tsx` draws a todo's link chips and work-state pill, each with an icon-only form for rows, and `add-button.tsx` is the button that adds a todo linking to a pull request row or a ticket row.
  `notes-editor.tsx` is a Lexical rich-text editor; `web/markdown-notes.ts` holds its nodes and markdown shortcuts, turns its document into the notes' markdown and back, and decides when its text saves.
  `web/todo-views.ts` holds `LIST_KINDS`, what each list is called and lets you do, which todos it holds, `TODO_STATUS`, each status's label and the Linear state type whose icon it takes, each category's badge color, how a due day reads, and the `move` and `restore` the page sends; `web/use-todo-drag.ts` and `web/use-todo-keys.ts` drag and move rows, and the keys also step the open todo and open its pickers.
  `web/todo-work-state.ts` derives the pill and the **Needs you** filter from the latest linked session's live status, outstanding question, submitted pull request, or recorded `/ship` merge; it keeps unknown and ended sessions distinct from new ideas.
  `web/todo-quick-add.ts` reads a trailing due day and `#category` off a new todo's title, in the page's new todos and in the command palette's **Create todo**.
- `web/components/routines/routines-page.tsx`: the Routines page, its list with each routine's menu, and one routine's settings and runs, which open the sessions they started.
  It, the Calendar page, and the session rows read the time through `web/use-minute.ts`, one timer renewed each minute for every component that reads it.
  The session rows, the pull request rows, and the bell's notices show how long ago something was with `Age` from `web/components/age.tsx`, which words it with `age` from `web/labels.ts` and counts up on that timer.
  `web/components/routines/routine-editor.tsx` is the form that makes or edits a routine, with the new-session draft's `DirectoryPicker` for its workspace.
- `web/components/projects/projects-page.tsx`: the Projects page, its list, its **New project** form at `#projects/new`, which sends `project-create` with the model and effort, and one project's page: its coordinator, its workers with their phases and last replies, its waiting updates, and its notes from `GET /api/project-notes`, which open in the file dialog, with **Rename** and **Archive**.
- `web/components/calendar/calendar-page.tsx`: the Calendar page, a month of `web/calendar-model.ts` entries and the chosen day's list beside it, including Google events read with `web/reads.ts`.
  It draws the month's grid and each day's hover card itself, and takes the month and year menus and arrows from Kibo UI's calendar, `web/components/kibo-ui/calendar/index.tsx`, whose month and year live in jotai atoms, so the page keeps its month while you leave and come back.
- `web/components/pane.tsx`: a pane, whose view renders inside a `RenderBoundary` from `web/components/render-boundary.tsx`, so a view that throws shows its error in that pane and the rest of the page stays; `web/app.tsx` puts one around the page too, and both clear when the hash names another view.
  `conversation.tsx` holds the live composer, `conversation-header.tsx` its header with the End session button, `past-conversation.tsx` a past session's view, and `transcript.tsx` the transcript, whose `task` rows link to their subagents.
  `subject.ts` is `subjectOf`, the one place that tells a session from a subagent and derives what the composer may do; `model-slot.tsx` is the model and thinking switch, and `session-meta.tsx` a session header's trail and pull request menu.
  `composer.tsx` holds `blockedShortcut`, `ComposerNote`, and `EmptyConversation`, which the new-session draft and the pages share, and `page-header.tsx` the `Header` every page uses.
  `composer-queue.tsx` holds the queued rows and `useQueue`, and `composer-suggestions.tsx` the suggested prompts and their keys; `InputMessage` renders them through its `beforeEditor` and `afterActions` slots.
  `user-request.tsx` shows the open question above the composer through `question-card.tsx`.
  `prompt-attachments.tsx` holds the composer's attached files, which the new-session draft shares: it reads each as an image, as text, or as a document omp converts, and sends a prompt's text files after its text and its images apart.
- `web/components/dashboard-context.tsx`: two contexts that `App` provides and the sidebar, the panes, and the pages read instead of taking props: the actions (`send`, `open`, `start`, `end`, …), which keep one identity for the page's life, and the status, which holds the connection, the last start of each kind, and `pullRequestsScope`; a component that reads only the actions never renders for a change of the status.
  `MentionListsContext` carries the lists of the composer's `@` menu apart from both.
- `web/components/session-details.tsx`: the right sidebar's tabs for the focused pane: `outline-tab.tsx`, its turns from `outline` in `web/transcript-view.ts`, which scroll the focused pane's transcript to their prompt or reply and mark the turn its scroll is on; `files-tab.tsx`, the files its agent changed, with a search over their paths, each opening omp's recorded diffs in a dialog, with a link to the session's changes page; `media-tab.tsx`, its images and their viewer; and `session-pull-requests-tab.tsx`, its session's pull requests.
  Each pull request shows through `PullRequestDetails` from `web/components/pull-requests/pr-page.tsx`, whose `session` lists the others under the **Stack** and whose `onPick` shows another pull request of the stack or the session in place of changing the address.
- `web/components/changes/`: the changes page, `changes-page.tsx`, with its explorer and editor, `changes-explorer.tsx`, which a pull request's **Code** tab shows too, the explorer's tree, `file-tree.tsx`, and its Diff and File views, `code-view.tsx`.
  `web/components/line-counts.tsx` draws the lines added and removed, `+12 −3`, that the changes page and the Files tab share.
- `web/components/pull-requests/`, `web/components/tickets/`, `web/components/settings/`, `web/components/integrations/`, and `web/components/new-session.tsx`: the other pages.
  `web/components/integrations/` holds the integration rows that the Settings page's Integrations section, `web/components/settings/integrations-tab.tsx`, sorts into **Connected** and **Available**: `mcp-integration.tsx` is an MCP integration's row, which the tickets page also shows while Linear is not connected, and takes what shows below it as children, such as the calendars `google-calendar.tsx` lists under Google Calendar's row.
  Rows lay out through `integration-row.tsx` and draw their brand marks from `brand-logos.tsx`; `mcp-integration.tsx` starts its sign-ins with `web/use-sign-in.ts`, and its `SignOutConfirm` asks before a sign-out and shows its failure.
  `slack-app-form.tsx` holds Slack's confidential-app setup, field errors, and scope selection, `google-calendar.tsx` Google Calendar's OAuth client form, and `client-form.tsx` the steps, fields, and outside links both forms share; the generic MCP row owns its connection and sign-in controls.
  `web/components/more-actions-menu.tsx` is the ⋯ menu of a row's rarer actions, which the integration rows and the Routines page share.
  `web/components/pull-requests/pull-requests-board.tsx` holds `usePullRequestsBoard`, the logic that the sidebar list and the page share: its sections, folds, order, drag, keys, and rows, with the sort menu and the keys line.
  It lays the board out only when the pull request list, its order, or its folds change, and fills in each row's drag, sessions, pending start, and open menu in a second pass; the sessions come from one pass over the roster, `sessionsByPullRequest` in `pr-row.tsx`, and the board keeps a pull request's list the same array while its chips hold, so a memoized row draws again only when what it shows changes.
  Only one board mounts at a time, since its rows carry document ids and its keys are global, so `pull-requests-page.tsx` shows the table while the sidebar shows `PullRequestsIndex`, its sections as links, and `pull-requests-nav.tsx` lists the pull requests in the sidebar otherwise.
  `pr-page.tsx` shows one pull request's details in the main content, in a frame of its own that lets the **Code** tab fill the height under the header.
  Its `PullRequestDetails` shows the same details, with the same quick actions, on the page and in the session details sidebar; its `placement` decides whether it says why the Pull requests page does not list the pull request, and `PullRequestDetailContent` in `pr-details/index.tsx` takes it too, for the heading's level and size, whether it takes focus, whether the header and tab bar stick to the top of the sidebar's scroll, and whether **Code** shows the explorer or a list of files.
  `PullRequestDetailContent` reads the pull request and its stack, and lays out the header, the tab bar, and the **Summary**, **Timeline**, and **Code** tabs; on the page, **Code** is the route's `files`, so choosing it changes the address and the board's keys leave ↓ and ↑ to the explorer.
  The rest of `pr-details/` holds one part each: `header.tsx` the header with the Next move's button, the `⋯` menu, and the checkout command; `summary.tsx` the **Summary**; `stack.tsx` its **Stack** and the session's other pull requests; `checks.tsx` the checks at a glance on the tab bar and their popover; `code.tsx` the **Code** tab; and `status-view.ts` how the **Summary**'s Status says each fact and which quick action each one offers.
  `pr-fields.tsx` holds the **Summary**'s state, reviewers, and labels pickers, and `pr-files-dialog.tsx` the dialog in which the sidebar's file list opens the explorer, whose `onPick` opens another file in place of changing the address.
  `pr-timeline.tsx` is the **Timeline**: commits, comments, reviews, and unresolved threads in one list by day, with the **New** line from the last visit it keeps in localStorage.
  `pr-row.tsx` draws the sidebar row and the table row, and exports the DOM lookups of a row and its link that the board's keys use.
  `web/use-drag-order.ts` drags the pull request list's repositories, sections, and pull requests, each within its own scope, and draws the drop line.
  The tickets and Pull requests pages use `web/components/list-page.tsx` for their frame, header, and load and refresh states, its issue details use its `DetailPage`, and the Todo, Routines, and Calendar pages its `PageFrame`.
  Both details views use `web/components/sheet-details.tsx` for the sections, links, and comments of those details.
  `LoadNote` is the loading or error line that the pull request's details, the issue's, and the list page share.
  `web/components/fold.tsx` holds the fold button that the Pull requests and tickets pages share, `useFolds`, which keeps in localStorage the sections you flipped from their default fold, and `useReveal`, which unfolds a section or a row and scrolls to it once that element is in the document; `web/section.ts` names such a section target.
  The Pull requests page binds ↓, ↑, O, E, and `.` through `useShortcuts`, over the pull requests that `shownPullRequests` in `web/pull-requests-model.ts` lists in order, so a folded section's rows drop out, and binds Alt+Shift+↑ and ↓ to move the focused heading or row by its `data-move` attribute.
- `web/components/ui`, `web/lib`, and `web/hooks`: files from the Fluid registry, and `web/components/kibo-ui` from Kibo UI's; `web/components/ui/PATCHES.md` lists every change the dashboard makes to them.
  The sidebar's parts are split over `sidebar.tsx`, `sidebar-core.tsx`, `sidebar-group.tsx`, `sidebar-slot.tsx`, `sidebar-menu.tsx`, `sidebar-menu-scope.tsx`, and `sidebar-menu-row.ts`, and the composer's over `input-message.tsx`, `file-preview-tile.tsx`, `web/hooks/use-region-height.ts`, and `web/hooks/use-is-touch.ts`.

`templates/omp/` holds the omp starter kit and its installer, `templates/omp/install.ts` (`bun run omp-template`).
Its `agent/` files are the default kit.
`maintainer/` is the maintainer git profile, `AGENTS.md` and `docs/git-workflow.md`, copied only when you pass `--maintainer`, and a file there replaces the `agent/` file with the same path.
[Template sync](../CODING_STANDARDS.md#template-sync) says how to copy an edited live file back.
The default `agent/AGENTS.md` keeps worktree and force-push safety inline and links to the model and review references under `agent/docs/`.
The profile's `docs/git-workflow.md` detects Graphite with `git rev-parse --path-format=absolute --git-common-dir`, so the same procedure works from a checkout, a linked worktree, or a nested directory.
The repository's agent guide links to the [coding standards](../CODING_STANDARDS.md), which every contributor follows, and to [agent smoke checks](agent-smoke.md) for server authentication and lifecycle, browser verification, and desktop verification.

`desktop/` holds the desktop shell; see [Desktop shell](#desktop-shell).
`desktop/main.ts` is its whole main process but for Open at Login, in `desktop/login-item.ts`, and `bun run desktop` at the root installs the package and starts it through `desktop/launch.ts`.
On macOS the launcher clones `node_modules/electron/dist/Electron.app` to `desktop/dist/omp agents.app`, sets its `CFBundleName`, `CFBundleDisplayName`, and `CFBundleIdentifier`, gives it an `.icns` that it renders from `icon.png` with `sips` and `iconutil`, signs it ad hoc, and runs that copy, because the Dock, the menu bar, and Cmd+Tab read an app's name and icon from its bundle.
It rebuilds the copy when Electron's version or `icon.png` changes.
`desktop/icon.svg` is the app icon, the logo mark on a macOS-style tile, and `desktop/icon.png` is that SVG rendered at 1024 px, because Electron reads no SVG; render it again after you change the SVG.
The page's favicon, `web/favicon.svg`, is the bare mark.

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
