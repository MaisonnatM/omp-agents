# Contributing to omp-agents

Thanks for helping.
Bug reports, fixes, and focused features are welcome.

## Reporting a bug

Open an [issue](https://github.com/MaisonnatM/omp-agents/issues) with your Bun version (`bun --version`), your omp version (`omp --version`), whether the session started in a terminal or from the dashboard, the steps to reproduce, and what you expected.
Report security problems privately instead; see [SECURITY.md](SECURITY.md).

## Development setup

Install the [requirements](README.md#requirements), then:

```sh
git clone https://github.com/MaisonnatM/omp-agents.git
cd omp-agents
bun install --frozen-lockfile
bun start
```

The server does not reload on change; restart `bun start` after editing `src/` or `web/`.

## Checks

Run both before you open a pull request:

```sh
bun test
bun run typecheck
```

If you change the desktop shell in `desktop/`, also run its type check:

```sh
bun install --cwd desktop --frozen-lockfile
bun run --cwd desktop typecheck
```

The tests cover the transcript reducer, file tail, open views, the Collab guest's follow-ups and room links, subagent transcript lookup, prompt expansion, pull-request scan, PR description links, inbox parsing, usage parser, role routing, settings edits, question mapping, shortcut matching, and view model.
They run with `PI_CODING_AGENT_DIR` pointed at a temporary directory (`src/test-env.ts`, preloaded by `bunfig.toml`), so they never touch `~/.omp/agent`.

GitHub Actions runs these checks on every pull request and every push to `main` (`.github/workflows/checks.yml`), against the Bun and omp versions that the README names as tested.
Bump them there together with the README.

## Pull requests

- Keep each pull request to one change, and explain why it is needed.
- Add or update tests for behavior you change.
- Update [docs/usage.md](docs/usage.md) when you change what the interface does, and [docs/architecture.md](docs/architecture.md) when you change how the server works.
- The dashboard builds on omp's own modules.
  Prefer importing omp's code over reimplementing a protocol or file format.
- Follow [CODING_STANDARDS.md](CODING_STANDARDS.md) for omp imports and Markdown style.

See [docs/architecture.md](docs/architecture.md#code-layout) for where each part of the code lives.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
