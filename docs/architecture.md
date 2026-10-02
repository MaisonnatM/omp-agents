# How omp-agents works

The server's design, its protocols, and its HTTP API. For installation, see the [README](../README.md); for the interface, see [Using omp-agents](usage.md).

## omp modules

The server imports omp's own modules from the installed package, so it does not reimplement a protocol, the encryption, or the session-file format, and it always speaks the same version as the sessions it shows. Only `src/omp/` imports them: `src/omp/modules.ts` loads every module once and checks at startup that each export this app uses exists, naming the omp version and the missing export when one does not. It finds the package through `omp` on `PATH`, or `OMP_PACKAGE_DIR` when set; with a Bun global install that is `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.

Paths in this document that start with `pi-coding-agent/`, `pi-tui/`, or `pi-utils/` are inside that install, in `@oh-my-pi/`. They are not in this repository. The main ones:

- Collab: `pi-coding-agent/src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`.
- Session files: `pi-coding-agent/src/session/session-listing.ts` and `session-loader.ts`.
- RPC: `pi-coding-agent/src/modes/rpc/rpc-client.ts`, `rpc-frame.ts`, and the frame types in `rpc-types.ts`. `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of the child's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](#dashboard-sessions).
- Settings and discovery: `pi-coding-agent/src/config/settings.ts`, `pi-coding-agent/src/discovery/index.ts`, and `pi-coding-agent/src/task/discovery.ts`.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory.

## Transcripts

Every transcript comes from the session files on this machine, not from a network connection:

- One recursive file watcher covers omp's sessions directory. When a file changes, every open transcript in that directory reads the bytes appended since its last read and folds the complete JSONL lines into display items. On macOS a burst of appends can surface only as events for omp's `.<file>.lock` sidecar, which is why a change anywhere in a directory re-reads every open transcript in it.
- A session's transcript is its `<time>_<session id>.jsonl` file. A subagent's transcript is `<id>.jsonl` in its parent's artifacts directory, which is the parent's transcript path without `.jsonl`. A subagent that outlived a `/new` or `/resume` wrote beside the session it started in, so when the expected file is missing the server looks for the newest `<id>.jsonl` in the project's sessions that changed after the subagent registered.
- A past session reads the same way, so a session that runs without publishing itself keeps updating.
- Live agent events only add what the file does not hold yet: the reply as it streams, and the running state of tool calls. omp keeps a message's `timestamp` when it writes the message, so the file's copy replaces the streamed copy in place, and a late event cannot undo it. omp writes a fresh session's file only with its first reply. Until then the prompt shows from its live event, except a prompt sent from the dashboard to a terminal session, whose file entry has no message timestamp to merge on. A queued steer or follow-up keeps the time it was sent, though the agent takes it later. So a message from the file never goes ahead of the file messages before it, and a live user message goes after everything already shown.
- A reply that streams and a tool call that runs change with every token. Each open transcript sends those changes to the page at most every 50 ms; a message that finishes, a tool call that ends, a prompt, or a notice goes out at once, together with what was held back.
- The same read folds each line into the view's plan and changes as well: the latest todo list, from a `todo` result's `details.phases` or a `user_todo_edit` entry, and the files changed, from each `edit` result's `details.path` and `diff` (one per entry of `perFileResults` for a multi-file edit) and each `write` result's `details.resolvedPath`, which omp sets only for a file. The view's socket topic carries them as a `work` message, whole, once with the transcript and again after each read that changes them. A subagent's view folds its own file, so it shows its own plan and changes.
- A `task` result names the subagents it spawned in `details.progress` and `details.results`; the tool item lists their ids, which name each subagent's view. A running `task` reports them sooner through `tool_execution_update` events.
- The server lists the session files through omp's session listing, the code behind omp's session picker, at startup and then once a minute, in case the watcher missed a change. Between listings it reads again only the session files the watcher reported, at most twice a second, so a session that streams costs one file read, not a listing of every session. The past list skips the empty sessions that omp's picker hides. The server looks up files by session id in this listing, so the page never sends a path. While no page is connected, it skips building the roster and the past list.
- Whenever the list changes, the server also scans for pull requests in each session file whose modification time changed, plus the subagent files in its artifacts directory. Like an open transcript, each file reads only the bytes appended since its last scan. The first scan reads every session file. On 460 MB across 367 sessions it takes under a second, and the sidebar shows before it finishes. A session that names a PR by number alone costs one `git remote get-url origin` in its working directory. A subagent's appends do not change the session file, so its pull requests show once the session writes again, at the latest when it receives the subagent's result.
- Each inbox answer tells the server which branch heads which pull request in that repository. The server then links each session whose `git push` updated one of those branches to that PR, and sends the sidebar the new links.

## Terminal sessions

Sessions started in a terminal are reached through their Collab room:

- Every 1.5 seconds the server lists the local hosts through the registry. That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would. The guest is how the dashboard prompts a session (`prompt` frames), stops a turn (`abort`), messages a subagent (`agent-cmd` `chat`; the host steers, prompts, or revives it), and cancels a running subagent (`agent-cmd` `kill`). It also carries the host's subagent registry (`agents` frames), subagent progress (`bus` frames), the host's model, thinking level, context numbers, and whether a turn runs (`state` frames), and the live agent events. The composer enables as soon as the host welcomes the guest. Nothing waits on the transcript snapshot that the host then sends.
- The host steers every `prompt` and `chat` that arrives during a turn. The guest therefore holds follow-ups and sends the next one when a `state` frame stops reporting `isStreaming`, or when an `agents` frame shows the subagent no longer running. It sends none after a turn that its own `abort` or a reply cut off mid-stream ended.
- The dashboard uses omp's discovery and autocomplete modules for file commands, skills, and file mentions. It expands file commands and skills before guest prompt delivery because Collab prompts bypass the host's slash-command pipeline. The host still resolves `@file` references in the selected session's working directory.
- If a host starts a new room, for example after `/new` or `/resume`, the server sees the new generation and joins the new room. If the link request races the switch and fails with `stale_generation`, the server lists again and retries. A host that leaves the registry is marked as no longer running.

Terminal sessions send their questions to writable guests as Collab `ui-request` frames, and the guest answers with `ui-response`. The host races every writable guest against its own terminal dialog, and the first answer wins. When the question ends anywhere else, the host sends `ui-request-end` and the card goes away. After a reconnect, the host sends the questions that still wait again. Read-only rooms receive no questions.

### Why the server joins every terminal session

Subagent status lives in the host's memory. The session files on disk cannot tell an idle subagent from a parked one. The guest connection is the one source the protocol offers for live status, and the host already leaves advisor rows out of it. Joining every session keeps those rows current for sessions that you have not opened, and keeps each room ready for a prompt.

The cost is visible on each host and on its relay (`collab.relayUrl`, by default an internet relay):

- Each listed session counts `omp-agents` as one more participant for as long as the dashboard runs. The terminal shows that the guest joined.
- Each session sends its full transcript snapshot through the relay when the dashboard joins it, and every live event after that. The dashboard ignores the snapshot. Transcripts never travel through the relay.
- The text that says what a subagent is doing comes from live progress events. After the dashboard restarts, a subagent's link shows only its status until that subagent reports progress again.

Stop the dashboard to leave every room.

## Dashboard sessions

Sessions started from the dashboard are omp child processes in RPC mode with tool dialogs (`--mode rpc-ui`, NDJSON over stdio), spawned through omp's own `RpcClient` from this same package's CLI. The page starts one with a single `start` request whose `kind` is `new`, `fork`, or `resume`, and the server answers each with one `started` reply that carries the new session's instance id or the error. The server picks the instance id before omp spawns, so a question that omp raises while the session opens already belongs to it. A new session's first message rides on the `start` request: the server spawns omp, sends the message as its first prompt, and answers the page as soon as omp reports ready, with no terminal, registry, or relay involved. **Resume** spawns the same child in the directory that the session file's header records and opens the file with omp's `switch_session` command. Prompts, Stop, live events, subagent progress, and questions stay on the pipe. A prompt carries omp's `streamingBehavior`, `steer` or `followUp`, so omp queues it during a turn the way its terminal does. The composer's queue is omp's `queue_update` event, and taking a message back is `remove_queued_message`. Plain `--mode rpc` gives the session no `ask` tool. `rpc-ui` gives it one, and omp sends the `ask` steps and extension dialogs as `extension_ui_request` frames. omp's `RpcClient` reads those frames but only hands them to its own login flow, so the server reads a copy of the child's stdout through omp's JSONL reader and chunk decoder. It writes the `extension_ui_response` to the child's stdin as one line, the way `RpcClient` writes its own commands. omp sends a `cancel` frame when a question ends without an answer, for example after Stop. A question with a timeout ends with no frame, so the server drops it at its deadline. omp's RPC mode does not title a session from its first prompt, as its terminal does. While a session has no title, each user message's `message_end` event makes the server send a bare `/rename` prompt, which omp runs as its own command: it titles the session from the conversation in the background and announces the title with a `session_info_update` frame. `RpcClient` drops that frame too, so the same stdout copy reads it, and the server then reads omp's state again for the new `sessionName`. Stopping the dashboard stops every session that it started. The transcripts stay on disk, and **Resume**, or `omp --resume <session id>` in a terminal, continues one.

A subagent of a dashboard session takes a message through omp's `steer_subagent` command and stops with `cancel_subagent`; both reach only a subagent that runs, so the server offers them only for rows whose status is `running`. A prompt that starts with `!` goes to omp's `bash` command, which runs it in the session's directory and records a `bashExecution` message in the session file; the transcript shows that message as the user's command and output. omp appends that record without the lock churn that the watcher reports on macOS, so the server re-reads the file itself once `bash` answers. A built-in slash command runs from a plain `prompt`, and omp sends what it prints as `command_output` frames and a model switch as `config_update`. `RpcClient` drops both, so the same stdout copy reads them: the server shows the output as a notice when the user's last prompt was a `/` command, which leaves out what the titling `/rename` prints, and reads omp's state again after a model switch.

## Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI. omp builds those reports from its auth storage, extensions, and credential broker, so the server reads the command's output instead of rebuilding that setup. omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code. When the output is not a usage report, the footer shows the last line omp wrote to stderr.

## HTTP API

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace. The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`). It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk. Each file carries the SHA-256 of its text. `GET /api/models` runs `omp models --json` for the pickers.

