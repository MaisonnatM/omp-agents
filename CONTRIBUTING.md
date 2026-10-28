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
bun run desktop
```

The server does not reload on change; after editing `src/` or `web/`, quit the app with Cmd+Q and run `bun run desktop` again.
When an omp-agents server already listens on the port, the app uses it instead of starting its own, so restart that server too.
`bun install` also installs a pre-push hook that runs the CI checks and refuses a push to `main` without new lines in `CHANGELOG.md`, and a pre-merge-commit hook that refuses a merge into `main` without them.

## Pull requests

[CODING_STANDARDS.md](CODING_STANDARDS.md) lists what a pull request needs: the checks to run, the tests and docs to update, and the code conventions.
[docs/code-layout.md](docs/code-layout.md) says where each part of the code lives.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
