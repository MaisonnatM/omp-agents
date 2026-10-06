# Agent guide

omp-agents is a local web dashboard for omp sessions.
Before you list files or change behaviour, read [docs/usage.md](docs/usage.md) for what the interface does and [docs/architecture.md](docs/architecture.md) for how the server works; its [Code layout](docs/architecture.md#code-layout) section lists what each file is for.
Before you write code or Markdown, read [CODING_STANDARDS.md](CODING_STANDARDS.md).

## New worktree

Run `bun install --frozen-lockfile` first.
Without it, `tsc` fails with `Cannot find type definition file for 'bun'`.
Do not symlink `node_modules` from the main checkout.
When the worktree already has a `node_modules` directory, `ln -s` creates a stray `node_modules/node_modules` link inside it, and `rm node_modules` then fails.

## Checks

Before you finish, run the checks in [CONTRIBUTING.md](CONTRIBUTING.md#checks), including the desktop type check after you change `desktop/`.

## Smoke checks

- Before starting or stopping a server, read [Server lifecycle and authentication](docs/agent-smoke.md#server-lifecycle-and-authentication).
- Before browser verification, also read [Browser smoke](docs/agent-smoke.md#browser-smoke).
- Before desktop verification, also read [Desktop smoke](docs/agent-smoke.md#desktop-smoke).

## omp internals

Before you read omp's source, read its docs: `omp://rpc.md` (RPC frames and commands), `omp://session.md` (session file format), `omp://collab.md`, and `omp://extensions.md`.
Then read [omp modules](docs/architecture.md#omp-modules), which lists the source files this app uses.
After you read omp's source to learn a subsystem, add its files and the exports you used there, so the next agent starts there.

## Where changes go

- A new field on a session row: `RosterHost` or `PastSession` in `src/shared/sessions.ts`, then `row()` in `src/guest.ts` and `src/dashboard-session.ts` (both implement `LiveSession` in `src/live-session.ts`) for what a transport knows, `rows()` in `src/server/live-sessions.ts` for what every live session shares, or `factsOf`/`past` in `src/server/session-files.ts` for what the session files tell, then `web/components/session-row.tsx` and the header in `web/components/conversation-header.tsx`.
- A socket message: `ClientMsg` or `ServerMsg` in `src/shared/protocol.ts`, parsed in `src/server/wire.ts`, handled in `src/server/socket.ts` and `web/use-dashboard.ts`.
- A keyboard shortcut: the table in `web/shortcuts.ts`.
  Both the key listeners and the shortcut dialog read it.

## Docs to update

- `docs/usage.md` when the interface changes, and `docs/architecture.md` when the server, a protocol, or the code layout changes.
  The README only covers features, installation, and configuration.
- `templates/omp/agent/AGENTS.md` carries worktree and force-push safety.
  The maintainer git profile, `templates/omp/maintainer/`, is installed only with `bun run omp-template --maintainer`.
  After you edit one of its installed files (`AGENTS.md` or `docs/git-workflow.md`), copy it into the matching template.
  `bun run omp-template --dry-run` lists a copy that has drifted as `keep yours`.
