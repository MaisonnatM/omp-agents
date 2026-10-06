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

## Pull requests

[CODING_STANDARDS.md](CODING_STANDARDS.md) lists what a pull request needs: the checks to run, the tests and docs to update, and the code conventions.
[docs/architecture.md](docs/architecture.md#code-layout) says where each part of the code lives.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
