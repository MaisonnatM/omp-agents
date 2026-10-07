# How omp-agents works

The server's design, its protocols, and its HTTP API.
For installation, see the [README](../README.md); for the interface, see [Using omp-agents](usage.md).

## omp modules

The server imports omp's own modules from the installed package, so it does not reimplement a protocol, the encryption, or the session-file format, and it always speaks the same version as the sessions it shows.
`src/omp/modules.ts` loads every module once and checks at startup that each export this app uses exists, naming the omp version and the missing export when one does not.
It finds the package through `omp` on `PATH`, or `OMP_PACKAGE_DIR` when set; with a Bun global install that is `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

Paths in this document that start with `pi-coding-agent/`, `pi-ai/`, `pi-tui/`, `pi-utils/`, or `omp-stats/` are inside that install, in `@oh-my-pi/`.
They are not in this repository.
The main ones:

- Collab: `pi-coding-agent/src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`.
- Session files: `pi-coding-agent/src/session/session-listing.ts` and `session-loader.ts`.
  `appendCustomMessageEntry` in `pi-coding-agent/src/session/session-manager.ts` gives a `custom_message` entry the timestamp of the message it records, which `#persistMessageEnd` in `agent-session.ts` passes.
- Interrupted turns: `pi-coding-agent/src/session/exit-diagnostics.ts` (`createInterruptedTurnAbortMessage`), which `endsMidTurn` in `src/omp/sessions.ts` uses to refuse forking a session that ended mid-turn.
- Images: `pi-coding-agent/src/session/blob-store.ts`, which moves a prompt's image out of the session file into `blob:sha256:<hash>`, and `getBlobsDir` in `pi-utils/src/dirs.ts`; `src/transcript.ts` and the `/api/image` route read them.
- RPC: `pi-coding-agent/src/modes/rpc/rpc-client.ts`, `rpc-frame.ts`, and the frame types in `rpc-types.ts`.
  `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of the child's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](#dashboard-sessions).
  `get_available_models` returns omp's whole `Model` objects, with `name`, `contextWindow`, `api`, `identity`, and `serviceTiers`; `get_state` adds `fastModeEnabled` and `fastModeActive`, and `setFastMode` sends `set_fast_mode`.
- Service tiers: `serviceTierFamily` and `shouldSendServiceTier` in `pi-ai/src/types.ts`, which `fastAvailable` in `src/omp/models.ts` calls to decide, as `setFastMode` in `pi-coding-agent/src/session/model-controls.ts` does, whether `/fast` can turn on for the live model.
- Settings and discovery: `pi-coding-agent/src/config/settings.ts`, `pi-coding-agent/src/discovery/index.ts`, and `pi-coding-agent/src/task/discovery.ts`.
- Credentials: `pi-coding-agent/src/session/auth-broker-config.ts` (`discoverAuthStorage`) and `pi-ai/src/registry/oauth/index.ts` (`getOAuthProviders`).
  `connectedProviders` in `src/omp/models.ts` keeps the `/login` providers that have a credential, as omp's RPC `get_login_providers` marks them `authenticated`.
  It opens the credential store on each call and closes it, so a login in a terminal counts at the next call.
- Model roles: `pi-coding-agent/src/config/model-resolver.ts` (`expandRoleAlias`, `resolveRoleChain`), whose `@role` aliases `resolveRoles` in `src/omp/models.ts` follows for `GET /api/models/roles`.
  `modelEntries` reads each role and fallback selector with `parseRetryFallbackSelector` and maps it to a listed model with `resolveProviderModelReference`, which follows retired variant ids such as `grok-4.7-high` and dotted spellings such as `claude-fable-5.1`.
- MCP: `pi-coding-agent/src/mcp/json-rpc.ts` (`callMCP`), `config.ts` (`loadAllMCPConfigs`), `oauth-credentials.ts` (`removeManagedMcpOAuthCredentials`), `oauth-discovery.ts` (`discoverOAuthEndpoints`), `oauth-flow.ts` (`MCPOAuthFlow`), and `config-writer.ts` (`addMCPServer`), which `src/omp/mcp.ts` wraps for the tickets page and the Integrations page.
  The MCP sign-ins and sign-outs read and write omp's credential store through the same `discoverAuthStorage`, opened and closed on each call.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory.
- Request usage: `omp-stats/src/aggregator.ts` (`getDashboardStats`, `getToolDashboardStats`, `getTimeRangeConfig`), `rollup.ts` (`getProviderTimeSeries`), `live.ts` (`statsLive`), and `db.ts` (`initDb`).
  `src/omp/stats.ts` reads omp-stats' database and starts its live sync only after the Settings page's Analytics section first reads it.

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
- Whenever the list changes, the server also scans for pull requests in each session file whose modification time changed, plus the subagent files in its artifacts directory.
  Like an open transcript, each file reads only the bytes appended since its last scan.
  The first scan reads every session file, 16 sessions at a time.
  On 641 MB across 464 sessions it takes under a second, and the sidebar shows before it finishes.
  A session that names a PR by number alone costs one `git remote get-url origin` in its working directory.
  A subagent's appends do not change the session file, so its pull requests show once the session writes again, at the latest when it receives the subagent's result.
- The same scan collects the Linear issues each session worked on, by identifier, from the arguments of its Linear MCP calls: a direct `mcp__linear_<tool>` call or a `write` to `xd://mcp__linear_<tool>`, whose `content` holds the arguments as JSON.
  `get_issue` and `save_issue` name the issue in `id`, `list_comments` and `save_comment` in `issueId`; a `save_issue` with no `id` opens one, whose identifier its result's JSON `id` names.
  A UUID is left out, since the tickets page opens an issue by identifier.
  The `/ship` state's `issue` counts too.
  Session rows carry them as `tickets`, the session's own first.
- Each inbox answer tells the server which branch heads which pull request in that repository.
  The server then links each session whose `git push` updated one of those branches to that PR, and sends the sidebar the new links.

## Terminal sessions

Sessions started in a terminal are reached through their Collab room:

- Every 1.5 seconds the server lists the local hosts through the registry, and pushes the roster when a row or the registry error changed; the past list goes out again only when a session joined or left.
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
The composer's queue is omp's `queue_update` event, and taking a message back is `remove_queued_message`.
A session runs its prompts, aborts, and `flush` requests one at a time, in the order the page sent them (`TurnGate` in `src/turn-gate.ts`), because the socket handlers do not wait for each other.
When an abort follows, omp drops a prompt it has read but not yet run, so an abort that got ahead of a steer would lose it.
Enter on the empty composer sends `flush`, and the session aborts only if omp's queue, read with `get_state` at that moment, still holds a steer; omp then runs that steer as its next turn.
A steer that has left the queue is already in the turn, recorded or streamed into the response, and an abort then would cut off the reply to it, so neither the page's lagging copy of the queue nor omp's terminal rule, which also counts such a steer, decides.
A guest keeps the same order for its `prompt`, `abort`, and `flush` frames, because it expands a prompt before it sends it.
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
The dashboard serializes model, effort, and fast-mode setters with state reads in a separate `TurnGate` from turn commands.
Event-driven refreshes coalesce while queued, so a read cannot overwrite a later switch, and switching stays visible until every queued model change has finished.

