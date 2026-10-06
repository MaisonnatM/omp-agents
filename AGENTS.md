# Agent guide

omp-agents is a local web dashboard for omp sessions.
A Bun server lives in `src/` and a React page in `web/`.
[docs/usage.md](docs/usage.md) covers what the interface does.
[docs/architecture.md](docs/architecture.md) covers how the server works, and its [Code layout](docs/architecture.md#code-layout) section lists what each file is for.
Start there instead of listing files.

## New worktree

Run `bun install --frozen-lockfile` first.
It takes about a second from Bun's cache.
Without it, `tsc` fails with `Cannot find type definition file for 'bun'`.
Do not symlink `node_modules` from the main checkout.
When the worktree already has a `node_modules` directory, `ln -s` creates a stray `node_modules/node_modules` link inside it, and `rm node_modules` then fails.

## Checks

```sh
bun test            # preloads src/test-env.ts, so tests never touch ~/.omp/agent
bun run typecheck   # tsc --noEmit over src, web, and templates/omp
```

After you change `desktop/`, also run `bun install --cwd desktop --frozen-lockfile` once and `bun run --cwd desktop typecheck`.

## Smoke checks

- Before starting or stopping a server, read [Server lifecycle and authentication](docs/agent-smoke.md#server-lifecycle-and-authentication).
- Before browser verification, also read [Browser smoke](docs/agent-smoke.md#browser-smoke).
- Before desktop verification, also read [Desktop smoke](docs/agent-smoke.md#desktop-smoke).

## omp internals

The server runs omp's own modules from the installed package: `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`, or `OMP_PACKAGE_DIR`.
Only `src/omp/` imports them, all through `src/omp/modules.ts`, which checks each export this app uses at startup; add a new one there.
Read omp's docs before its source: `omp://rpc.md` (RPC frames and commands), `omp://session.md` (session file format), `omp://collab.md`, and `omp://extensions.md`.
[omp modules](docs/architecture.md#omp-modules) lists the source files this app uses.
`RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `startRpc` in `src/omp/rpc.ts` reads them from a copy of the child's stdout.

## Where changes go

- A new field on a session row: `RosterHost` or `PastSession` in `src/shared/sessions.ts`, then `row()` in `src/guest.ts` and `src/dashboard-session.ts` (both implement `LiveSession` in `src/live-session.ts`) for what a transport knows, `rows()` in `src/server/live-sessions.ts` for what every live session shares, or `factsOf`/`past` in `src/server/session-files.ts` for what the session files tell, then `web/components/session-row.tsx` and the header in `web/components/conversation-header.tsx`.
- A socket message: `ClientMsg` or `ServerMsg` in `src/shared/protocol.ts`, parsed in `src/server/wire.ts`, handled in `src/server/socket.ts` and `web/use-dashboard.ts`.
- A keyboard shortcut: the table in `web/shortcuts.ts`.
  Both the key listeners and the shortcut dialog read it.

## Docs to update

- `docs/usage.md` when the interface changes, and `docs/architecture.md` when the server, a protocol, or the code layout changes.
  The README only covers features, installation, and configuration.
- [omp modules](docs/architecture.md#omp-modules) after you read omp's source to learn a subsystem: add its files and the exports you used, so the next agent starts there.
- Every doc keeps one sentence per line; `src/docs.test.ts` checks root Markdown and all Markdown under `docs/` and `templates/omp/`, including nested agent instructions.
- `templates/omp/agent/` is the default starter kit.
  Its `AGENTS.md` keeps worktree and force-push safety and leaves out the maintainer git profile.
- `templates/omp/maintainer/` is that profile, `AGENTS.md` and `docs/git-workflow.md`, installed only with `bun run omp-template --maintainer`.
  After you edit one of those live files, copy it into the matching template.
  `bun run omp-template --dry-run` lists a copy that has drifted as `keep yours`.
