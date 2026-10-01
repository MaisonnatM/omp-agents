# omp-agents

A local web dashboard for the omp sessions on this machine. The sidebar lists every live session with its status, working directory, and model, and nests each session's subagents under it. Select a session or a subagent to read its conversation as it happens and to message it. You can also interrupt a session's turn, start a new session, and read the transcript of a past session.

## Run it

```sh
bun install
bun start
```

Open <http://127.0.0.1:4317>. To use another port, set `PORT`, for example `PORT=5000 bun start`.

## Requirements

- Bun 1.4 or later. Tested with Bun 1.4.2.
- omp installed with Bun (`bun install -g @oh-my-pi/pi-coding-agent`) and on your `PATH`. Tested with omp 18.4.8.
- For sessions that you start in a terminal: `collab.autoStart` set to `control`, so that they publish themselves to the local Collab registry:

  ```sh
  omp config set collab.autoStart control
  ```

  Only sessions that start hosting after the change appear. Restart a session that was already running, or run `/new` or `/collab` inside it. With `view`, the dashboard shows those sessions read-only. Sessions that the dashboard starts do not need this setting.

If `omp` is not on your `PATH`, or `omp` resolves to a build that does not ship its sources, set `OMP_PACKAGE_DIR` to the installed `@oh-my-pi/pi-coding-agent` directory.

## Use it

- The dot before each session shows its state. Green means a turn is running, grey means idle, and amber means a question waits for an answer in the terminal.
- Subagents appear indented under their session, nested by parent. Each row shows the subagent's id, its type, its status (`running`, `idle`, `parked`, or `aborted`), and what it is doing.
- Select a row to open it. The selection is in the URL hash, so a reload or a bookmark returns to it. A past session's hash is `#past/<session id>`.
- In a session, a message sent while a turn runs waits in the composer's queue until the turn ends. **Stop** interrupts the turn.
- In a subagent of a terminal session, a message steers a running subagent, prompts an idle one, and revives a parked one. The composer is disabled for aborted subagents, read-only rooms, and the subagents of sessions that the dashboard started, because omp's RPC mode has no command that reaches a subagent.
- To start a session, click **+** next to the session count, enter a working directory, and click **Start**. The field starts with the directory of the open session, else of the newest live session, else of the newest past session. It accepts an absolute path, a path that starts with `~`, or a path relative to your home directory. When omp is ready, the dashboard opens the session.
- A session that the dashboard started shows **End session** in its header. **End session** stops its omp process. The session then moves to the past sessions.
- The past sessions list every saved session that has no live host, newest first, with its title (else its first prompt), its working directory, and how long ago it last changed. Select one to read its transcript. The page cannot write to it. A session that runs without publishing itself to the registry also appears in this list, and its transcript keeps updating while it runs.
- Click **Fork from here** under a prompt or a turn's last reply to start a dashboard session that holds the conversation up to that point, as omp's `/branch` does. A fork from a prompt leaves that prompt out of the history and puts it in the composer, so you can edit and resend it. omp writes the fork to a new session file and does not change the original. A session whose omp process exited mid-turn cannot be forked until you resume it in omp once, because opening it would make omp append an abort record to the original.
- Drag the sidebar's right edge to resize it. With the edge focused, the arrow keys resize in steps (hold Shift for bigger steps), and Home and End jump to the narrowest and widest sizes. Double-click the edge to reset the width. The width is saved in the browser's localStorage.
- Type `/` to complete discovered file commands and `/skill:<name>` skills. Type `@` to find files in the selected session's working directory. Use arrow keys, Tab or Enter to insert a suggestion, and Esc to close the list. File suggestions follow Git ignore rules in Git repositories.
- User and assistant messages render GitHub-flavored Markdown, including tables, task lists, fenced code, and links.

The dashboard cannot run omp's built-in `/` commands, `$` Python shortcut, or `!` shell shortcut. Collab accepts guest prompts, not host-side TUI commands or direct access to the host's Python kernel. Those inputs return an error in the conversation instead of silently sending literal text to the agent. Run them in the omp terminal.

## How it works

The server imports omp's own modules from the installed package: the Collab modules (`src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`), the session listing (`src/session/session-listing.ts`), and the RPC client (`src/modes/rpc/rpc-client.ts`). It does not reimplement a protocol, the encryption, or the session-file format, so it always speaks the same version as the sessions it shows.

Every transcript comes from the session files on this machine, not from a network connection:

- One recursive file watcher covers omp's sessions directory. When a file changes, every open transcript in that directory reads the bytes appended since its last read and folds the complete JSONL lines into display items. On macOS a burst of appends can surface only as events for omp's `.<file>.lock` sidecar, which is why a change anywhere in a directory re-reads every open transcript in it.
- A session's transcript is its `<time>_<session id>.jsonl` file. A subagent's transcript is `<id>.jsonl` in its parent's artifacts directory, which is the parent's transcript path without `.jsonl`. A subagent that outlived a `/new` or `/resume` wrote beside the session it started in, so when the expected file is missing the server looks for the newest `<id>.jsonl` in the project's sessions that changed after the subagent registered.
- A past session reads the same way, so a session that runs without publishing itself keeps updating.
- Live agent events only add what the file does not hold yet: the reply as it streams, and the running state of tool calls. omp keeps a message's `timestamp` when it writes the message, so the file's copy replaces the streamed copy in place, and a late event cannot undo it. omp writes a fresh session's file only with its first reply. Until then the prompt shows from its live event, except a prompt sent from the dashboard to a terminal session, whose file entry has no message timestamp to merge on.
- The server lists the session files through omp's session listing, the code behind omp's session picker, when the watcher reports a change in a project directory, at most twice a second. The past list skips the empty sessions that omp's picker hides. The server looks up files by session id in this listing, so the page never sends a path.