A `prompt` message, and a `start` of kind `new`, carry `images`, each `{ data, mimeType }` with the file's bytes in base64, as omp's `ImageContent` takes them.
`src/server/wire.ts` accepts PNG, JPEG, GIF, and WebP, up to `MAX_PROMPT_IMAGE_BYTES` (32 MB) per prompt, and a prompt of images with no text.
The socket's `maxPayloadLength` is 64 MB so such a message fits.
A dashboard session passes the images to omp's RPC `prompt`; a terminal session's guest puts them on its Collab `prompt` frame, a held follow-up included.
omp's `steer_subagent` and Collab's `agent-cmd` `chat` take text only, so a subagent's prompt with images is refused.
omp writes a prompt's images inline into the session file and then moves each to its blob store, `~/.omp/agent/blobs/<sha256>`, leaving `blob:sha256:<hash>` in the file.
A user item's `images` holds a `data:` URL for an inline image and `/api/image?hash=<sha256>&type=<image type>` for a moved one; that route serves the blob file as `type`, which must be one of the four prompt image types, since the store keeps none.

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

## Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI.
omp builds those reports from its auth storage, extensions, and credential broker, so the server reads the command's output instead of rebuilding that setup.
omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code.
When the output is not a usage report, the footer shows the last line omp wrote to stderr.

## Analytics

omp-stats owns the request history in `~/.omp/stats.db`, under omp's config root.
`src/omp/stats.ts` starts `statsLive()` on the first Analytics read; it syncs every session transcript, watches for changes, and resyncs every five minutes until the server stops it on shutdown.
The dashboard calls omp-stats' aggregate and tool reads for the selected range, then groups request rows by session file for the top sessions.
`src/analytics.ts` folds nested subagent and advisor files into their top-level session, assigns the session's working directory from the saved-session index, and orders models, projects, and sessions by token usage.
`src/omp/stats.ts` reads time buckets by recorded provider through omp-stats' rollup-aware `getProviderTimeSeries`, using the same source as the totals cards.
`src/analytics.ts` derives chart totals and provider totals from those rows, fills missing buckets with zeros, and starts all time at the first request.
`web/components/settings/provider-trend.tsx` renders Recharts stacked bars, bucket details, and an optional data table from that provider breakdown.
The displayed cost is omp's API-equivalent list price, not the user's subscription bill.

## Routines

A routine starts dashboard sessions, or runs a shell command, on one or more schedules. A schedule is every so many minutes, counted from the last run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST. The routine is due at the earliest of them. Two intervals share that last run, so the shorter one decides.
Its task is one prompt or one command.
The prompt ends with `UNATTENDED`, which tells the session not to ask questions.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops a routine whose task was pull requests.
The rest of the file stays.
The next save writes `schedules`.
A file that is not a list of routines still moves aside.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, and one `outcome`: `pending` from its claim, with whether it is still `queued`; a `session` with the instance and session ids it started; or a `command` with the command's result once it ran.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, a started session a `session` (the first, of the several that a pull request routine's run started), and otherwise `pending`, queued when its `queued` is set or its `queue` list holds an entry.
A run stays queued from its claim until the drain starts its session or command.

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected.
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
   A session counts as working from the first time its row shows it working or waiting on a question, at its start, at a tick, or at any change of its row, which the server passes to `observe`.
   `observe` also ends a session as soon as its row shows the turn over, so a finished session frees its slot at once rather than at the next tick.
   Its transcript stays a past session, and **Resume** continues it.
   A session that waits on a question holds its slot.

Running a tick twice starts nothing new, since the slot is claimed, and a tick that comes while one runs is skipped.
A crash after a claim loses no queued run, since it is on disk. A start that had not finished waits for the routine's next slot.
After a restart the runner tracks no session, which is right, because the dashboard's sessions die with the server.
Stopping the server stops every running command, right before it exits, so the result of a command it stopped is never saved as a time-limit stop.
A run saves its command as `running` before the command starts, then as `exited`, `stopped`, or `failed` when it ends.
No command resumes after a restart: the next server turns each run still saved as `running` into `stopped` by the dashboard, with that error.

A `routine` socket message carries one change: `save`, `remove`, `enable`, or `run-now`, which claims a slot now, whatever the schedules, and drains it.
Every socket hears the routines after each change and each step of a run as a `routines` message on the roster topic, also sent when a socket opens.

## HTTP API

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace.
The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`).
It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk.
Each file carries the SHA-256 of its text.
`GET /api/models` runs `omp models --json` for the pickers.

`GET /api/analytics?range=<range>` answers `Analytics` from omp-stats, defaulting to `7d`.
The accepted ranges are `24h`, `7d`, `30d`, `90d`, and `all`; an unknown range returns 400.
The answer includes totals, time buckets with per-provider usage, provider totals, models, projects, agent types, tools, the 20 sessions with the most tokens, and live indexing status.

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

`PUT /api/pull-request/sessions` takes `{ owner, repo, number, sessionIds }`, the link button's request.
The server refuses a session that did not submit or work on that pull request by the rules in [Pull requests and the inbox](usage.md#pull-requests-and-the-inbox).
It reads the description with `gh api repos/<owner>/<repo>/pulls/<number>`, puts the session block in it, and writes it back with `gh api --method PATCH` only when the text changed.
The answer is `{ changed }`, or `{ error }` with the HTTP status.

`GET /api/git?cwd=<directory>` answers the git checkout that the directory is in, or `null` outside one: the GitHub repository that `origin` names, the checked-out branch, every local branch with the worktree that has it checked out, and the main worktree.

`GET /api/git/status?cwd=<directory>` answers the status bar's view of the checkout the directory is in, or `null` outside one: its top directory, the checked-out branch (`null` while HEAD is detached), the upstream with the commits ahead and behind, and each uncommitted file with its kind, from `git status --porcelain=v2 --branch -z --untracked-files=all`.
`PUT /api/git/switch` takes `{ cwd, choice }`, an existing branch or a new one with its base as a start's `branch` does, runs `git switch --no-guess` in the checkout `cwd` is in, and answers its new status.
It answers 409 while a live session whose status is `working` or `needs-input` works in that checkout (`RouteEnv.busyDirs`), and with git's message when git refuses, as for a branch another worktree has checked out.

`GET /api/file?path=<absolute path>` answers a text file for the page's file dialog: `{ path, text, size, truncated }`.
The path is absolute or starts with `~/`; the page resolves a relative one against the session's directory first.
The file's real path, after symlinks, must end in one of `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot reach a key file.
It reads the first `MAX_TEXT_FILE_BYTES` (1 MB) and answers 415 when those bytes are not UTF-8.
It runs `git worktree list --porcelain -z`, `git for-each-ref`, and `git symbolic-ref` on each call, and reads `origin` through the inbox's cached lookup.
Like a new session's `start`, `cwd` may name any directory.
The new-session draft reads it for its branch picker, and a live session's header reads it when it opens and when a turn starts or ends.
`GET /api/changes?session=<session id>` answers a session's [changes page](usage.md#session-changes) list, `SessionChanges` in `src/shared/changes.ts`, or 404 for a session it does not know.
It reads the session's checkout from its worktree, else its directory: `git diff --name-status` and `--numstat` against the merge base of `HEAD` with `origin/HEAD`, else against `HEAD`, else against the empty tree before the first commit, and `git ls-files --others --exclude-standard` for untracked files.
It folds the session's transcript with `Work` for the files its own `edit` and `write` calls changed, keeping each transcript's fold while its size and modification time stay the same, and lists those git does not name after git's.
`GET /api/changes/file?session=<session id>&path=<path>` answers one file of that list in full, `ChangedFileText`, with every line of `git diff --histogram` as numbered rows, or a note for a binary file or one over `MAX_CHANGED_FILE_BYTES` (1 MB).
It computes the list again and answers 404 for a path the list does not hold, so it reads no file the session and its checkout did not change, and passes the path with `--literal-pathspecs`, so a name such as `app/[id]/page.tsx` is not a glob.
While the changes page of a live session shows, the page watches that session's view, so its `work` messages reach the page, which reads both routes again whenever the session's changes grow.
`GET /api/worktrees` lists the worktrees of every repository a session ran in, or of `?cwd=` when that directory is in a repository.
Each row names the registered path, branch, lock, whether the directory is missing, the newest session file there, and why removal is refused.
`GET /api/worktrees/metrics?repository=&path=` reads approximate allocated disk use, the last commit time, and the modified and untracked counts for one registered checkout.
`PUT /api/worktrees/removal` previews a removal or performs one whose confirmation still matches that preview.
Removal uses `git worktree remove` without `--force`, so Git keeps the branch and still refuses a dirty or locked checkout.
A missing directory is removed the same way, which drops only that registration.
A start that creates a branch's worktree and registers its session excludes a removal, and so does a removal that has begun: a removal waits for the starts under way, reads the live and saved sessions once, then checks and removes each confirmed checkout in turn.
Starts that create no worktree, such as a resume or a routine's session, stay parallel and wait only while a removal runs.

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