Edits go through two endpoints, each taking the same `?cwd=` and answering with the settings as they load after the write:

- `PUT /api/settings/routing` takes one change: a role's model or fallbacks, a model-keyed chain, some `retry.*` values, or the provider order. The server writes it through omp's own write path, the one `omp config set` uses: `Settings.loadIsolated`, the setting's `set` or `setEntry`, and `flush`. omp re-reads `config.yml` under its lock and writes back only the paths that changed. A model must be one that `omp models` lists, read by omp's `parseRetryFallbackSelector`, so `provider/id:level` works even when the id holds a colon. A selector that the config already names passes as it is, so keeping an entry never blocks a save. omp checks each retry value against the setting's type and allowed values. If omp cannot load `config.yml`, the write is refused, because omp would move the broken file aside before it writes.
- `PUT /api/settings/file` takes `{ path, text, baseHash }`. The server runs discovery again for that `cwd` and writes only a path that it finds there, never one the page invents. `baseHash` must match the file's current hash, or `null` for a missing file. Otherwise the server answers 409 with `conflict: true`. The server resolves symlinks, writes a temporary file beside the real file with its mode, and renames it over the real file, so a symlinked file stays a link and a crash cannot leave a truncated file. Saves run one at a time, so two saves of the same file cannot both pass the hash check.

