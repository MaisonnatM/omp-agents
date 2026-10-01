# omp-agents

A local web dashboard for the omp sessions running on this machine. The sidebar lists every live session with its status, working directory, and model, and nests each session's subagents under it. Select a session or a subagent to read its conversation as it happens and to message it. You can also interrupt a session's turn.

## Run it

```sh
bun install
bun start
```

Open <http://127.0.0.1:4317>. To use another port, set `PORT`, for example `PORT=5000 bun start`.

## Requirements

- Bun 1.4 or later. Tested with Bun 1.4.2.
- omp installed with Bun (`bun install -g @oh-my-pi/pi-coding-agent`) and on your `PATH`. Tested with omp 18.4.6.
- `collab.autoStart` set to `control`, so that sessions publish themselves to the local Collab registry:

  ```sh
  omp config set collab.autoStart control
  ```

  Only sessions that start hosting after the change appear. Restart a session that was already running, or run `/new` or `/collab` inside it. With `view`, the dashboard shows those sessions read-only.

If `omp` is not on your `PATH`, or `omp` resolves to a build that does not ship its sources, set `OMP_PACKAGE_DIR` to the installed `@oh-my-pi/pi-coding-agent` directory.

## Use it

- The dot before each session shows its state. Green means a turn is running, grey means idle, and amber means a question waits for an answer in the terminal.
- Subagents appear indented under their session, nested by parent. Each row shows the subagent's id, its type, its status (`running`, `idle`, `parked`, or `aborted`), and what it is doing.
- Select a row to open it. The selection is in the URL hash, so a reload or a bookmark returns to it.
- In a session, a message sent while a turn runs waits in the composer's queue until the turn ends. **Stop** interrupts the turn.
- In a subagent, a message steers a running subagent, prompts an idle one, and revives a parked one. The composer is disabled for aborted subagents and read-only rooms.
- Drag the sidebar's right edge to resize it. With the edge focused, the arrow keys resize in steps (hold Shift for bigger steps), and Home and End jump to the narrowest and widest sizes. Double-click the edge to reset the width. The width is saved in the browser's localStorage.

## How it works

The server imports omp's own collab modules from the installed package (`src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`). It does not reimplement the protocol or the encryption, so it always speaks the same version as the sessions it watches.

- Every 1.5 seconds the server lists the local hosts through the registry. That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would. The host's welcome snapshot fills the session transcript. Live agent events then stream assistant text and tool calls to the page over a local WebSocket.
- The same guest receives the host's subagent registry (`agents` frames) and its subagent progress (`bus` frames). That is what fills the nested rows for every session, including the ones you have not opened.
- When you open a subagent, the server reads its transcript with `fetch-transcript` from byte 0. It then keeps asking from the returned `newSize` once a second while any tab shows that subagent.
- The prompt and Stop actions use the guest protocol's `prompt` and `abort` frames. Subagent messages use `agent-cmd` `chat`. The host itself steers, prompts, or revives the subagent.
- If a host starts a new room, for example after `/new` or `/resume`, the server sees the new generation and joins the new room. If the link request races the switch and fails with `stale_generation`, the server lists again and retries. A host that leaves the registry is marked as no longer running.

Questions that the host asks through a dialog appear as a notice. Answer them in the omp terminal.

### Why the server joins every session

Subagent status lives in the host's memory. The session files on disk cannot tell an idle subagent from a parked one. The guest connection is the one source the protocol offers for live status, and the host already leaves advisor rows out of it. Joining every session also makes opening a subagent instant, because the room is already open.

The cost is visible on each host:

- Each listed session counts `omp-agents` as one more participant for as long as the dashboard runs. The terminal shows that the guest joined.
- Each session sends its full transcript snapshot to the dashboard when the dashboard joins it.
- The text that says what a subagent is doing comes from live progress events. After the dashboard restarts, a subagent row shows only its status until that subagent reports progress again.

Stop the dashboard to leave every room.

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`. The roster uses `sidebar`, user and assistant turns use `chat-message`, tool calls use `thinking-steps`, and the composer uses `input-message`. `thinking-indicator` shows while the agent works. Fluid's built-in sidebar rail resizes by pointer only and collapses on click. The dashboard turns it off and uses `web/components/sidebar-resize-handle.tsx`, which drives the same sidebar width.

## Security

A control link gives full control of the session. Anyone who holds it can read the whole conversation, prompt the agent, and message its subagents. The agent runs tools on your machine. The dashboard treats it that way:

- The server listens on `127.0.0.1` only.
- Links and room keys exist only in server memory, inside the function that opens the room. The server never writes them to disk, never logs them, and never sends them to the page.
- The WebSocket accepts only connections whose `Host` is `127.0.0.1:<port>` or `localhost:<port>` and whose `Origin` matches it. Other websites open in your browser cannot drive your sessions through it, and DNS rebinding does not get around the check.
- Anything that can reach the dashboard on loopback can prompt every listed session. Do not expose the port through a tunnel or a proxy.

## Develop

```sh
bun test           # transcript reducer and view-model tests
bun run typecheck
```

The server lives in `src/`. `src/omp.ts` loads the omp modules. `src/guest.ts` runs one guest per listed session and tails subagent transcripts. `src/transcript.ts` turns frames into display items. `src/server.ts` serves the page and the WebSocket.

The page lives in `web/`. Bun's HTML import bundles it, and `bun-plugin-tailwind` (set in `bunfig.toml`) compiles Tailwind v4. `web/use-dashboard.ts` holds the socket and the page state. `web/view-model.ts` holds the pure transforms. Files in `web/components/ui`, `web/lib`, and `web/hooks` come from the Fluid registry, so update them with the shadcn CLI rather than by hand.
