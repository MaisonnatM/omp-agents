# Coding standards

Every change meets [Every change](#every-change).
Then read the section for the work: [omp imports](#omp-imports), [omp internals](#omp-internals), [Where changes go](#where-changes-go), [Markdown](#markdown), or [Template sync](#template-sync).

## Every change

- Keep each pull request to one change, and explain why it is needed.
- Add or update tests for behavior you change.
- Run `bun test` and `bun run typecheck` and fix what they report.
  After you change `desktop/`, run `bun install --cwd desktop --frozen-lockfile` once and `bun run --cwd desktop typecheck`.
- Update `docs/usage/` when the interface changes, `docs/architecture/` when the server or a protocol changes, and `docs/code-layout/` when you add, move, or remove a file, or change what one does, including its [Interface map](docs/code-layout.md#interface-map) entry.
  Each of `docs/usage.md`, `docs/architecture.md`, and `docs/code-layout.md` lists its directory's files, one per feature; add a file there when you add one, and split a file before it reaches the 32 KiB that `src/docs.test.ts` allows.
  The README holds only features, installation, and configuration.
- Look a feature up in `docs/usage/` by the words the page shows, such as a button's or a tab's label, rather than by a code identifier, which the interface docs rarely name.
- Bump the tested omp version at all five of its pins together: `.github/workflows/checks.yml`, `.github/workflows/release.yml`, the README's omp badge and its `Tested with omp` line, and the `placeholder` in `.github/ISSUE_TEMPLATE/bug_report.yml`.
  Bump Bun's version in both workflows together with the README's.
  Check a new omp release with `bun run omp-release` and the [omp release skill](.agents/skills/omp-release/SKILL.md) before you bump it.
- A change to a file that [`.omp/review-paths`](.omp/review-paths) matches needs the thermonuclear review before it ships; add a file there when it becomes a shared contract or a central file.

## omp imports

Import omp's code instead of reimplementing a protocol or file format.
Import omp's modules only from `src/omp/`, and only through `src/omp/modules.ts`.
It checks each export this app uses at startup, so add a new export there.

## omp internals

Read omp's docs before its source: `omp://rpc.md` (RPC frames and commands), `omp://session.md` (session file format), `omp://collab.md`, and `omp://extensions.md`.
Then read [omp modules](docs/architecture/omp-modules.md), which lists the source files this app uses.
After you read omp's source to learn a subsystem, add its files and the exports you used there, so the next agent starts there.

## Where changes go

- A new field on a session row: `RosterHost` or `PastSession` in `src/shared/sessions.ts`, then `row()` in `src/guest.ts` and `src/dashboard-session.ts` (both implement `LiveSession` in `src/live-session.ts`) for what a transport knows, `rows()` in `src/server/live-sessions.ts` for what every live session shares, or `factsOf`/`past` in `src/server/session-files.ts` for what the session files tell, then `web/components/session-row.tsx` and the header in `web/components/conversation-header.tsx`.
- A socket message: `ClientMsg` or `ServerMsg` in `src/shared/protocol.ts`, parsed in `src/server/wire.ts`, handled in `src/server/socket.ts` and `web/use-dashboard.ts`.
- A keyboard shortcut: the table in `web/shortcuts.ts`.
- A control only the page sees, which no view, command, or action records: its id in `CONTROLS` in `src/shared/activity.ts`, spread `activityControl(id)` from `web/activity.ts` on it, and a row in the coverage table of `docs/architecture/activity.md`.

## Markdown

Write every Markdown file with one sentence per line.
Tools that read a doc cut a line at 768 characters, and an edit that copies the cut line back writes the truncation mark `…` into the file.
`src/docs.test.ts` fails a line over 700 characters or ending in `…`, in root Markdown and under `docs/` and `templates/omp/`, including nested agent instructions.

## Template sync

After you edit an installed file under `~/.omp/agent/` that `templates/omp/` also holds, copy it into the matching file there; [Starter kit and docs](docs/code-layout/starter-kit-and-docs.md) says which of `agent/` and `maintainer/` holds it.
`bun run omp-template --dry-run` lists a copy that has drifted as `keep yours`.
