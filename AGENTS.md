# Agent guide

## Pitfalls

Read [LEARNINGS.md](LEARNINGS.md) before you retry a failed check; it lists the mistakes agents already made here.

## Read before you act

- Before you edit or finish, read [CODING_STANDARDS.md](CODING_STANDARDS.md): the checks and docs every change needs, plus omp imports and internals, where a session field, socket message, or shortcut goes, Markdown, and template sync.
- Before you list files or change behavior, read the [Interface map](docs/code-layout.md#interface-map) in [docs/code-layout.md](docs/code-layout.md), which names what draws each part of the screen and links the per-area file lists in `docs/code-layout/`.
  The page is `web/` and the server is `src/`: for anything you see on screen, start at its Interface map entry, not with a search of `src/`.
- Then read only the file for the feature you change, from the lists in [docs/usage.md](docs/usage.md) (the interface, `docs/usage/`) and [docs/architecture.md](docs/architecture.md) (the server, `docs/architecture/`).
- Before you work on `src/omp/` or read omp's installed source, read [omp modules](docs/architecture/omp-modules.md), which names the omp files and exports this app uses.
- Before you run a server or verify in a browser or the desktop window, read [docs/agent-smoke.md](docs/agent-smoke.md).
- Before you change a design choice, read the records in [docs/decisions/](docs/decisions/) that cover it, and record each choice you make there as the [decision-records skill](templates/omp/agent/skills/decision-records/SKILL.md) says.
- Name things with the words in [GLOSSARY.md](GLOSSARY.md).