A `start` of kind `new` carries a `subject`, `null` for none: a quick action sends the pull request or Linear issue it works on.
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
The token stays in memory for five minutes and is dropped when Linear answers 401, which the page reports as a hint to reconnect Linear on the Integrations page or run `/mcp reauth <name>`; it is never logged.
Linear's GraphQL API refuses that token, so the server calls the MCP endpoint's `list_issues` tool through omp's `callMCP`, a stateless JSON-RPC `tools/call` POST.
It asks for each open state type in full, following the cursor, and for completed, canceled, and duplicate issues updated in the last seven days, in parallel, then drops repeats by identifier.
`list_issues` and `get_issue` name an issue's labels without their colors, so the server reads each team's labels with `list_issue_labels`, by the team key that prefixes the identifier, and keeps them for five minutes; `?fresh` reads them again too.

`GET /api/ticket?id=<identifier>`, such as `?id=ENG-2368`, answers the tickets page's main content with that issue in full: the row's fields, the assignee, the team's id, the description, who opened it and when, the links Linear attaches to it, and its comment threads.
The server calls `get_issue` and `list_comments` in parallel, through the same MCP sign-in, with no cache, so each opening reads the issue again.
It rewrites Linear's `<issue>` mentions as markdown links, its `<linear-image>` tags as image links, its `<linear-embed node-type="video">` tags as `<video>` elements, and other `<linear-embed>` tags as links.
It threads the comments by `parentId`, oldest first.
An identifier that is not a team key, a dash, and a number answers 400.

Linear hands out its files as `uploads.linear.app` addresses whose `signature` JWT expires five minutes after the read.
`loadTicketDetail` reads the raw texts of `get_issue` and `list_comments`, and `rememberUploads` in `src/linear-uploads.ts` keeps the latest signed address of each upload path found in them, in memory.
`linearMarkdown` is a pure text rewrite: it turns each upload address in the description and comments into `GET /api/ticket/media?issue=<identifier>&path=<upload path>`.
That route fetches the kept address, passing the `Range` header on, and streams Linear's answer back with its type, length, range, and validators.
When the kept address is within 30 seconds of expiring, missing after a restart, or refused by Linear, the route reads the issue again and remembers its uploads anew, which signs every file in it; requests for one issue within 10 seconds share that read.
Only paths that a read of the issue named are fetched, so the route reaches nothing but Linear's own uploads.
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

`MCP_SERVICES` in `src/shared/accounts.ts` holds the services whose MCP server the **Integrations** page signs omp in to, keyed by the ids in `MCP_INTEGRATIONS`; Linear is the only one so far.
Each names its label, the host omp's server for the service is on, and the name and URL of the server a sign-in adds when omp has none.
`src/integrations.ts` keeps a sign-in per service, and the page adds each service's brand mark and what it gives.

`GET /api/integrations` answers `{ integrations }`, one `McpIntegration`, `{ id, connection, signIn }`, under each service's id.
`connection` is `absent` while omp's user-level MCP config has no enabled server on the service's host, and `signed-out` while omp's credential store, read again on each call, holds no OAuth sign-in for it.
Otherwise `checkMcpServer` in `src/omp/mcp.ts` lists the server's tools with `tools/list`, following `nextCursor`, through the same token as the tickets' calls.
`connectionOf` in `src/integrations.ts` turns the outcome into `ready` with the tool names, `refused` when the server throws `McpRefused` on a 401 that asks for a new sign-in, or `failing` with any other error.
The server keeps each list for a minute and never a failure; `?fresh` lists again, and a sign-in, a sign-out, or a 401 on a tickets call drops it.
While a service's sign-in waits on the browser, its connection is the one last answered, without listing the tools again.
The page shows the **Tickets** tab while Linear's connection is `ready`, `refused`, or `failing`, and keeps the last read in localStorage.
The dashboard calls Linear only while its connection is `ready` or `failing`: the tickets page shows Linear's integration row instead of the issues otherwise, and the Todo page's **Create Linear ticket** and the Calendar's tickets wait on it too.

`PUT /api/integrations/sign-in`, with `{ id }`, starts a sign-in the way omp's `/mcp reauth` does: it reads the service's OAuth endpoints from its metadata, registers a client, and starts omp's `MCPOAuthFlow`, whose callback server listens on `localhost:3000`.
It answers the integration once the flow has the service's authorization address, as `signIn: { phase: "waiting", url }`, which the page opens in a new tab.
When the browser comes back, the server stores the tokens, refresh material included, under the server's credential id, where `omp token` finds them, and adds the service's server, such as `"linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }`, to omp's `mcp.json` when omp had none.
A new sign-in abandons the one under way.
A failure, or no return within five minutes, shows as `signIn: { phase: "failed", error }` until the next sign-in.
`createSignIn` in `src/sign-in.ts` holds that state for every MCP integration.

