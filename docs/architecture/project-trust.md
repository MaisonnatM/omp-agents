# Project trust

omp loads a project's own `.omp/` extensions, hooks, tools, TypeScript slash commands, MCP servers, and settings the moment a session starts in it, and it has no project trust of its own: its extension runner's `isProjectTrusted` always answers yes.
It also has no switch that drops the project's code while keeping the user's, so the dashboard gates the start itself and does not start omp until the user trusts what the project would run.
The [decision record](../decisions/2026-10-31-the-dashboard-asks-before-omp-runs-a-projects-own-code.md) records why.

## The census

`discoverProjectCode(cwd)` in `src/omp/discovery.ts` lists the project-level files and MCP servers a session in `cwd` would load, through omp's own discovery, every item with `_source.level === "project"`, and nothing more.
`projectCensus(cwd, top)` in `src/server/project-code.ts` turns that list into `ProjectCode` pieces, sorted in the order of `PROJECT_CODE_KINDS` in `src/shared/project-trust.ts`, then by id.
It calls `forgetReadFiles` first, which resets omp's process-wide capability cache, so a piece added since the last start is seen.
- Extensions come from the `extension-modules` capability's native provider only, the one omp's extension loader asks.
- Hooks are the `.ts` and `.js` files of the `hooks` capability, the only ones omp binds.
- Tools are the `tools` capability's `.ts`, `.js`, `.mjs`, and `.cjs` files, without `.d.ts`, as omp's custom tool loader filters them.
- TypeScript slash commands come from omp's `discoverCustomCommands`, those with `source === "project"`.
- Every project `settings` item is a piece, since a settings key can name a command, an extension, or a shell.
- Every MCP server is a piece, a URL server too, since its headers and auth can run commands.
- Language server configs are the `lsp.json`, `lsp.yaml`, and `lsp.yml` files, with or without a leading dot, in `cwd` and in each project config directory `getConfigDirPaths` names.
Skills, agents, rules, markdown commands, and context files are prompt text and never pieces.

A piece's `id` is opaque and names one piece: its path from `top`, the realpath of the checkout's top, with `/` separators, or the absolute realpath for a file outside it, or `mcp:<name>` for an MCP server.
Its `name` is what the dialog shows, the same path, or the MCP server's name.
Two discoveries reach one file only through a linked config directory, so the census keeps one piece per id.
Its `hash` is the SHA-256 of its file, of a package directory's files when an extension, tool, or command is a directory, skipping `node_modules` and `.git`, or of an MCP server's settings without `_source` in `canonicalJson`, so linked worktrees and any key order hash it alike.
A file that cannot be read hashes as the word `unreadable`, so it still asks once it can be read.

## The store

`ProjectTrustFile` in `src/server/project-trust-file.ts` is a shared `ReducerFile` over `project-trust.json` in the dashboard's config directory: for each project root, each trusted piece's id and the hash it had when trusted.
`applyTrust` in `src/shared/project-trust.ts` applies a `TrustChange`: `{ op: "trust", root, code: [{ id, hash }] }` records those hashes, and `{ op: "forget", root }` drops the root.
Every server on this computer writes the one file, and the gate reloads it before reading, so a trust given on one server lets another's start through.
The file is machine-specific and is not part of [settings sync](settings-sync.md).

`projectOf(dir)` names the root trust is kept for: the main checkout of the repository's linked worktree, else the worktree's top, else the directory's realpath outside git.
`ProjectTrustFile.untrustedCode(dir)` takes the census and answers a `TrustAsk`, `{ root, rootDisplay, code }`, with each piece missing from the root's trust marked `new` and each with another hash marked `changed`, or `null` when nothing is untrusted.
`ProjectTrustFile.admit(dir)` throws an `UntrustedProjectError` carrying that ask, whose message is `untrustedText(ask)`, and a census that throws as `Cannot check the agent code in <dir>: <reason>`.

## The gate

`startRpc` in `src/omp/rpc.ts` is the one place a dashboard session's omp spawns, and it awaits `RpcLaunch.admit` in the session's directory before it does.
`createStarter` in `src/server/start.ts` hands `StartEnv.admit`, which `src/server/dashboard.ts` binds to `ProjectTrustFile.admit`, into every launch, so a new session, a fork, a replay, and a resume are each checked in the directory omp would run in.
A replay refused there discards its detached checkout as any failed replay does.
`launch` maps an `UntrustedProjectError` to `{ ok: false, error, trust }` in the start's `started` message, where `error` is `untrustedText(trust)`, so a bot, a routine, a scheduled send, and the shepherd, which start through the same starter, fail with plain text naming the folder.
A census that throws refuses too, with its error after the start's own prefix, such as `Cannot start omp: `.
Reattaching to a running session goes through `attachRpc` and is not gated: its omp already runs.

`SessionMoves` calls the same `admit` for the `move_session` tool's target, so a directory with untrusted code fails the tool with `untrustedText`; a `/move` the user types goes to omp directly and is not gated.

## The page

`settleStart` in `web/starts.ts` keeps a refused start's `trust` on its failed state, and `refusedStart` picks the one the dialog asks about.
`ProjectTrustDialog` in `web/components/project-trust-dialog.tsx` shows it with each kind's label from its own table; **Trust and start** sends `PUT /api/project-trust` with every listed piece's id and hash, then sends the same start op again, which replaces the refused start and so closes the dialog, and **Cancel** drops `trust` only, leaving the error.
A refused start stays while the dialog asks, even when no pane shows its view.
`PUT /api/project-trust` takes a `TrustChange`, checked by `parseTrustChange` in `src/server/wire.ts`.
A change that changes the store saves it and sends every socket a `project-trust` message with its `projects`, each `TrustedProject` with its `root`, `rootDisplay`, and how many `pieces` it trusts, also sent when a socket opens.
Settings › Workspaces lists those projects and sends `{ op: "forget", root }` for **Stop trusting**.

## Gaps

- A session started with `omp` in a terminal is not gated: the dashboard does not start it.
- Plugin extensions in `.omp/plugins` and a plugin root's language server config are not counted: omp offers no project-only discovery for them.
- omp's language servers may run binaries from the project's `node_modules/.bin` or `.venv/bin`; the census does not list them.
- Package directory hashes skip `node_modules`, so a changed dependency does not ask again.
