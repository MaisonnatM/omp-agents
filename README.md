# omp-agents

A local web dashboard for the omp sessions running on this machine. The left side lists every live session with its status, working directory, and model. The right side shows the selected session's conversation as it happens, and lets you send a prompt or interrupt the agent.

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

## How it works

The server imports omp's own collab modules from the installed package (`src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`). It does not reimplement the protocol or the encryption, so it always speaks the same version as the sessions it watches.

- Every 1.5 seconds the server lists the local hosts through the registry. That is the same call that backs `omp collab list`. Each row becomes a roster entry with a status: **needs input** when a question waits for an answer, **working** while a turn runs, and **idle** otherwise.
- When you select a session, the server asks that host for its control link and joins the room as a guest named `omp-agents`, as `omp join` would. The host's welcome snapshot fills the transcript. After that, live agent events stream assistant text and tool calls into the page over a local WebSocket.
- Send and Interrupt become the guest protocol's `prompt` and `abort` frames.
- The server leaves the room when no open tab watches the session. While you watch a session it counts as one extra participant on the host.
- If a host starts a new room, for example after `/new` or `/resume`, the server notices the new generation and joins the new room. If the link request races the switch and fails with `stale_generation`, the server lists again and retries. A host that leaves the registry is marked as no longer running.

Questions that the host asks through a dialog appear as a notice. Answer them in the omp terminal.

## Security

A control link gives full control of the session. Anyone who holds it can read the whole conversation and prompt the agent, and the agent runs tools on your machine. The dashboard treats it that way:

- The server listens on `127.0.0.1` only.
- Links and room keys exist only in server memory, inside the function that opens the room. The server never writes them to disk, never logs them, and never sends them to the page.
- The WebSocket accepts only connections whose `Host` is `127.0.0.1:<port>` or `localhost:<port>` and whose `Origin` matches it. Other websites open in your browser cannot drive your sessions through it, and DNS rebinding does not get around the check.
- Anything that can reach the dashboard on loopback can prompt every listed session. Do not expose the port through a tunnel or a proxy.

## Develop

```sh
bun test           # transcript reducer tests
bun run typecheck
```

`src/omp.ts` loads the omp modules. `src/guest.ts` runs one guest per watched session. `src/transcript.ts` turns frames into display items. `src/server.ts` serves the page and the WebSocket. The page lives in `public/`.