`PUT /api/integrations/sign-out`, with `{ id }`, abandons a sign-in under way and removes the sign-ins omp manages for the server, as omp's `/mcp unauth` does: omp's `removeManagedMcpOAuthCredentials` removes them under the server's credential id and the ids it files a sign-in for the URL under.
`mcp.json` keeps the server and, unlike `/mcp unauth`, its `auth` block.
A sign-in that omp does not manage stays, and the route answers an error that says so.
`parseIntegrationId` in `src/server/wire.ts` checks both bodies.

### Google Calendar

`src/google-calendar.ts` reads Google calendars through their secret addresses in iCal format, with no Google sign-in and separate from omp's MCP sign-ins.
`PUT /api/google/calendars`, with `{ url }`, takes only an address under `https://calendar.google.com/calendar/ical/`, reads it once, and adds the calendar when the answer parses as a `VCALENDAR`; a failed read answers 400 with the reason and adds nothing.
Each added calendar takes the feed's `X-WR-CALNAME` as its name, else the address's email, and the next unused color of Google's event palette.
The addresses stay in `google.json` beside the access token, with owner-only file permissions, and never reach the page: `GET /api/google` answers each calendar's id, a hash of its address, with its name, color, and the error of its last read.
A `google.json` that holds anything else, such as the OAuth client secret and refresh token an older version kept, is replaced with an empty list when the server starts.
`PUT /api/google/calendars/remove`, with `{ id }`, forgets one.
`GET /api/calendar/events?from=<ISO time>&to=<ISO time>` reads at most 62 days and reads each feed at most once a minute, unless `fresh` asks again.
`ical.js` expands each repeating event into its repeats in the event's own time zone, from the feed's `VTIMEZONE`s, with Google's removed (`EXDATE`) and moved (`RECURRENCE-ID`) repeats applied; a repeat's id ends with its original start.
Canceled events, events the address's owner declined, and events with no length are left out, and iCal's exclusive all-day end becomes the last included day.
One calendar that cannot be read keeps its error for the Integrations row while the others still answer; only when none can is the answer an error.
An event links to its day in Google Calendar, since the feed carries no link to the event.
The Calendar page reads the open month's events through `calendarEventsStore` in `web/reads.ts` every minute while a calendar is added, and puts a multi-day event on each day it covers.

## Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Inbox**, **Tickets**, **Sessions**, **Todo**, **Calendar**, and **Settings** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
User and assistant turns use `chat-message`, tool calls use `thinking-steps`, and the composer uses `input-message`.
`thinking-indicator` shows while the agent works.
shadcn's `message-scroller` follows streaming content, preserves the reader's scroll position, and supplies the jump-to-latest button.
The model, thinking, and project pickers use shadcn's `popover` and `command` combobox pattern, and the Calendar page's day cards shadcn's `hover-card`.
Fluid's built-in sidebar rail resizes by pointer only and collapses on click.
The dashboard turns it off and uses `web/components/sidebar-panel.tsx`, which gives each sidebar its own width and open state, because Fluid's provider holds only one of each.
Sidebar widths and the split between panes share `web/components/drag-separator.tsx`: `useDragSeparator` owns the pointer capture, arrow keys, and double-click reset, and `Separator` is the element.
Each call site still clamps its own domain, pixels for a sidebar and a ratio for a split.

The sidebar rows' menus use Base UI's `ContextMenu` for right-click and its `Menu` for the **⋯** button, wrapped in `web/components/ui/menu.tsx` with the look of the `popover` and `command` items.
Both share Base UI's menu items, so each row builds one item list and both menus render it.
The wrapper also opens the context menu on the context-menu key and Shift+F10 at the focused row, because not every platform sends a `contextmenu` event for them.

Questions use Fluid's `ask-user-questions`, installed from `https://www.fluidfunctionalism.com/r/radix/ask-user-questions.json`, in `web/components/user-request.tsx`.
Each question is one Fluid question with one row per omp option.
A confirm is a question with **Yes** and **No** rows, and an input or an editor is a free-text question.

## Code layout

The server lives in `src/`:

- `src/server.ts`: the entry point.
  Builds the page, loads the access token, starts the HTTP and WebSocket server, watches the sessions directory, and wires the modules below together.
  `PORT` sets the port, 4317 by default.
- `src/server/http.ts`: the request checks (`Host`, `Origin`, `Sec-Fetch-Site`, the token cookie) and the JSON answer helpers.
  `src/server/auth.ts` keeps the token file and parses the cookie, `src/server/address.ts` names the port, host, and listening line that the desktop shell shares, and `src/server/page.ts` bundles `web/index.html` in memory and serves it only to a signed-in browser.
- `src/server/routes.ts`: the `/api/` endpoints.
  `src/server/wire.ts` parses every socket message and request body into typed values.
- `src/server/socket.ts`: handles each socket message.
  `src/server/start.ts` starts, forks, and resumes dashboard sessions for the page's `start` and `resume-all` requests.
- `src/server/live-sessions.ts`: the one registry of running sessions, terminal and dashboard alike, each behind the `LiveSession` interface in `src/live-session.ts`.
  Each session's `row()` returns a `LiveRow`, what its transport knows; `rows()` adds `cwdDisplay`, the session's facts, and the subject a quick action started it on, to make the roster rows.
- `src/server/session-files.ts`: the session files on disk, re-read file by file as the watcher reports them, and the past list.
  `src/server/interrupted.ts` keeps which dashboard sessions were interrupted.
  `src/server/views.ts` points each open view at its file and keeps its tail and media tree together for their shared lifecycle.
- `src/shared/`: every type that crosses the socket or the HTTP API, one file per domain.
  `protocol.ts` holds `ServerMsg` and `ClientMsg`; `sessions.ts` the roster and past rows (`RosterHost`, `PastSession`), views, user requests, and starts; `transcript.ts` the transcript items, changed files, and images; `github.ts` the pull request and inbox shapes; `tickets.ts` the Linear issues; `accounts.ts` the MCP integrations, the Google calendars, and calendar events; `git.ts` the checkouts and branches; `models.ts` the models, routing, plan usage, and omp's files; and `analytics.ts` the Analytics section.
  The routine shapes (`Routine`, `RoutineRun`, `RoutineChange`) live in `src/routines.ts`, which the socket messages import.
  `selectorOf` names a model as `provider/id`, which both session transports and the model picker use, and `pullRequestUrl` a pull request's GitHub page, which the server's prompts and the page's links share.
- `src/omp/`: the facades over omp's modules: `modules.ts` loads them, `install.ts` finds the package and its CLI, and `collab.ts`, `rpc.ts`, `sessions.ts`, `stats.ts`, `config.ts`, `discovery.ts`, `mcp.ts`, `models.ts`, and `prompts.ts` wrap one area each.
- `src/analytics.ts`: folds omp-stats' per-file request rows into sessions and projects, joining saved-session titles and working directories without reading transcripts.
- `src/proc.ts` runs subprocesses, and `runShell` a routine's shell command, `src/json.ts` narrows untyped JSON (`isObject`, `str`, `oneOf`, `isTexts`, `errorText`), `src/fs.ts` replaces a file through a temporary one beside it and holds `JsonFile`, the load/save store behind `interrupted.json`, `todos.json`, `routines.json`, and the private `google.json`; `src/paths.ts` names these files beside the access token.
- `src/dashboard-session.ts`: drives one session that the dashboard started, over RPC, including serialized model changes and state refreshes.
- `src/guest.ts`: runs one Collab guest per terminal session.
  `src/subagents.ts` parses the host's subagent registry and its lifecycle and progress frames (`parseAgents`, `parseSubagentFrame`) for both transports, finds each subagent's transcript file, and lists every subagent transcript under a transcript's artifacts directory (`artifactsDir`, `subagentFiles`).
