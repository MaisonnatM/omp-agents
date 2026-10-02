# Agent guide

omp-agents is a local web dashboard for omp sessions. A Bun server lives in `src/` and a React page in `web/`. [docs/usage.md](docs/usage.md) covers what the interface does. [docs/architecture.md](docs/architecture.md) covers how the server works, and its [Code layout](docs/architecture.md#code-layout) section lists what each file is for. Start there instead of listing files.

## New worktree

Run `bun install --frozen-lockfile` first. It takes about a second from Bun's cache. Without it, `tsc` fails with `Cannot find type definition file for 'bun'`. Do not symlink `node_modules` from the main checkout. When the worktree already has a `node_modules` directory, `ln -s` creates a stray `node_modules/node_modules` link inside it, and `rm node_modules` then fails.

## Checks

```sh
bun test            # preloads src/test-env.ts, so tests never touch ~/.omp/agent
bun run typecheck   # tsc --noEmit over src, web, and templates/omp
```

## Running it

- `bun start` serves `http://127.0.0.1:4317`. The user's own dashboard usually runs on that port, so start a smoke server on another one: `PORT=4391 bun src/server.ts` (as a named service, ready on port 4391).
- The server does not reload, and it serves the page bundle it built at startup. Restart it after you edit `src/` or `web/`.
- A session that you start from the smoke dashboard is a real omp session. Open `#new/%2Ftmp` to start one in `/tmp`, keep its prompt to something like `Reply with just the word ok. Use no tools.`, and end it with **End session**.

## Browser smoke

Open the page in managed headless Chromium. Without `relay: false`, `browser.open` tries the omp browser relay, then fails with "extension never connected" or times out after 30 s:

```js
const tab = await browser.open({
	name: "smoke",
	url: "http://127.0.0.1:4391/",
	app: { relay: false, tern: false },
	headed: false,
	wait_until: "domcontentloaded",
	timeout: 60000,
});
```

The page routes through the URL hash. Besides a session's own hash, the routes are `#inbox`, `#inbox/<owner>/<repo>/<number>`, `#new`, `#new/<encoded cwd>`, and `#settings`. `web/view-model.ts` parses them.

## omp internals

The server runs omp's own modules from the installed package: `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`, or `OMP_PACKAGE_DIR`. `src/omp.ts` is the only file that imports them. Read omp's docs before its source: `omp://rpc.md` (RPC frames and commands), `omp://session.md` (session file format), `omp://collab.md`, and `omp://extensions.md`. [omp modules](docs/architecture.md#omp-modules) lists the source files this app uses. `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `startRpc` in `src/omp.ts` reads them from a copy of the child's stdout.

## Where changes go

- A new field on a session row: `RosterHost` or `PastSession` in `src/shared.ts`, then `rosterHosts` in `src/server.ts`, then `web/components/roster.tsx` and the header in `web/components/conversation.tsx`.
- A socket message: `ClientMsg` or `ServerMsg` in `src/shared.ts`, handled in `src/server.ts` and `web/use-dashboard.ts`.
- A keyboard shortcut: the table in `web/shortcuts.ts`. Both the key listeners and the shortcut dialog read it.

## Docs to update

- `docs/usage.md` when the interface changes, and `docs/architecture.md` when the server, a protocol, or the code layout changes. The README only covers features, installation, and configuration.
- `templates/omp/agent/` copies the maintainer's `~/.omp/agent` files, except `AGENTS.md`, which is a generic version. After you edit one of those live files, copy it into the template. `bun run omp-template --dry-run` lists a copy that has drifted as `keep yours`.
