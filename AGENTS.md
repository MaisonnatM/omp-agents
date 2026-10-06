# Agent guide

## New worktree

Run `bun install --frozen-lockfile` in the worktree before `tsc`, which otherwise fails with `Cannot find type definition file for 'bun'`.
Install rather than symlink the main checkout's `node_modules`: when the worktree already has a `node_modules` directory, `ln -s` creates a stray `node_modules/node_modules` link inside it, and `rm node_modules` then fails.

## Read before you act

- Before you edit or finish, read [CODING_STANDARDS.md](CODING_STANDARDS.md): the checks and docs every change needs, plus omp imports and internals, where a session field, socket message, or shortcut goes, Markdown, and template sync.
- Before you list files or change behavior, read [docs/usage.md](docs/usage.md) (the interface) and [docs/architecture.md](docs/architecture.md) (the server; its [Code layout](docs/architecture.md#code-layout) names each file's job).
- Before you run a server or verify in a browser or the desktop window, read [docs/agent-smoke.md](docs/agent-smoke.md).