- `src/turn-gate.ts`: `TurnGate`, which both transports use to run a session's prompts, aborts, and flushes in the order the page sent them.
- `src/user-requests.ts`: parses the RPC and Collab question frames into one request shape, writes the answers back, and keeps each session's pending questions.
- `src/commands.ts`: the composer's `/` and `@` completions, and the expansion of file commands and skills before a guest prompt.
- `src/tail.ts`: reads one transcript file incrementally and feeds each entry to both folds below; `src/line-reader.ts` holds the incremental `LineReader` and the `ReadQueue` that serializes its reads, which `src/media.ts` shares.
- `src/session-entries.ts`: the vocabulary of a session file's entries, `textOf`, `oneLine`, `entryTime`, `toolCallsOf`, `toolResultOf`, `toolSummary`, and `imagesOf`, which the folds below and `src/guest.ts` read instead of walking the entry shape themselves.
- `src/transcript.ts`: folds session-file lines and live events into display items.
- `src/work.ts`: folds session-file lines into the files changed.
- `src/media.ts`: collects the images that a transcript's and its subagents' tools returned, for the `media` message.
- `src/session-facts.ts`: finds the pull requests and Linear issues each session submitted or worked on, its latest /ship step (`parseShipProgress`), and the linked worktree it works in; `SessionFactsIndex.factsOf(path)` answers them as one `SessionFacts`.
  The worktree comes from the `cwd` arguments of the session's own bash calls, not its subagents', newest first: the first one in a linked worktree of the session directory's repository, other than the checkout that directory is in, passing over directories outside that repository and stopping with none at a directory that is gone.
  `git.ts`'s `worktreeAt` answers each directory once per refresh.
- `src/session-links.ts`: writes the session block into a pull request's description.
- `src/inbox.ts`: maps each workspace to its GitHub repository, reads the inbox's pull requests with one `gh api graphql` call per repository, and reads one pull request's details with one more.
  A row's `conflicts` is true when GraphQL's `mergeable` is `CONFLICTING`.
  A row and the details read `checks`, `conflicts`, and `unresolved` from the same GraphQL fields, so `MergeFacts` in `web/inbox-model.ts` takes either.
- `src/git.ts`: the git checkout of a directory, the worktree a directory is in (`worktreeAt`), the worktree a new session's branch runs in, and the status bar's status (`gitStatus`) and in-place branch switch (`switchBranch`).
  It also holds the git helpers that `src/worktrees.ts` shares: `git`, `canonical`, `commonDir`, and `worktreesOf`, which parses `git worktree list --porcelain -z`.
- `src/worktrees.ts`: the worktree inventory and the checks before a checkout is removed; `Worktrees.start` and `Worktrees.remove` order starts against removals; `removeCheckout` removes the checkout a directory is in, waiting up to 15 seconds for a session that just ended to leave it.
- `src/text-file.ts`: reads a text file by absolute path for `GET /api/file`, within the extensions, size, and encoding that route allows.
  `src/worktrees-shared.ts` holds the shapes the page and the routes share.
- `src/changes.ts`: the changes page's reads for `GET /api/changes` and `GET /api/changes/file`, a session's checkout diff merged with its own changed files; `src/shared/changes.ts` holds the shapes the page shares and `parseFullDiff`, which numbers the rows of a whole-file diff.
- `src/tickets.ts`: the Linear side of the tickets page: the `list_issues` queries, their paging, and parsing the issues out of the tool's text, one issue in full for the main content, the options of its field pickers, and the `save_issue` call they make.
  `src/linear-uploads.ts` keeps the signed addresses of an issue's files and serves them.
  `src/integrations.ts` finds omp's server for each MCP integration, checks it, and runs the sign-ins and sign-outs that the Integrations page starts; see [Integrations](#integrations).
- `src/google-calendar.ts`: the Google calendars added by their iCal addresses, their private file, and the month-range events their feeds expand to.
- `src/sign-in.ts`: `createSignIn`, the one-at-a-time sign-in with a five-minute timeout behind `src/integrations.ts`.
- `src/cache.ts`: keeps answers for a time to live, 30 seconds for the inbox's and the tickets', so several tabs share one query; `dropWhere` forgets the keys a predicate names, which `src/commands.ts` uses when a session ends.
- `src/user-todos-shared.ts`: the Todo page's types, which the server, the page, and the extension that reads `todos.json` all follow: `UserTodoList`, `UserTodo`, `UserTodoLink`, and `UserTodoChange`.
  `templates/omp/agent/extensions/todos.ts` cannot import them, so it declares the shape it reads by hand.
- `src/user-todos.ts`: the rules of the Todo page's list, `applyUserTodo`, which the server applies to its file and the page to what it shows before the server answers, and `addTodo`, which builds an `add` with every field filled.
  The list is `UserTodoList`: categories, top-level todos, and the archive that `clear-done` fills, latest first.
  **Clear done** sends `clear-done` for the list it shows, and the server's minute tick in `src/server.ts` sends one with `before` for every todo checked over `DONE_KEPT_HOURS` ago; the socket and the todo inbox drop a `before` they receive.
  A todo has a title, markdown notes, a check time (`doneAt`), and a due day; a top-level one also has a category or none, todos of its own, which share its category, links (`UserTodoLink`: a session, a pull request, or a Linear issue), and `addedBy`, the session whose agent added it.
  `move` reorders, `restore` puts back what `remove` took at its index for the page's **Undo**, and `unarchive` and `empty-archive` act on the archive.
  Every list keeps its todos to do before its checked ones, at both levels: `applyUserTodo` orders the todos after each change through `inStatusOrder`, and loading the file does too.
  `moveTo` in `web/todo-views.ts` refuses a move among the todos of the other status, and the page adds a todo after the last one to do.
  `src/server/user-todos-file.ts` keeps the list in `todos.json` beside the access token.
  `src/user-todos-parse.ts` reads the list and its changes from JSON for the file, the socket, the todo inbox, and the desktop shell: a file from before any of those fields reads with none of them, and a change from a page or an agent is held to the length limits, a `restore` too.
  A `user-todo` socket message carries one change, and every socket hears the list after it as a `user-todos` message on the roster topic, also sent when a socket opens; a change that changes nothing sends the list back to its own socket alone.
  A `start` of kind `new` may name a `todoId`; once omp starts, `src/server/start.ts` links the todo to the new session through `StartEnv.linkTodo`, before it sends the first message.
