# How omp-agents works

The server's design, its protocols, and its HTTP API.
For installation, see the [README](../README.md); for the interface, see [Using omp-agents](usage.md).

## omp modules

The server imports omp's own modules from the installed package, so it does not reimplement a protocol, the encryption, or the session-file format, and it always speaks the same version as the sessions it shows.
Only `src/omp/` imports them: `src/omp/modules.ts` loads every module once and checks at startup that each export this app uses exists, naming the omp version and the missing export when one does not.
It finds the package through `omp` on `PATH`, or `OMP_PACKAGE_DIR` when set; with a Bun global install that is `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

Paths in this document that start with `pi-coding-agent/`, `pi-ai/`, `pi-tui/`, or `pi-utils/` are inside that install, in `@oh-my-pi/`.
They are not in this repository.
The main ones:

- Collab: `pi-coding-agent/src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`.
- Session files: `pi-coding-agent/src/session/session-listing.ts` and `session-loader.ts`.
  `appendCustomMessageEntry` in `pi-coding-agent/src/session/session-manager.ts` gives a `custom_message` entry the timestamp of the message it records, which `#persistMessageEnd` in `agent-session.ts` passes.
- Interrupted turns: `pi-coding-agent/src/session/exit-diagnostics.ts` (`createInterruptedTurnAbortMessage`), which `endsMidTurn` in `src/omp/sessions.ts` uses to refuse forking a session that ended mid-turn.
- Images: `pi-coding-agent/src/session/blob-store.ts`, which moves a prompt's image out of the session file into `blob:sha256:<hash>`, and `getBlobsDir` in `pi-utils/src/dirs.ts`; `src/transcript.ts` and the `/api/image` route read them.
- Plan files: `listPlanFiles` in `pi-coding-agent/src/plan-mode/plan-files.ts`, whose rule `src/work.ts` copies; see [Transcripts](#transcripts).
- RPC: `pi-coding-agent/src/modes/rpc/rpc-client.ts`, `rpc-frame.ts`, and the frame types in `rpc-types.ts`.
  `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of the child's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](#dashboard-sessions).
  `get_available_models` returns omp's whole `Model` objects, with `name`, `contextWindow`, `api`, `identity`, and `serviceTiers`; `get_state` adds `fastModeEnabled` and `fastModeActive`, and `setFastMode` sends `set_fast_mode`.
- Service tiers: `serviceTierFamily` and `shouldSendServiceTier` in `pi-ai/src/types.ts`, which `fastAvailable` in `src/omp/models.ts` calls to decide, as `setFastMode` in `pi-coding-agent/src/session/model-controls.ts` does, whether `/fast` can turn on for the live model.
- Settings and discovery: `pi-coding-agent/src/config/settings.ts`, `pi-coding-agent/src/discovery/index.ts`, and `pi-coding-agent/src/task/discovery.ts`.
- Credentials: `pi-coding-agent/src/session/auth-broker-config.ts` (`discoverAuthStorage`) and `pi-ai/src/registry/oauth/index.ts` (`getOAuthProviders`).
  `connectedProviders` in `src/omp/models.ts` keeps the `/login` providers that have a credential, as omp's RPC `get_login_providers` marks them `authenticated`.
  It opens the credential store on each call and closes it, so a login in a terminal counts at the next call.
- Model roles: `pi-coding-agent/src/config/model-resolver.ts` (`expandRoleAlias`, `resolveRoleChain`), whose `@role` aliases `resolveRoles` in `src/omp/models.ts` follows for `GET /api/models/roles`.
- MCP: `pi-coding-agent/src/mcp/json-rpc.ts` (`callMCP`), `config.ts` (`loadAllMCPConfigs`), `oauth-credentials.ts`, `oauth-discovery.ts` (`discoverOAuthEndpoints`), `oauth-flow.ts` (`MCPOAuthFlow`), and `config-writer.ts` (`addMCPServer`), which `src/omp/mcp.ts` wraps for the tickets page and Linear's sign-in.
  Linear's sign-in reads and writes omp's credential store through the same `discoverAuthStorage`, opened and closed on each call.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory.

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
- The same read folds each line into the view's plan and changes as well: the latest todo list, from a `todo` result's `details.phases` or a `user_todo_edit` entry, and the files changed, from each `edit` result's `details.path` and `diff` (one per entry of `perFileResults` for a multi-file edit) and each `write` result's `details.resolvedPath`, which omp sets only for a file.
  The view's socket topic carries them as a `work` message, whole, once with the transcript and again after each read that changes them.
  A subagent's view folds its own file, so it shows its own plan and changes.
- The `work` message also carries the plan file: the last path ending in `plan.md`, omp's own rule for a plan file (`listPlanFiles` in `pi-coding-agent/src/plan-mode/plan-files.ts`), that an `edit` or `write` result names, with its text.
  The transcript cannot rebuild that text, since an edit records only a diff, so the server reads the file each time a read of the transcript finds a change to a plan file, before it sends that read on.
  omp writes the file before it records the tool result, so the text matches the result.
- A `task` result names the subagents it spawned in `details.progress` and `details.results`; the tool item lists their ids, which name each subagent's view.
  A running `task` reports them sooner through `tool_execution_update` events.
- Each watched view also gets a media tree (`src/media.ts`), which collects the images that tool results returned, from the view's file and from every subagent transcript, at any depth, in the directory named after it.
  About half the screenshots in a session sit in its subagents' files, so a session's view collects them all; a subagent's view collects its own and its subagents'.
  An image is a `content` block of a tool result, which omp moves to its blob store, so it reaches the page through `/api/image`; the caption is the summary of the tool call with the same id, and a user prompt's images are left out.
  It reads each file incrementally, parses only lines holding a tool call or an image block, and reads a tool result's call id without parsing the result, so a caption is dropped once its result arrives; it lists the directory again on each read, so a subagent that starts later is found.
  The watcher's changes poke it only for its own file, that file's `.<file>.lock` sidecar, and anything under its artifacts directory, since a subagent's appends do not touch the session file, and a sibling session's writes leave it alone.
  The view's socket topic carries the list, newest first, as a `media` message, whole, once the files are read and again after each read that adds an image.
- The server lists the session files through omp's session listing, the code behind omp's session picker, at startup and then once a minute, in case the watcher missed a change.
  Between listings it reads again only the session files the watcher reported, at most twice a second, so a session that streams costs one file read, not a listing of every session.
  The past list skips the empty sessions that omp's picker hides.
  The server looks up files by session id in this listing, so the page never sends a path.
  While no page is connected, it skips building the roster and the past list.
- Whenever the list changes, the server also scans for pull requests in each session file whose modification time changed, plus the subagent files in its artifacts directory.
  Like an open transcript, each file reads only the bytes appended since its last scan.
  The first scan reads every session file.
  On 460 MB across 367 sessions it takes under a second, and the sidebar shows before it finishes.
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

- Every 1.5 seconds the server lists the local hosts through the registry.
  That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would.
  The guest is how the dashboard prompts a session (`prompt` frames), stops a turn (`abort`), messages a subagent (`agent-cmd` `chat`; the host steers, prompts, or revives it), and cancels a running subagent (`agent-cmd` `kill`).
  It also carries the host's subagent registry (`agents` frames), subagent progress (`bus` frames), the host's model, thinking level, context numbers, and whether a turn runs (`state` frames), and the live agent events.
  The composer enables as soon as the host welcomes the guest.
  Nothing waits on the transcript snapshot that the host then sends.
- The host steers every `prompt` and `chat` that arrives during a turn.
  The guest therefore holds follow-ups and sends the next one when a `state` frame stops reporting `isStreaming`, or when an `agents` frame shows the subagent no longer running.
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
It imports only `src/paths.ts`, `src/json.ts`, `src/shared.ts`, `src/server/auth.ts`, `src/server/address.ts`, `src/user-todos-parse.ts`, and `src/user-todos.ts`, which use Node's modules alone; `bun build` bundles them into `desktop/dist/main.cjs`.
It reads `todos.json` through `parseUserTodoList` for the Dock badge, watching the file's directory since the server replaces the file, and its global quick-capture shortcut dispatches `QUICK_TODO_EVENT` in the page, which `web/app.tsx` answers by opening the Todo page with a new todo started.
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
  An empty `window.open`, which a browser tab opens before it knows the address, returns `null`, so the Linear sign-in in `web/components/settings/linear-connection.tsx` then opens the address itself once the server names it.
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

## Routines

A routine starts dashboard sessions, or runs a shell command, on one or more schedules. A schedule is every so many minutes, counted from the last run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST. The routine is due at the earliest of them. Two intervals share that last run, so the shorter one decides.
Its task is one prompt or one command.
The prompt ends with `UNATTENDED`, which tells the session not to ask questions.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops a routine whose task was pull requests. The rest of the file stays. The next save writes `schedules`. A file that is not a list of routines still moves aside.
A run from before `queued` reads its `queue` list as queued while the list holds an entry; a run that has `queued` reads only that.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, whether it is still queued, the sessions it started, its errors, and for a command task, its `command` result once the command ended.
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
   The runner keeps the routines whose command runs in memory, and a command routine whose last command still runs records an error instead of running a second one.
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

`GET /api/file?path=<absolute path>` answers a text file for the page's file dialog: `{ path, text, size, truncated }`.
The path is absolute or starts with `~/`; the page resolves a relative one against the session's directory first.
The file's real path, after symlinks, must end in one of `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot reach a key file.
It reads the first `MAX_TEXT_FILE_BYTES` (1 MB) and answers 415 when those bytes are not UTF-8.
It runs `git worktree list --porcelain`, `git for-each-ref`, and `git symbolic-ref` on each call, and reads `origin` through the inbox's cached lookup.
Like a new session's `start`, `cwd` may name any directory.
The new-session draft reads it for its branch picker, and a live session's header reads it when it opens and when a turn starts or ends.
`GET /api/worktrees` lists the worktrees of every repository a session ran in, or of `?cwd=` when that directory is in a repository.
Each row names the registered path, branch, lock, whether the directory is missing, the newest session file there, and why removal is refused.
`GET /api/worktrees/metrics?repository=&path=` reads approximate allocated disk use, the last commit time, and the modified and untracked counts for one registered checkout.
`PUT /api/worktrees/removal` previews a removal or performs one whose confirmation still matches that preview.
Removal uses `git worktree remove` without `--force`, so Git keeps the branch and still refuses a dirty or locked checkout.
A missing directory is removed the same way, which drops only that registration.
Dashboard session starts wait while a removal runs, and a removal waits while a start runs.

`GET /api/models/connected?cwd=<directory>` answers `{ models }`: the models that `omp models` lists from the providers you are connected to, for the new-session draft's model menu.
Each model is `{ provider, id, name, contextWindow, curated, thinkingLevels }`; `curated` marks the ones that the directory's `modelRoles` or `retry.fallbackChains` name, with any `:level` dropped, and `thinkingLevels` are the ones omp's catalog lists (`modelEntries` in `src/omp/models.ts`).
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
`<dir>` is `worktreeDir` in `src/shared.ts`, beside the main worktree.
The server refuses a `<dir>` that already exists, because `git worktree add -b` creates the branch before it checks the path.
A branch that git refuses answers the `start` with git's reason, and no omp spawns.
A failed start makes the draft read the checkout again, so a branch that the start created shows as an existing one.

`GET /api/tickets`, or `GET /api/tickets?fresh` to skip the server's 30-second cache, answers the tickets page with `{ tickets }`.
A failed read is the API's usual `{ error }` with status 500, and the page keeps showing the last tickets it has with the error above them.
The server reads Linear through Linear's MCP server, with the OAuth sign-in that omp keeps for it, through `src/omp/mcp.ts`: it loads omp's own MCP config for the enabled server whose `url` has the `mcp.linear.app` host, and gets an access token for its `auth.credentialId`, or for the id omp files a sign-in for that URL under, from `omp token <credentialId>`, which refreshes the token through omp's credential owner.
The token stays in memory for five minutes and is dropped when Linear answers 401, which the page reports as a `/mcp reauth <name>` hint; it is never logged.
Linear's GraphQL API refuses that token, so the server calls the MCP endpoint's `list_issues` tool through omp's `callMCP`, a stateless JSON-RPC `tools/call` POST.
It asks for each open state type in full, following the cursor, and for completed, canceled, and duplicate issues updated in the last seven days, in parallel, then drops repeats by identifier.
`list_issues` and `get_issue` name an issue's labels without their colors, so the server reads each team's labels with `list_issue_labels`, by the team key that prefixes the identifier, and keeps them for five minutes; `?fresh` reads them again too.

`GET /api/ticket?id=<identifier>`, such as `?id=ENG-2368`, answers the tickets page's main content with that issue in full: the row's fields, the assignee, the team's id, the description, who opened it and when, the links Linear attaches to it, and its comment threads.
The server calls `get_issue` and `list_comments` in parallel, through the same MCP sign-in, with no cache, so each opening reads the issue again.
It rewrites Linear's `<issue>` mentions as markdown links, its `<linear-image>` tags as image links, its `<linear-embed node-type="video">` tags as `<video>` elements, and other `<linear-embed>` tags as links.
It threads the comments by `parentId`, oldest first.
An identifier that is not a team key, a dash, and a number answers 400.

Linear hands out its files as `uploads.linear.app` addresses whose `signature` JWT expires five minutes after the read.
`src/linear-uploads.ts` rewrites each one in the description and comments to `GET /api/ticket/media?issue=<identifier>&path=<upload path>`, and keeps the latest signed address of each path in memory.
That route fetches the kept address, passing the `Range` header on, and streams Linear's answer back with its type, length, range, and validators.
When the kept address is within 30 seconds of expiring, missing after a restart, or refused by Linear, the route reads the issue again, which signs every file in it anew; requests for one issue within 10 seconds share that read.
Only paths that a read of the issue named are fetched, so the route reaches nothing but Linear's own uploads.
It serves each file with `Content-Security-Policy: sandbox` and `nosniff`, and anything other than an image, a video, or audio as an attachment, since a file that someone uploaded to Linear is served from the dashboard's origin.
The page's CSP stays `'self'` for media.
`message-markdown.tsx` lets Linear's text load images and play `<video>` only from that route.

`GET /api/ticket/options?team=<team id>` answers `TicketOptions` for the issue detail's field pickers: the team's workflow states (`list_issue_statuses`) in Linear's workflow order, the workspace's active members (`list_users`), the team's and the workspace's live labels (`list_issue_labels`), and the team's projects (`list_projects`, 50 a page), each paged to its end.
The server keeps each team's answer for five minutes.
`PUT /api/ticket` takes a `TicketEdit`, `{ id, state?, assignee?, priority?, labels?, project?, dueDate? }`, checked by `parseTicketEdit` in `src/server/wire.ts`, where `null` clears a field and `labels` replaces the whole set by name.
It calls `save_issue` with those fields, drops the cached tickets list, and answers the issue as `GET /api/ticket` reads it after the change.
The issue detail shows a change at once, sends its changes one at a time, and on a failure reads the issue again.

`GET /api/linear` answers `{ connected, signIn }`.
`connected` is true when omp's user-level MCP config has an enabled server on `mcp.linear.app` and omp's credential store, read again on each call, holds an OAuth sign-in under that server's credential id.
The page hides the **Tickets** tab until a read says `connected`, and keeps the last read in localStorage.
`PUT /api/linear/sign-in` starts a sign-in the way omp's `/mcp reauth` does, in `src/linear.ts` and `src/omp/mcp.ts`: it reads Linear's OAuth endpoints from its metadata, registers a client, and starts omp's `MCPOAuthFlow`, whose callback server listens on `localhost:3000`.
It answers once the flow has Linear's authorization address, as `signIn: { phase: "waiting", url }`, which the page opens in a new tab.
When the browser comes back, the server stores the tokens, refresh material included, under the server's credential id, where `omp token` finds them, and adds `"linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }` to omp's `mcp.json` when omp had no Linear server.
A new sign-in abandons the one under way.
A failure, or no return within five minutes, shows as `signIn: { phase: "failed", error }` until the next sign-in.

## Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Inbox**, **Tickets**, **Sessions**, **Todo**, and **Routines** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
User and assistant turns use `chat-message`, tool calls use `thinking-steps`, and the composer uses `input-message`.
`thinking-indicator` shows while the agent works.
shadcn's `message-scroller` follows streaming content, preserves the reader's scroll position, and supplies the jump-to-latest button.
The model, thinking, and project pickers use shadcn's `popover` and `command` combobox pattern.
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
  `src/server/views.ts` points each open view at its file and folds live events into it, and keeps each open view's media tree.
- `src/shared.ts`: every type that crosses the socket or the HTTP API (`RosterHost`, `PastSession`, `SessionWork`, `ServerMsg`, `ClientMsg`, the inbox, pull request, ticket, and routine shapes).
  `selectorOf` names a model as `provider/id`, which both session transports and the model picker use, and `pullRequestUrl` a pull request's GitHub page, which the server's prompts and the page's links share.
- `src/omp/`: the facades over omp's modules: `modules.ts` loads them, `install.ts` finds the package and its CLI, and `collab.ts`, `rpc.ts`, `sessions.ts`, `config.ts`, `discovery.ts`, `mcp.ts`, `models.ts`, and `prompts.ts` wrap one area each.
- `src/proc.ts` runs subprocesses, and `runShell` a routine's shell command, `src/json.ts` narrows untyped JSON (`isObject`, `str`, `oneOf`, `isTexts`, `errorText`), `src/fs.ts` replaces a file through a temporary one beside it and holds `JsonFile`, the load/save store behind `interrupted.json`, `todos.json`, and `routines.json`, and `src/paths.ts` names the home directory, the token file, the interrupted sessions' file, the todo list's file, and the routines' file.
- `src/dashboard-session.ts`: drives one session that the dashboard started, over RPC.
- `src/guest.ts`: runs one Collab guest per terminal session.
  `src/subagents.ts` parses the host's subagent registry and its lifecycle and progress frames (`parseAgents`, `parseSubagentFrame`) for both transports, finds each subagent's transcript file, and lists every subagent transcript under a transcript's artifacts directory (`artifactsDir`, `subagentFiles`).
- `src/turn-gate.ts`: `TurnGate`, which both transports use to run a session's prompts, aborts, and flushes in the order the page sent them.
- `src/user-requests.ts`: parses the RPC and Collab question frames into one request shape, writes the answers back, and keeps each session's pending questions.
- `src/commands.ts`: the composer's `/` and `@` completions, and the expansion of file commands and skills before a guest prompt.
- `src/tail.ts`: reads one transcript file incrementally and feeds each entry to both folds below, and reads the plan file that the second fold names; `src/line-reader.ts` holds the incremental `LineReader` and the `ReadQueue` that serializes its reads, which `src/media.ts` shares.
- `src/session-entries.ts`: the vocabulary of a session file's entries, `textOf`, `oneLine`, `entryTime`, `toolCallsOf`, `toolResultOf`, `toolSummary`, and `imagesOf`, which the folds below and `src/guest.ts` read instead of walking the entry shape themselves.
- `src/transcript.ts`: folds session-file lines and live events into display items.
- `src/work.ts`: folds session-file lines into the plan and changes: the latest todo list, the plan file changed last, and the files changed.
- `src/media.ts`: collects the images that a transcript's and its subagents' tools returned, for the `media` message.
- `src/session-facts.ts`: finds the pull requests and Linear issues each session submitted or worked on, and its latest /ship step (`parseShipProgress`); `SessionFactsIndex.factsOf(path)` answers them as one `SessionFacts`.
- `src/session-links.ts`: writes the session block into a pull request's description.
- `src/inbox.ts`: maps each workspace to its GitHub repository, reads the inbox's pull requests with one `gh api graphql` call per repository, and reads one pull request's details with one more.
  A row's `conflicts` is true when GraphQL's `mergeable` is `CONFLICTING`.
- `src/git.ts`: the git checkout of a directory, and the worktree a new session's branch runs in.
- `src/worktrees.ts`: the worktree inventory and the checks before a checkout is removed; `removeCheckout` removes the checkout a directory is in, waiting up to 15 seconds for a session that just ended to leave it.
- `src/text-file.ts`: reads a text file by absolute path for `GET /api/file`, within the extensions, size, and encoding that route allows.
  `src/worktrees-shared.ts` holds the shapes the page and the routes share.
- `src/tickets.ts`: the Linear side of the tickets page: the `list_issues` queries, their paging, and parsing the issues out of the tool's text, one issue in full for the main content, the options of its field pickers, and the `save_issue` call they make.
  `src/linear-uploads.ts` keeps the signed addresses of an issue's files and serves them.
  `src/linear.ts` finds omp's server for Linear, tells whether omp is signed in to it, and runs the sign-in that the settings start.
- `src/cache.ts`: keeps answers for a time to live, 30 seconds for the inbox's and the tickets', so several tabs share one query; `dropWhere` forgets the keys a predicate names, which `src/commands.ts` uses when a session ends.
- `src/user-todos.ts`: the rules of the Todo page's list, `applyUserTodo`, which the server applies to its file and the page to what it shows before the server answers.
  The list is `UserTodoList` in `src/shared.ts`: categories, top-level todos, and the archive that **Clear done** fills, latest first.
  A todo has a title, markdown notes, a check time (`doneAt`), and a due day; a top-level one also has a category or none, todos of its own, which share its category, links (`UserTodoLink`: a session, a pull request, or a Linear issue), and `addedBy`, the session whose agent added it.
  `move` reorders, `restore` puts back what `remove` took at its index for the page's **Undo**, and `unarchive` and `empty-archive` act on the archive.
  Every list keeps its todos to do before its checked ones, at both levels: `applyUserTodo` orders the todos after each change through `inStatusOrder`, and loading the file does too.
  `moveTo` in `web/todo-views.ts` refuses a move among the todos of the other status, and the page adds a todo after the last one to do.
  `src/server/user-todos-file.ts` keeps the list in `todos.json` beside the access token.
  `src/user-todos-parse.ts` reads the list and its changes from JSON for the file, the socket, the todo inbox, and the desktop shell: a file from before any of those fields reads with none of them, a `done: true` todo as checked when it loads, and a change from a page or an agent is held to the length limits, a `restore` too.
  A `user-todo` socket message carries one change, and every socket hears the list after it as a `user-todos` message on the roster topic, also sent when a socket opens; a change that changes nothing sends the list back to its own socket alone.
  A `start` of kind `new` may name a `todoId`; once omp starts, `src/server/start.ts` links the todo to the new session through `StartEnv.linkTodo`, before it sends the first message.
- `src/server/todo-inbox.ts`: applies the changes that omp's `user_todo` tool (`templates/omp/agent/extensions/todos.ts`) leaves in `todo-inbox/` beside `todos.json`, one JSON file each, written under a `.tmp` name then renamed.
  It takes `add`, and `toggle` that checks, deletes each file it applies, and moves any other to `<name>.invalid` with a logged reason, so the server stays the only writer of `todos.json` and an agent cannot undo what you did.
  The extension's `before_agent_start` handler reads `todos.json` at each prompt and, when an open top-level todo links to its session, adds that todo's title and id to the system prompt, so the agent checks it off once it finishes the work.
- `src/server/end-inbox.ts`: ends the sessions that omp's `end_session` tool (`templates/omp/agent/extensions/end-session.ts`) asks to end, one `<session id>.json` each in `end-inbox/` beside `todos.json`.
  The tool writes its request at `agent_end`, after the turn that called it, and deletes it at the next `agent_start` or `session_shutdown`, so a request names a session that idles.
  The inbox drains when the directory changes and after each registry poll, finds the live session through `LiveSessions.bySessionId`, deletes the request, and calls `end()`, the path **End session** takes, so the session is not marked interrupted.
  A request whose session the server does not follow yet stays for a later drain, and a file that is not a request, or whose name is not its session id, moves to `<name>.invalid`.
  With `removeWorktree`, it then calls `Worktrees.removeCheckout` on the session's cwd, and a checkout that stays adds a todo naming the blockers.
- `src/tickets.ts` also lists the workspace's Linear teams (`loadTeams`, `GET /api/linear/teams`) and opens an issue from a todo (`createTicket`, `PUT /api/ticket/new`), assigned to the viewer.
- `src/routines.ts`: the rules of routines: `nextRunAt`, `nextDueAt`, `isDue`, `applyRoutine`, which applies an edit, and a command's length, time, and output limits; see [Routines](#routines).
  `src/server/routines-file.ts` keeps them in `routines.json`, and `src/server/routine-runner.ts` claims their runs, starts and ends their sessions, and runs their commands.
- `src/pull-request-actions.ts`: the pull request actions, which pull requests each applies to and its prompt, which the inbox's quick actions use.
- `src/usage.ts`: runs `omp usage --json` and parses it into plan windows.
- `src/settings.ts`: builds the settings page's model routing and file list, and checks and saves its edits.
  An edit it refuses throws its `Rejected`, which `src/server/routes.ts` answers with the error's status.
- `src/test-env.ts`: points `PI_CODING_AGENT_DIR` at a temporary directory.
  `bunfig.toml` preloads it for tests, so they never touch `~/.omp/agent`.

The page lives in `web/`.
`src/server/page.ts` bundles `web/index.html` and `web/main.tsx` with `Bun.build`, and `bun-plugin-tailwind` compiles Tailwind v4:

- `web/app.tsx`: the page shell, which holds the sidebars, the pane grid, the routes for a pull request's details, tickets, todo, routines, settings, and new-session pages, and focus handling.
  `#inbox` alone keeps the pane grid and only switches the sidebar to its Inbox tab.
- `web/use-dashboard.ts`: the socket, the page state, and the URL hash.
  One exhaustive switch in the socket's `onmessage` sends each server message to the pane store or the reducer, and the hash is read once into a `Route` (a page, a `#session/<id>` link, or the panes).
  `web/starts.ts` holds the sessions the page is starting, whether new, forked, resumed, resumed all at once, or started by a quick action on a pull request or a Linear issue, which runs in the background.
- `web/pane-store.ts`: each open view's transcript, plan and changes, images, and completions, outside the page state, so a token in one pane re-renders only that pane.
  It and `web/polled-store.ts` share `web/keyed-store.ts`, one snapshot and subscription per key.
- `web/dashboard-state.ts`: the page state and its reducer, which `web/use-dashboard.ts` runs.
- `web/routing.ts`, `web/sessions.ts`, `web/labels.ts`, `web/inbox-model.ts`, `web/tickets-model.ts`, `web/routines-model.ts`, and `web/transcript-view.ts`, and `web/document-title.ts` (the tab and window title): the pure transforms from server messages to what the page renders, and the hash routes.
- `web/file-paths.ts`: which paths in agent text name a text file, and the absolute path each resolves to.
  `web/delimited.ts` parses a TSV or CSV file into rows.
  `web/components/file-link.tsx` holds the link that opens such a path, and `web/components/file-dialog.tsx` the dialog that shows the file.
  `sessionsOn` in `web/sessions.ts` picks the running sessions that work on a pull request or an issue, which the inbox and the tickets page show.
  `web/inbox-model.ts` holds the inbox's moves in one table, `MOVES`, with each move's verb, its section, and the quick action that makes it; `moveOf` picks a pull request's move from its facts and from where the running sessions on it stand, through `agentOn`.
  It also holds which sections start folded, sorts rows by move and keeps each stack's rows together by the chain of base branches, and says what the details' Status shows.
  `InboxOrder` there is the order you chose, the repositories, the sections, the sort, and the manual order of pull requests, which `placedManual` updates after a drop; a stack moves as one `unit`.
  `web/routines-model.ts` words a routine's schedule, task, next run, and last run, and turns the routine editor's form into the routine it saves.
- `web/page-icons.ts`: the icon of each dashboard page, which its sidebar tab and every link into the page show.
- `web/model-menu.ts`: what the model menu derives from the model list and plan usage, the context variants of a model, a provider's quota for the account with the most left, and the search's word match.
  The menu itself is `web/components/model-picker.tsx`, built on the submenu, switch, and radio rows of `web/components/ui/menu.tsx`; `Plans` in `web/components/plan-usage.tsx` hands it the last `omp usage` run.
- `web/quick-actions.ts`: the quick actions of the inbox and the tickets page, which pull requests and issues each applies to, and the start, with its prompt, that runs it; the pull request actions themselves come from `src/pull-request-actions.ts`.
  `web/components/quick-actions.tsx` holds their row menu, the buttons on a pull request's or an issue's details, and the note that says why a start failed.
  `web/components/session-chip.tsx` holds the chip that names a session on a row or in the details, with the status dot of a running one.
- `web/api.ts`: the page's HTTP client, and `errorText`, which says what any failure was.
  `settingsUrl` names a settings route for one workspace, or for the user's own files.
- `web/reads.ts`: the server reads that components hold.
  `useRead` reads one URL, such as the pull request or the Linear issue the main content shows, the settings page's model catalog, or the new-session draft's model list.
  `useReplaceableRead` shows the version a save answered until that URL is read again.
  The polled stores, made by `web/polled-store.ts`, are shared by a sidebar list and its page, kept in localStorage, and re-read every minute while the page is open: one for the inbox, with one entry per project, one for the tickets, with one entry, since Linear is not per project, and one for whether omp is signed in to Linear.
  `web/app.tsx` polls the inbox instead, on every page once the sessions are listed, for the Inbox tab's count, and the sidebar's inbox reads that entry.
  `web/components/tickets/ticket-fields.tsx` holds the issue detail's field pickers and sends their changes.
- `web/use-git-checkout.ts`: reads a directory's git checkout for the new-session draft and a live session's header.
  `web/components/git.tsx` holds the branch picker, the repository and branch in a header's meta line, and `BranchName`, the branch that copies itself on click, which the inbox and tickets also show.
  `web/use-copy.ts` copies text to the clipboard and holds the copied state behind a button's check mark.
  `web/use-default-model.ts` reads the model that the `default` role names, which the draft's model picker shows until a pick.
  `web/use-skills.ts` reads a directory's skills, and `web/pinned-skill.ts` keeps the skill pinned for new sessions.
  `web/components/skill-picker.tsx` is the skill picker that the settings' pinned skill and the routine editor share.
  The checkout, the default model, and the skills are each one `useRead`.
- `web/shortcuts.ts`: the keyboard shortcut table, which both the key listeners and the shortcut dialog read.
  `web/components/session-switcher.tsx` is the search over every session, opened from the sidebar header or with Cmd+K. What you type there can also be added as a todo.
- `web/theme.ts`: the light, dark, or system theme, which `web/main.tsx` applies before the first render and the settings page changes.
- `web/scroll-fade.ts`: sets the `.scroll-fade` edge opacities from JS in browsers without scroll-driven animations, such as Firefox, which `web/main.tsx` starts before the first render; elsewhere `web/globals.css` drives them with scroll timelines.
- `web/stored-state.ts`: `useStoredState`, a value kept in localStorage that removes its default rather than store it, which holds the theme, the sidebars, the split ratios, the plan tab, the sidebar's project, the pinned skill, and the inbox's order; and `useStoredKeys`, a set of keys on top of it, which holds the sessions pinned in the sidebar and the inbox's and tickets page's folded sections.
  `sidebarSessions` in `web/sessions.ts` splits the sessions into the sidebar's pinned, running, interrupted, and past lists, which the page also walks for the previous and next session keys.
  `discoverableSessions` leaves sessions under `/tmp` out of those lists and the project picker, and `projectSwitch` keeps a started session's project only when that directory is discoverable.
- `web/components/roster.tsx`: the left sidebar's tabs, its session and tickets lists, and the project picker; `web/components/inbox/inbox-nav.tsx` is its Inbox tab.
  `SessionRow` is the one row a past session and a live host both render.
  `web/components/todo-categories.tsx` holds its Todo tab: **All**, **Today**, **From agents**, **Done**, then the categories, and `web/components/routines/routines-nav.tsx` its Routines tab, the routines by name.
- `web/components/user-todos.tsx`: the Todo page and its lists; `todo-archive.tsx` is the **Done** page.
  `web/todo-views.ts` holds `LIST_KINDS`, what each list is called and lets you do, which todos it holds, and the `move` and `restore` the page sends; `web/use-todo-drag.ts` and `web/use-todo-keys.ts` drag and move rows, `todo-search.tsx` is the search field, and `todo-undo.tsx` the **Undo** toast.
  `todo-detail.tsx` is the open todo, with its due day, links, **Start session**, and **Create Linear ticket**, whose notes `web/components/markdown-editor.tsx` always renders through `message-markdown.tsx` while you edit them; `todo-links.tsx` draws a todo's link chips, and `add-to-todo.tsx` is the button that adds a todo linking to an inbox row, a ticket row, or a session's header.
- `web/components/routines/routines-page.tsx`: the Routines page, its list with each routine's menu, and one routine's settings and runs, which open the sessions they started.
  `web/components/routines/routine-editor.tsx` is the form that makes or edits a routine, with the new-session draft's `DirectoryPicker` for its workspace.
- `web/components/pane.tsx`: a pane.
  `conversation.tsx` holds the live composer, `conversation-header.tsx` its header with the End session button and the checkout read, `past-conversation.tsx` a past session's view, and `transcript.tsx` the transcript, whose `task` rows link to their subagents.
  `subject.ts` is `subjectOf`, the one place that tells a session from a subagent and derives what the composer may do; `model-slot.tsx` is the model and thinking switch, and `session-meta.tsx` the project, pull request, and ticket chips of a header.
  `composer.tsx` holds `blockedShortcut`, `ComposerNote`, and `EmptyConversation`, which the new-session draft and the pages share, and `page-header.tsx` the `Header` every page uses.
  `composer-queue.tsx` holds the queued rows and `useQueue`, and `composer-suggestions.tsx` the suggested prompts and their keys; `InputMessage` renders them through its `beforeTextarea` and `afterActions` slots.
  `image-attachments.tsx` holds the composer's attached images, which the new-session draft shares, and reads them as base64 when the prompt is sent.
- `web/components/dashboard-context.tsx`: the stable dashboard actions (`send`, `open`, `start`, `end`, …) and the last start of each kind, provided once by `App`, which the sidebar, the panes, and the pages read instead of taking them as props.
- `web/components/plan-panel.tsx`: the right sidebar's tabs for the focused pane: its plan and its changed files, then `agents-tab.tsx`, the live session's agents as a tree, and `media-tab.tsx`, its images and their viewer.
- `web/components/inbox/`, `web/components/tickets/`, `web/components/settings/`, and `web/components/new-session.tsx`: the other pages.
  `inbox-nav.tsx` lists the pull requests in the sidebar with its sort menu, and `pr-page.tsx` shows one pull request's details in the main content, as the tickets page shows an issue.
  `web/use-drag-order.ts` drags the inbox's repositories, sections, and pull requests, each within its own scope, and draws the drop line.
  The tickets page uses `web/components/list-page.tsx` for its frame, header, and load and refresh states, and the pull request, Todo, and Routines pages its `PageFrame`.
  Both details views use `web/components/sheet-details.tsx` for the sections, links, and comments of those details.
  `LoadNote` is the loading or error line that the pull request's details, the issue's, and the list page share, and `Clamped` folds a long description behind **Show more**.
  `web/components/fold.tsx` holds the fold button that the inbox and tickets share, `useFolds`, which keeps in localStorage the sections you flipped from their default fold, and `useReveal`, which unfolds a section or a row and scrolls to it once that element is in the document; `web/section.ts` names such a section target.
  The sidebar's inbox binds J, K, O, E, and `.` through `useShortcuts`, over the pull requests that `shownPullRequests` in `web/inbox-model.ts` lists in sidebar order, so a folded section's rows drop out, and binds Alt+Shift+↑ and ↓ to move the focused heading or row by its `data-move` attribute.
- `web/components/ui`, `web/lib`, and `web/hooks`: files from the Fluid registry; `web/components/ui/PATCHES.md` lists every change the dashboard makes to them.

`templates/omp/` holds the omp starter kit and its installer, `templates/omp/install.ts` (`bun run omp-template`).
Its `agent/` files are the default kit.
`maintainer/` is the maintainer git profile, `AGENTS.md` and `docs/git-workflow.md`, copied only when you pass `--maintainer`, and a file there replaces the `agent/` file with the same path.
After you edit one of those live files, copy it back into the matching directory.
`bun run omp-template --dry-run` shows a copy that has drifted as `keep yours`.
The default `agent/AGENTS.md` keeps worktree and force-push safety inline and links to the model and review references under `agent/docs/`.
The profile's `docs/git-workflow.md` detects Graphite with `git rev-parse --path-format=absolute --git-common-dir`, so the same procedure works from a checkout, a linked worktree, or a nested directory.
`src/docs.test.ts` checks root Markdown and all Markdown below `docs/` and `templates/omp/`, including the kit's nested commands, skills, and references, for lines that tools would truncate.
The repository's agent guide links to [agent smoke checks](agent-smoke.md) for server authentication and lifecycle, browser verification, and desktop verification.

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
