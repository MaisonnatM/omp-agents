---
status: accepted
date: 2026-10-31
decision-makers: agent
---

# The dashboard asks before omp runs a project's own code

In the context of repositories that commit their own `.omp/` extensions, tools, MCP servers, and settings, facing omp running them in-process the moment a session starts, with `isProjectTrusted` always true and no switch that drops the project's code while keeping the user's, we chose to have the dashboard take a census of the project's code through omp's own discovery before every start and refuse the start until the user trusts each piece by its SHA-256 hash, kept per main checkout, over trusting a whole folder by path, and over starting omp without the project's code.
A pulled branch or a checked-out pull request that adds or edits a piece asks again, accepting that a session started in a terminal, a `/move` the user types, plugin extensions, and binaries a language server finds in the project are not covered.

## Options considered

- Trust a folder once by path, as HazAT/ultimate does: the dashboard checks other people's pull requests out into worktrees of trusted repositories, so a path alone would run their new code unasked.
- Start omp without the project's code until trusted: omp offers no such mode, since `.omp/tools` loads unconditionally.
- Trust each piece by id only: an edit to an approved tool would run unasked.
- Trust each piece by id and hash, per main checkout: chosen.

## Revisit when

omp gains its own project trust or a flag that loads only the user's code.