Every response from these endpoints is JSON. An error is `{ error, conflict? }` with the HTTP status. Any other `/api/` path answers a JSON 404. The page reports a response that is not JSON with its status and text. Every endpoint needs the access token's cookie; see [SECURITY.md](../SECURITY.md).

`PUT /api/pull-request/sessions` takes `{ owner, repo, number, sessionIds }`, the link button's request. The server refuses a session that did not submit or work on that pull request by the rules in [Pull requests and the inbox](usage.md#pull-requests-and-the-inbox). It reads the description with `gh api repos/<owner>/<repo>/pulls/<number>`, puts the session block in it, and writes it back with `gh api --method PATCH` only when the text changed. The answer is `{ changed }`, or `{ error }` with the HTTP status.

## Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`. The roster uses `sidebar`, and its **Inbox** and **Sessions** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`. User and assistant turns use `chat-message`, tool calls use `thinking-steps`, and the composer uses `input-message`. `thinking-indicator` shows while the agent works. shadcn's `message-scroller` follows streaming content, preserves the reader's scroll position, and supplies the jump-to-latest button. The model, thinking, and project pickers use shadcn's `popover` and `command` combobox pattern. Fluid's built-in sidebar rail resizes by pointer only and collapses on click. The dashboard turns it off and uses `web/components/sidebar-panel.tsx`, which gives each sidebar its own width and open state, because Fluid's provider holds only one of each.