- `src/server/todo-inbox.ts`: applies the changes that omp's `user_todo` tool (`templates/omp/agent/extensions/todos.ts`) leaves in `todo-inbox/` beside `todos.json`, one JSON file each, written under a `.tmp` name then renamed.
  It takes `add`, and `toggle` that checks, deletes each file it applies, and moves any other to `<name>.invalid` with a logged reason, so the server stays the only writer of `todos.json` and an agent cannot undo what you did.
  The extension's `before_agent_start` handler reads `todos.json` at each prompt and, when an open top-level todo links to its session, adds that todo's title and id to the system prompt, so the agent checks it off once it finishes the work.
- `src/server/end-inbox.ts`: ends the sessions that omp's `end_session` tool (`templates/omp/agent/extensions/end-session.ts`) asks to end, one `<session id>.json` each in `end-inbox/` beside `todos.json`.
  The tool writes its request at `agent_end`, after the turn that called it, and deletes it at the next `agent_start` or `session_shutdown`, so a request names a session that idles.
  The inbox drains when the directory changes and after each registry poll, finds the live session through `LiveSessions.bySessionId`, deletes the request, and calls `end()`, the path **End session** takes, so the session is not marked interrupted.
  A request whose session the server does not follow yet stays for a later drain, and a file that is not a request, or whose name is not its session id, moves to `<name>.invalid`.
  With `removeWorktree`, it then calls `Worktrees.removeCheckout` on the session's worktree from `SessionFacts`, else its cwd, and a checkout that stays adds a todo naming the blockers.
- `src/tickets.ts` also lists the workspace's Linear teams (`loadTeams`, `GET /api/linear/teams`) and opens an issue from a todo (`createTicket`, `PUT /api/ticket/new`), assigned to the viewer.
- `src/routines.ts`: the routine types and the rules of routines: `nextRunAt`, `nextDueAt`, `isDue`, `applyRoutine`, which applies an edit, and a command's length, time, and output limits; see [Routines](#routines).
  `src/server/routines-file.ts` keeps them in `routines.json`, and `src/server/routine-runner.ts` claims their runs, starts and ends their sessions, and runs their commands.
- `src/pull-request-actions.ts`: the pull request actions, which pull requests each applies to and its prompt, which the inbox's quick actions use.
- `src/usage.ts`: runs `omp usage --json` and parses it into plan windows.
- `src/settings.ts`: builds the settings page's model routing and file list, and checks and saves its edits.
  An edit it refuses throws its `Rejected`, which `src/server/routes.ts` answers with the error's status.
- `src/test-env.ts`: points `PI_CODING_AGENT_DIR` at a temporary directory.
  `bunfig.toml` preloads it for tests, so they never touch `~/.omp/agent`.

The page lives in `web/`.
`src/server/page.ts` bundles `web/index.html` and `web/main.tsx` with `Bun.build`, and `bun-plugin-tailwind` compiles Tailwind v4:

- `web/app.tsx`: the page shell, which holds the sidebars, the pane grid, the routes for a pull request's details, tickets, todo, calendar, routines, settings, and new-session pages, and focus handling.
  `#inbox` alone shows the inbox page, and the sidebar's Inbox tab then lists its sections.
- `web/use-dashboard.ts`: the socket, the page state, and the URL hash.
  One exhaustive switch in the socket's `onmessage` sends each server message to the pane store or the reducer, and the hash is read once into a `Route` (a page, a `#session/<id>` link, or the panes).
  `web/starts.ts` holds the sessions the page is starting, whether new, forked, resumed, resumed all at once, or started by a quick action on a pull request or a Linear issue, which runs in the background.
- `web/pane-store.ts`: each open view's transcript, changed files, images, and completions, outside the page state, so a token in one pane re-renders only that pane.
  It and `web/polled-store.ts` share `web/keyed-store.ts`, one snapshot and subscription per key.
  It and the page state apply the server's list updates through `applyDelta` in `web/keyed-list.ts`, which keeps every entry an update leaves alone as the same object.
- `web/dashboard-state.ts`: the page state and its reducer, which `web/use-dashboard.ts` runs.
- `web/routing.ts`, `web/sessions.ts`, `web/labels.ts`, `web/inbox-model.ts`, `web/tickets-model.ts`, `web/routines-model.ts`, `web/calendar-model.ts`, and `web/transcript-view.ts`, and `web/document-title.ts` (the tab and window title): the pure transforms from server messages to what the page renders, and the hash routes.
- `web/changes-model.ts`: the changes page's explorer tree, the diff's folded runs, and the file view's gutter marks; `web/code-highlight.ts` cuts `lowlight`'s syntax colors into lines.
- `web/file-paths.ts`: which paths in agent text name a text file, and the absolute path each resolves to.
  `web/delimited.ts` parses a TSV or CSV file into rows.
  `web/components/file-link.tsx` holds the link that opens such a path, and `web/components/file-dialog.tsx` the dialog that shows the file.
  `sessionsOn` in `web/sessions.ts` picks the running sessions that work on a pull request or an issue, which the inbox and the tickets page show.
  `web/inbox-model.ts` holds the inbox's moves in one table, `MOVES`, with each move's verb, its section, and the quick action that makes it; `moveOf` picks a pull request's move from its facts and from where the running sessions on it stand, through `agentOn`.
  It also holds which sections start folded, sorts rows by move and keeps each stack's rows together by the chain of base branches, and says what the details' Status shows.
  `InboxOrder` there is the order you chose, the repositories, the sections, the sort, and the manual order of pull requests, which `placedManual` updates after a drop; a stack moves as one `unit`.
  `web/routines-model.ts` words a routine's schedule, task, next run, and last run, and turns the routine editor's form into the routine it saves.
  `web/calendar-model.ts` lays a month's routine runs, past and planned, its due todos and tickets, and Google events out by day.
  `web/days.ts` names a local day as todos, tickets, and the calendar do, `YYYY-MM-DD`, and walks the days between two of them.
- `web/page-icons.ts`: the icon of each dashboard page, which its sidebar tab and every link into the page show.
  `web/routing.ts` owns the sidebar tab vocabulary and the page/hash routes; `web/components/workspace-picker.tsx` owns the directory picker and the workspace rows it shares with the sidebar's project picker.
- `web/components/settings/settings-nav.tsx`: the Settings sidebar's section buttons and the registry shared with `settings-page.tsx`.
  `web/app.tsx` holds the selected section for both; the page keeps inactive panels mounted to preserve unsaved drafts.
- `web/components/settings/analytics-tab.tsx`: the Settings section for request usage, including time-range buttons, a token chart, breakdowns, and the top sessions; it polls only while it shows.
  `provider-trend.tsx` renders the stacked provider chart and bucket-data table; `analytics-format.ts` shares number and cost formatting across the section.
- `web/model-menu.ts`: what the model menu derives from the model list and plan usage, the context variants of a model, a provider's quota for the account with the most left, and the search's word match.
  The menu itself is `web/components/model-picker.tsx`, built on the submenu, switch, and radio rows of `web/components/ui/menu.tsx`; `Plans` in `web/components/plan-usage.tsx` hands it the last `omp usage` run.