Sessions started in a terminal are reached through their Collab room:

- Every 1.5 seconds the server lists the local hosts through the registry. That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would. The guest is how the dashboard prompts a session (`prompt` frames), stops a turn (`abort`), and messages a subagent (`agent-cmd` `chat`; the host steers, prompts, or revives it). It also carries the host's subagent registry (`agents` frames), subagent progress (`bus` frames), and the live agent events. The composer enables as soon as the host welcomes the guest. Nothing waits on the transcript snapshot that the host then sends.
- The dashboard uses omp's discovery and autocomplete modules for file commands, skills, and file mentions. It expands file commands and skills before guest prompt delivery because Collab prompts bypass the host's slash-command pipeline. The host still resolves `@file` references in the selected session's working directory.
- If a host starts a new room, for example after `/new` or `/resume`, the server sees the new generation and joins the new room. If the link request races the switch and fails with `stale_generation`, the server lists again and retries. A host that leaves the registry is marked as no longer running.

Sessions started from the dashboard are omp child processes in RPC mode (`--mode rpc`, NDJSON over stdio), spawned through omp's own `RpcClient` from this same package's CLI. **Start** answers the page as soon as omp reports ready, with no terminal, registry, or relay involved. Prompts, Stop, live events, and subagent progress stay on the pipe. RPC mode has no UI, so the session never blocks on a dialog that nobody can answer. Stopping the dashboard stops every session that it started. The transcripts stay on disk, and `omp --resume <session id>` continues one in a terminal.

Questions that a terminal session asks through a dialog appear as a notice. Answer them in the omp terminal.

### Why the server joins every terminal session

Subagent status lives in the host's memory. The session files on disk cannot tell an idle subagent from a parked one. The guest connection is the one source the protocol offers for live status, and the host already leaves advisor rows out of it. Joining every session keeps those rows current for sessions that you have not opened, and keeps each room ready for a prompt.

The cost is visible on each host and on its relay (`collab.relayUrl`, by default an internet relay):

- Each listed session counts `omp-agents` as one more participant for as long as the dashboard runs. The terminal shows that the guest joined.
- Each session sends its full transcript snapshot through the relay when the dashboard joins it, and every live event after that. The dashboard ignores the snapshot. Transcripts never travel through the relay.
- The text that says what a subagent is doing comes from live progress events. After the dashboard restarts, a subagent row shows only its status until that subagent reports progress again.

Stop the dashboard to leave every room.

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`. The roster uses `sidebar`, user and assistant turns use `chat-message`, tool calls use `thinking-steps`, and the composer uses `input-message`. `thinking-indicator` shows while the agent works. Fluid's built-in sidebar rail resizes by pointer only and collapses on click. The dashboard turns it off and uses `web/components/sidebar-resize-handle.tsx`, which drives the same sidebar width.

## Security

A control link gives full control of the session. Anyone who holds it can read the whole conversation, prompt the agent, and message its subagents. The agent runs tools on your machine. The dashboard treats it that way:

- The server listens on `127.0.0.1` only.
- Links and room keys exist only in server memory, inside the function that opens the room. The server never writes them to disk, never logs them, and never sends them to the page.
- The page names a past session by its id and a subagent by the id its host registered. The server reads only files from omp's own session listing, the paths omp reports over RPC, and subagent files under those sessions' directories.
- The WebSocket accepts only connections whose `Host` is `127.0.0.1:<port>` or `localhost:<port>` and whose `Origin` matches it. Other websites open in your browser cannot drive your sessions through it, and DNS rebinding does not get around the check.
- Anything that can reach the dashboard on loopback can prompt every listed session and start omp in any directory that you can read. Do not expose the port through a tunnel or a proxy.

## Develop

```sh
bun test           # transcript reducer, file tail, and view-model tests
bun run typecheck
```

The server lives in `src/`. `src/omp.ts` loads the omp modules, lists the session files, and starts RPC children. `src/tail.ts` reads one transcript file incrementally. `src/transcript.ts` folds session-file lines and live events into display items. `src/guest.ts` runs one Collab guest per terminal session. `src/dashboard-session.ts` drives one session that the dashboard started. `src/server.ts` serves the page and the WebSocket, watches the sessions directory, and points each open view at its file.

The page lives in `web/`. Bun's HTML import bundles it, and `bun-plugin-tailwind` (set in `bunfig.toml`) compiles Tailwind v4. `web/use-dashboard.ts` holds the socket and the page state. `web/view-model.ts` holds the pure transforms. Most files in `web/components/ui`, `web/lib`, and `web/hooks` come from the Fluid registry. The dashboard adds an `onKeyDown` hook to Fluid's `InputMessage` so the completion list can intercept arrow keys, Tab, Enter, and Esc before the normal submit behavior. Markdown uses `react-markdown`, `remark-gfm`, and `rehype-highlight`; raw HTML is escaped and unsafe link schemes are filtered by default.
