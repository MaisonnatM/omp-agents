# Coding standards

Every change meets [Every change](#every-change).
Then read the section for the work: [omp imports](#omp-imports), [omp internals](#omp-internals), [Where changes go](#where-changes-go), [Markdown](#markdown), or [Template sync](#template-sync).

## Every change

- Keep each pull request to one change, and explain why it is needed.
- Add or update tests for behavior you change.
- Run `bun test` and `bun run typecheck` and fix what they report.
  After you change `desktop/`, run `bun install --cwd desktop --frozen-lockfile` once and `bun run --cwd desktop typecheck`.
- Update `docs/usage.md` when the interface changes, and `docs/architecture.md` when the server, a protocol, or the code layout changes.
  The README holds only features, installation, and configuration.
- Bump the Bun and omp versions in `.github/workflows/checks.yml` together with the README's tested versions.

## omp imports

Import omp's code instead of reimplementing a protocol or file format.
Import omp's modules only from `src/omp/`, and only through `src/omp/modules.ts`.
It checks each export this app uses at startup, so add a new export there.

## omp internals

Read omp's docs before its source: `omp://rpc.md` (RPC frames and commands), `omp://session.md` (session file format), `omp://collab.md`, and `omp://extensions.md`.
Then read [omp modules](docs/architecture.md#omp-modules), which lists the source files this app uses.
After you read omp's source to learn a subsystem, add its files and the exports you used there, so the next agent starts there.

## Where changes go

- A new field on a session row: `RosterHost` or `PastSession` in `src/shared/sessions.ts`, then `row()` in `src/guest.ts` and `src/dashboard-session.ts` (both implement `LiveSession` in `src/live-session.ts`) for what a transport knows, `rows()` in `src/server/live-sessions.ts` for what every live session shares, or `factsOf`/`past` in `src/server/session-files.ts` for what the session files tell, then `web/components/session-row.tsx` and the header in `web/components/conversation-header.tsx`.
- A socket message: `ClientMsg` or `ServerMsg` in `src/shared/protocol.ts`, parsed in `src/server/wire.ts`, handled in `src/server/socket.ts` and `web/use-dashboard.ts`.
- A keyboard shortcut: the table in `web/shortcuts.ts`.

## Markdown

Write every Markdown file with one sentence per line.
Tools that read a doc cut a line at 768 characters, and an edit that copies the cut line back writes the truncation mark `…` into the file.
`src/docs.test.ts` fails a line over 700 characters or ending in `…`, in root Markdown and under `docs/` and `templates/omp/`, including nested agent instructions.

## Template sync

After you edit an installed file under `~/.omp/agent/` that `templates/omp/` also holds, copy it into the matching file there; [Code layout](docs/architecture.md#code-layout) says which of `agent/` and `maintainer/` holds it.
`bun run omp-template --dry-run` lists a copy that has drifted as `keep yours`.