- `web/components/status-bar.tsx`: the window's bottom strip, with `PlanUsageList` from `web/components/plan-usage.tsx` on the left and the focused session's checkout on the right: its branch switcher, upstream counts, and uncommitted files.
- `web/quick-actions.ts`: the quick actions of the inbox and the tickets page, which pull requests and issues each applies to, and the start, with its prompt, that runs it; the pull request actions themselves come from `src/pull-request-actions.ts`.
  `web/components/quick-actions.tsx` holds their row menu, the buttons on a pull request's or an issue's details, and the note that says why a start failed.
  `web/components/session-chip.tsx` holds the chip that names a session on a row or in the details, with the status dot of a running one.
- `web/api.ts`: the page's HTTP client, and `errorText`, which says what any failure was.
  `settingsUrl` names a settings route for one workspace, or for the user's own files.
- `web/reads.ts`: the server reads that components hold.
  `useRead` reads one URL, such as the pull request or the Linear issue the main content shows, the settings page's model catalog, or the new-session draft's model list.
  `useReplaceableRead` shows the version a save answered until that URL is read again.
  The polled stores, made by `web/polled-store.ts`, are shared by a sidebar list and its page, kept in localStorage, and re-read every minute while the page is open: one for the inbox, with one entry per project, one for the tickets, with one entry, since Linear is not per project, one for the MCP integrations, one for the Google calendars added, and one for the Calendar page's Google events, with one entry per month.
  `web/app.tsx` polls the inbox instead, on every page once the sessions are listed, for the Inbox tab's count, and the sidebar's inbox reads that entry.
  `web/components/tickets/ticket-fields.tsx` holds the issue detail's field pickers and sends their changes.
- `web/use-git-checkout.ts`: reads a directory's git checkout for the new-session draft, a live session's header, and the status bar's branch switcher; `CheckoutVersion` counts the switches made from the page so that each of them reads its checkout again.
  `web/components/git.tsx` holds the branch picker, the repository and branch in a header's meta line, and `BranchName`, the branch that copies itself on click, which the inbox and tickets also show.
  `web/use-copy.ts` copies text to the clipboard and holds the copied state behind a button's check mark.
  `web/use-default-model.ts` reads the model that the `default` role names, which the draft's model picker shows until a pick.
  `web/use-skills.ts` reads a directory's skills, and `web/pinned-skill.ts` keeps the skill pinned for new sessions.
  `web/components/skill-picker.tsx` is the skill picker that the settings' pinned skill and the routine editor share.
  The checkout, the default model, and the skills are each one `useRead`.
- `web/shortcuts.ts`: the keyboard shortcut table, which both the key listeners and the shortcut dialog read.
  Shortcuts with a `command` title are also the command palette's commands, and `web/app.tsx` hands the palette the same handlers it gives `useShortcuts`.
- `web/command-palette.ts`: the command palette's model, which renders nothing: its items and their actions, the reducer over its stack of views and its action panel, and the ranking, which multiplies cmdk's match score by a frecency boost kept in localStorage.
  `web/components/command-palette/` draws it, opened from the sidebar header or with Cmd+K: the dialog and its list, the action panel that Cmd+K opens on the highlighted entry, and the footer.
  `web/session-actions.ts` lists what can be done to a session, which both a sidebar row's menu and the palette offer.
- `web/theme.ts`: the light, dark, or system theme, which `web/main.tsx` applies before the first render and the settings page changes.
- `web/scroll-fade.ts`: sets the `.scroll-fade` edge opacities from JS in browsers without scroll-driven animations, such as Firefox, which `web/main.tsx` starts before the first render; elsewhere `web/globals.css` drives them with scroll timelines.
- `web/stored-state.ts`: `useStoredState`, a value kept in localStorage that removes its default rather than store it, which holds the theme, the sidebars, the split ratios, the session details tab, the sidebar's project, the pinned skill, the inbox's order, and how often and how lately each command palette entry ran; and `useStoredKeys`, a set of keys on top of it, which holds the sessions pinned in the sidebar and the inbox's and tickets page's folded sections.
  Every component that holds the same key sees a change at once, so the inbox page and its sidebar index share their folds and order.
  `sidebarSessions` in `web/sessions.ts` splits the sessions into the sidebar's pinned, running, interrupted, and past lists, which the page also walks for the previous and next session keys.
  `discoverableSessions` leaves sessions under `/tmp` out of those lists and the project picker, and `projectSwitch` keeps a started session's project only when that directory is discoverable.
- `web/components/roster.tsx`: the left sidebar's tabs, its tickets list, and the project picker; `web/components/inbox/inbox-nav.tsx` is its Inbox tab, and `web/components/section-link.tsx` the section link that the tickets list and the inbox's section index share.
  `web/components/session-list.tsx` is its Sessions tab, which lists the first 100 past sessions until you ask for more.
  `web/components/session-row.tsx` holds `PastRow` and `HostRow`, memoized on the row's session, so a roster push or a search keystroke renders only the rows it changed; their ages count up on the page's one minute timer.
  `web/components/todo/categories.tsx` holds its Todo tab: **All**, **Today**, **Needs you**, **From agents**, **Done**, then the categories, and `web/components/calendar/calendar-nav.tsx` its Calendar tab, the calendar and then the routines by name.
- `web/components/todo/`: the Todo page.
  `page.tsx` is the page and its lists, **Done** included, which `LIST_KINDS` marks read-only: its rows put a todo back or delete it for good, and its header offers **Empty** where the others offer **Clear done**.
  A list holds its unchecked todos, then a **Logbook** fold of its checked ones; `split.tsx` puts the list on the left and the open todo's `detail.tsx` on the right, at a list width stored in localStorage.
  `row.tsx` holds a todo's row, with its category badge, work-state dot, and link icons, an archived todo's row, and the row of a todo not added yet; `check.tsx` is a todo's checkbox and `input.tsx` the input a title is typed into, whose Cmd+Enter starts a session from the todo.
  `editing.ts` holds `useTodoEditing`, which of those inputs is open and what its keys do, and deleting with **Undo**; `undo.tsx` is the **Undo** toast and `search.tsx` the search field.
  `detail.tsx` is the open todo: a bar with its place and the ↑, ↓, and **×** buttons, its title, its property chips, live agent question, links, **Start session**, **Create Linear ticket**, and notes, which `web/components/markdown-editor.tsx` renders through `message-markdown.tsx` until you click them to edit; `links.tsx` draws a todo's link chips and work-state pill, each with an icon-only form for rows, and `add-button.tsx` is the button that adds a todo linking to an inbox row or a ticket row.
  `web/todo-views.ts` holds `LIST_KINDS`, what each list is called and lets you do, which todos it holds, each category's badge color, how a due day reads, and the `move` and `restore` the page sends; `web/use-todo-drag.ts` and `web/use-todo-keys.ts` drag and move rows, and the keys also step the open todo.
  `web/todo-work-state.ts` derives the pill and the **Needs you** filter from the latest linked session's live status, outstanding question, submitted pull request, or recorded `/ship` merge; it keeps unknown and ended sessions distinct from new ideas.
  `web/todo-quick-add.ts` reads a trailing due day and `#category` off a new todo's title, in the page's new todos and in the command palette's **Create todo**.