Fluid Functionalism has no sheet, so the inbox's pull request sheet, `web/components/ui/sheet.tsx`, follows the sidebar's mobile sheet: Radix `Dialog` for focus and dismissal, and a framer-motion slide on the `moderate` spring.

The sidebar rows' menus use Base UI's `ContextMenu` for right-click and its `Menu` for the **⋯** button, wrapped in `web/components/ui/menu.tsx` with the look of the `popover` and `command` items. Both share Base UI's menu items, so each row builds one item list and both menus render it. The wrapper also opens the context menu on the context-menu key and Shift+F10 at the focused row, because not every platform sends a `contextmenu` event for them.

Questions use Fluid's `ask-user-questions`, installed from `https://www.fluidfunctionalism.com/r/radix/ask-user-questions.json`, in `web/components/user-request.tsx`. Each question is one Fluid question with one row per omp option. A confirm is a question with **Yes** and **No** rows, and an input or an editor is a free-text question.

## Code layout

The server lives in `src/`:

- `src/server.ts`: the entry point. Builds the page, loads the access token, starts the HTTP and WebSocket server, watches the sessions directory, and wires the modules below together. `PORT` sets the port, 4317 by default.
- `src/server/http.ts`: the request checks (`Host`, `Origin`, `Sec-Fetch-Site`, the token cookie) and the JSON answer helpers. `src/server/auth.ts` keeps the token file and parses the cookie, and `src/server/page.ts` bundles `web/index.html` in memory and serves it only to a signed-in browser.
- `src/server/routes.ts`: the `/api/` endpoints. `src/server/wire.ts` parses every socket message and request body into typed values.
- `src/server/socket.ts`: handles each socket message. `src/server/start.ts` starts, forks, and resumes dashboard sessions for the page's `start` request.
- `src/server/live-sessions.ts`: the one registry of running sessions, terminal and dashboard alike, each behind the `LiveSession` interface in `src/live-session.ts`. It builds the roster rows.
- `src/server/session-files.ts`: the session files on disk, re-read file by file as the watcher reports them, and the past list. `src/server/views.ts` points each open view at its file and folds live events into it.
- `src/shared.ts`: every type that crosses the socket or the HTTP API (`RosterHost`, `PastSession`, `SessionWork`, `ServerMsg`, `ClientMsg`, the inbox and pull request shapes).
- `src/omp/`: the facades over omp's modules: `modules.ts` loads them, `install.ts` finds the package and its CLI, and `collab.ts`, `rpc.ts`, `sessions.ts`, `config.ts`, `discovery.ts`, `models.ts`, and `prompts.ts` wrap one area each.
- `src/proc.ts` runs subprocesses, `src/json.ts` narrows untyped JSON, and `src/paths.ts` names the home directory and the token file.
- `src/dashboard-session.ts`: drives one session that the dashboard started, over RPC.
- `src/guest.ts`: runs one Collab guest per terminal session. `src/subagents.ts` finds each subagent's transcript file.
- `src/user-requests.ts`: parses the RPC and Collab question frames into one request shape, writes the answers back, and keeps each session's pending questions.
- `src/commands.ts`: the composer's `/` and `@` completions, and the expansion of file commands and skills before a guest prompt.
- `src/tail.ts`: reads one transcript file incrementally and feeds each entry to both folds below.
- `src/transcript.ts`: folds session-file lines and live events into display items.
- `src/work.ts`: folds session-file lines into the plan and changes: the latest todo list and the files changed.
- `src/pull-requests.ts`: finds the pull requests each session submitted or worked on.
- `src/session-links.ts`: writes the session block into a pull request's description.
- `src/inbox.ts`: maps each workspace to its GitHub repository, reads the inbox's pull requests with one `gh api graphql` call per repository, and reads one pull request's details with one more. A row's `conflicts` is true when GraphQL's `mergeable` is `CONFLICTING`.
- `src/usage.ts`: runs `omp usage --json` and parses it into plan windows.
- `src/settings.ts`: builds the settings page's model routing and file list, and checks and saves its edits.
- `src/test-env.ts`: points `PI_CODING_AGENT_DIR` at a temporary directory. `bunfig.toml` preloads it for tests, so they never touch `~/.omp/agent`.

