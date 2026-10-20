# Agent guide

## Pitfalls

Read [LEARNINGS.md](LEARNINGS.md) before you set up a new worktree or retry a failed check; it lists the mistakes agents already made here.

## Read before you act

- Before you edit or finish, read [CODING_STANDARDS.md](CODING_STANDARDS.md): the checks and docs every change needs, plus omp imports and internals, where a session field, socket message, or shortcut goes, Markdown, and template sync.
- Before you list files or change behavior, read [docs/code-layout.md](docs/code-layout.md), which names each file's job.
  The page is `web/` and the server is `src/`: for anything you see on screen, start at its [Interface map](docs/code-layout.md#interface-map), not with a search of `src/`.
- Then read only the sections of [docs/usage.md](docs/usage.md) (the interface) and [docs/architecture.md](docs/architecture.md) (the server) for the feature you change: each opens with a table of contents, so read that and then the section by range.
- Before you work on `src/omp/` or read omp's installed source, read [omp modules](docs/architecture.md#omp-modules), which names the omp files and exports this app uses.
- Before you run a server or verify in a browser or the desktop window, read [docs/agent-smoke.md](docs/agent-smoke.md).
- Before you change a design choice, read [docs/decisions.md](docs/decisions.md), which says why it was made.
- Name things with the words in [GLOSSARY.md](GLOSSARY.md).
