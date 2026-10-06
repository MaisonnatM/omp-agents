# Agent guide

omp-agents is a local web dashboard for omp sessions.

## New worktree

Run `bun install --frozen-lockfile` first.
Without it, `tsc` fails with `Cannot find type definition file for 'bun'`.
Do not symlink `node_modules` from the main checkout.
When the worktree already has a `node_modules` directory, `ln -s` creates a stray `node_modules/node_modules` link inside it, and `rm node_modules` then fails.

## Read before you act

- Before you list files or change behaviour, read [docs/usage.md](docs/usage.md) for what the interface does and [docs/architecture.md](docs/architecture.md) for how the server works; its [Code layout](docs/architecture.md#code-layout) section lists what each file is for.
- Before you add a session row field, a socket message, or a keyboard shortcut, read [Where changes go](CODING_STANDARDS.md#where-changes-go).
- Before you import from omp, read [omp imports](CODING_STANDARDS.md#omp-imports).
- Before you read omp's source, read [omp internals](CODING_STANDARDS.md#omp-internals).
- Before you write or edit Markdown, read [Markdown](CODING_STANDARDS.md#markdown).
- Before you edit an installed copy of a `templates/omp/` file, read [Template sync](CODING_STANDARDS.md#template-sync).
- Before you start or stop a server, read [Server lifecycle and authentication](docs/agent-smoke.md#server-lifecycle-and-authentication).
- Before browser verification, also read [Browser smoke](docs/agent-smoke.md#browser-smoke).
- Before desktop verification, also read [Desktop smoke](docs/agent-smoke.md#desktop-smoke).
- Before you finish, read [Docs to update](CODING_STANDARDS.md#docs-to-update) and run the checks in [CONTRIBUTING.md](CONTRIBUTING.md#checks), including the desktop type check after you change `desktop/`.