The page lives in `web/`. `src/server/page.ts` bundles `web/index.html` and `web/main.tsx` with `Bun.build`, and `bun-plugin-tailwind` compiles Tailwind v4:

- `web/app.tsx`: the page shell, which holds the sidebars, the pane grid, the routes for the inbox, settings, and new-session pages, and focus handling.
- `web/use-dashboard.ts`: the socket, the page state, and the URL hash. `web/starts.ts` holds the sessions the page is starting, whether new, forked, resumed, or started by an inbox quick action.
- `web/pane-store.ts`: each open view's transcript, plan and changes, and completions, outside the page state, so a token in one pane re-renders only that pane.
- `web/routing.ts`, `web/sessions.ts`, `web/labels.ts`, `web/inbox-model.ts`, and `web/transcript-view.ts`: the pure transforms from server messages to what the page renders, and the hash routes.
- `web/quick-actions.ts`: the inbox's quick actions, which pull requests each applies to and the prompt that starts its session.
- `web/api.ts`: every HTTP request the page makes. `web/settings-api.ts` holds the settings page's requests.
- `web/use-inbox.ts`: the inbox cache that the sidebar and the inbox page share, one entry per project.
- `web/use-pull-request.ts`: reads the details of the pull request that the inbox's sheet shows.
- `web/shortcuts.ts`: the keyboard shortcut table, which both the key listeners and the shortcut dialog read. `web/components/session-switcher.tsx` is the Cmd+K search over every session.
- `web/theme.ts`: the light, dark, or system theme, which `web/main.tsx` applies before the first render and the settings page changes.
- `web/components/roster.tsx`: the left sidebar's session and inbox lists, and the project picker.
- `web/components/pane.tsx`: a pane. `conversation.tsx` holds its header and composer, and `transcript.tsx` its transcript, whose `task` rows link to their subagents.
- `web/components/plan-panel.tsx`: the right sidebar's plan and changes for the focused pane.
- `web/components/inbox/`, `web/components/settings/`, and `web/components/new-session.tsx`: the other pages.
- `web/components/ui`, `web/lib`, and `web/hooks`: mostly files from the Fluid registry; see below.

`templates/omp/` holds the omp starter kit and its installer, `templates/omp/install.ts` (`bun run omp-template`). Its `agent/` files are copies of the maintainer's `~/.omp/agent` files, except for `AGENTS.md`, which is a generic version. After you edit one of those live files, copy it back. `bun run omp-template --dry-run` shows a copy that has drifted as `keep yours`.

Changes the dashboard makes to Fluid's components:

- It adds an `onKeyDown` hook to `InputMessage`, so the completion list can intercept arrow keys, Tab, Enter, and Esc before the normal submit behavior.
- It replaces `InputMessage`'s queue, which held every message sent during a response in the browser, with rows that the page passes in, each with a tag and edit and remove callbacks, because omp or the server holds the queue.
- It adds a `header` prop to `AskUserQuestions`, which replaces the `Question 1 of 1` line with the question's status and **Dismiss**, and a `description` field for a question, which shows a confirm's message.

Markdown uses `react-markdown`, `remark-gfm`, and `rehype-highlight` (`web/components/message-markdown.tsx`). In agent text, raw HTML is escaped, unsafe link schemes are filtered, and an image renders as a link unless it is a `data:` URL. Text from GitHub, which means pull request descriptions and comments, renders its raw HTML through `rehype-raw` and then `rehype-sanitize` with its default schema, which follows GitHub's, and keeps images only from GitHub's image hosts. `web/index.html` sets the page's `Content-Security-Policy`.
