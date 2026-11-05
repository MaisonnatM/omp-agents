---
status: accepted
date: 2026-11-05
decision-makers: Maxence Maisonnat
---

# API credits models show beside Anthropic

In the context of the model menu, facing a Claude plan that is used up and an API key stored beside that sign-in, we chose a separate API credits group placed immediately after Anthropic and shown before search, over leaving those models in the search-only list, so the key is a billing choice you can see without typing.

## Context

omp sends the Anthropic sign-in whenever it is stored, so a key saved on that same provider never bills.
The menu's first view lists only models named by a role or a fallback chain, plus the current model.
An API credits model is the same Claude id on another provider, and no role names it, so that first view hid it.

## Options considered

- Keep the group search-only, with the other models that no role names.
- Show the whole group before search, directly after Anthropic.

## Decision

Show the whole API credits group before search, and sort it immediately after Anthropic when that provider is in the provider order.

## Consequences

The first view of the model menu lists API credits models even though no role names them.
A session started on one of them bills the stored key. A session left on Anthropic still uses the Claude plan.
A session already running does not gain the group until it starts again, after the dashboard has moved the key and written the provider.