- `web/components/routines/routines-page.tsx`: the Routines page, its list with each routine's menu, and one routine's settings and runs, which open the sessions they started.
  It, the Calendar page, and the session rows read the time through `web/use-minute.ts`, one timer renewed each minute for every component that reads it.
  `web/components/routines/routine-editor.tsx` is the form that makes or edits a routine, with the new-session draft's `DirectoryPicker` for its workspace.
- `web/components/calendar/calendar-page.tsx`: the Calendar page, a month of `web/calendar-model.ts` entries and the chosen day's list beside it, including Google events read with `web/reads.ts`.
  It draws the month's grid and each day's hover card itself, and takes the month and year menus and arrows from Kibo UI's calendar, `web/components/kibo-ui/calendar/index.tsx`, whose month and year live in jotai atoms, so the page keeps its month while you leave and come back.
- `web/components/pane.tsx`: a pane.
  `conversation.tsx` holds the live composer, `conversation-header.tsx` its header with the End session button and the checkout read, `past-conversation.tsx` a past session's view, and `transcript.tsx` the transcript, whose `task` rows link to their subagents.
  `subject.ts` is `subjectOf`, the one place that tells a session from a subagent and derives what the composer may do; `model-slot.tsx` is the model and thinking switch, and `session-meta.tsx` the project, pull request, and ticket chips of a header.
  `composer.tsx` holds `blockedShortcut`, `ComposerNote`, and `EmptyConversation`, which the new-session draft and the pages share, and `page-header.tsx` the `Header` every page uses.
  `composer-queue.tsx` holds the queued rows and `useQueue`, and `composer-suggestions.tsx` the suggested prompts and their keys; `InputMessage` renders them through its `beforeTextarea` and `afterActions` slots.
  `image-attachments.tsx` holds the composer's attached images, which the new-session draft shares, and reads them as base64 when the prompt is sent.
- `web/components/dashboard-context.tsx`: the stable dashboard actions (`send`, `open`, `start`, `end`, …) and the last start of each kind, provided once by `App`, which the sidebar, the panes, and the pages read instead of taking them as props.
- `web/components/session-details.tsx`: the right sidebar's tabs for the focused pane: `outline-tab.tsx`, its turns from `outline` in `web/transcript-view.ts`, which scroll the focused pane's transcript to their prompt or reply and mark the turn its scroll is on; its changed files; and `media-tab.tsx`, its images and their viewer.
- `web/components/changes/`: the changes page, `changes-page.tsx`, with its explorer, `file-tree.tsx`, and its Diff and File views, `code-view.tsx`.
- `web/components/inbox/`, `web/components/tickets/`, `web/components/settings/`, `web/components/integrations/`, and `web/components/new-session.tsx`: the other pages.
  `web/components/integrations/` holds the Integrations page, which sorts its rows into **Connected** and **Available**: `mcp-integration.tsx` is an MCP integration's row, which the tickets page also shows while Linear is not connected, and `google-calendar.tsx` is Google Calendar's, with the form that adds a calendar by its address.
  Both lay out through `integration-row.tsx` and draw their brand marks from `brand-logos.tsx`; `mcp-integration.tsx` starts its sign-ins with `web/use-sign-in.ts`, and its `SignOutConfirm` asks before a sign-out and shows its failure.
  `web/components/more-actions-menu.tsx` is the ⋯ menu of a row's rarer actions, which the integration rows and the Routines page share.
  `inbox-board.tsx` holds `useInboxBoard`, the inbox's logic that the sidebar list and the page share: its sections, folds, order, drag, keys, and rows, with the sort menu and the keys line.
  Only one board mounts at a time, since its rows carry document ids and its keys are global, so the inbox page (`inbox-page.tsx`) shows the table while the sidebar shows `InboxIndex`, its sections as links, and `inbox-nav.tsx` lists the pull requests in the sidebar otherwise.
  `pr-page.tsx` shows one pull request's details in the main content, as the tickets page shows an issue; both wrap their details in `DetailPage` from `web/components/list-page.tsx`.
  `pr-row.tsx` draws the sidebar row and the table row, and exports the DOM lookups of a row and its link that the inbox's keys use.
  `web/use-drag-order.ts` drags the inbox's repositories, sections, and pull requests, each within its own scope, and draws the drop line.
  The tickets and inbox pages use `web/components/list-page.tsx` for their frame, header, and load and refresh states, its issue details use its `DetailPage`, and the pull request, Todo, Routines, and Calendar pages its `PageFrame`.
  Both details views use `web/components/sheet-details.tsx` for the sections, links, and comments of those details.
  `LoadNote` is the loading or error line that the pull request's details, the issue's, and the list page share, and `Clamped` folds a long description behind **Show more**.
  `web/components/fold.tsx` holds the fold button that the inbox and tickets share, `useFolds`, which keeps in localStorage the sections you flipped from their default fold, and `useReveal`, which unfolds a section or a row and scrolls to it once that element is in the document; `web/section.ts` names such a section target.
  The inbox binds J, K, O, E, and `.` through `useShortcuts`, over the pull requests that `shownPullRequests` in `web/inbox-model.ts` lists in order, so a folded section's rows drop out, and binds Alt+Shift+↑ and ↓ to move the focused heading or row by its `data-move` attribute.
- `web/components/ui`, `web/lib`, and `web/hooks`: files from the Fluid registry, and `web/components/kibo-ui` from Kibo UI's; `web/components/ui/PATCHES.md` lists every change the dashboard makes to them.

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
`InputMessage` gets an `onKeyDown` and `onPaste` passthrough for its textarea, so the completion list and the composer shortcuts see a key before the submit and history handling and a pasted image attaches, and a `stopShortcut`.
It also gets two slots, `beforeTextarea` and `afterActions`: `composer-queue.tsx` renders the queued rows that omp or the server holds into the first, and `composer-suggestions.tsx` into the second the prompts that the last turn's reply ends on, which `splitSuggestions` in `src/transcript.ts` splits off the reply into the assistant item's `suggestions`.
`ChatMessage` gets `images`, the addresses of the images a sent prompt carried, and `AskUserQuestions` a `header`, the question's status and **Dismiss**, and a `description` per question, a confirm's message.

Markdown uses `react-markdown`, `remark-gfm`, and `rehype-highlight` (`web/components/message-markdown.tsx`).
In agent text, raw HTML is escaped, unsafe link schemes are filtered, and an image renders as a link unless it is a `data:` URL.
In agent text, `remarkFilePaths` in `web/file-paths.ts` turns a path to a text file into a link, and that link, like a `file://` one, renders as a `FileLink` from `web/components/file-link.tsx`, which opens the file dialog through the dashboard context.
A relative path resolves against `FileBaseContext`: the pane's session directory, or the directory of the file the dialog shows.
Text from GitHub, which means pull request descriptions and comments, and Linear issues' text, renders its raw HTML through `rehype-raw` and then `rehype-sanitize` with its default schema, which follows GitHub's, plus a `<video>` with only a `src`.
It keeps images only from GitHub's image hosts and the route for a Linear issue's files, and plays a video only from that route.
`web/index.html` sets the page's `Content-Security-Policy`.
