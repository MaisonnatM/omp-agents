---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# One table names the settings another section edits

In the context of Settings › omp settings listing every setting a session reads, facing settings that Models and later sections already edit with their own controls, we chose one table, `OWNED_SETTINGS` in `web/omp-settings.ts`, mapping an id, or a prefix ending in `.`, to the section that edits it, which the section counts and links to in place of the rows.
Models owns only the ids its page shows: the model roles, the provider order, the fallback chains, and the ten retry settings under **Retry and fallback**.
We rejected owning all of `retry.*`, as the proposal said, because `retry.fallbackOn` and `retry.rateLimitWalksChain` would then have no control anywhere, and we rejected a list per section, which would let two sections claim one setting unnoticed.
A section that starts editing a setting adds one entry, accepting that the table lives in the page, so `PUT /api/settings/agent` takes owned ids too and does not refuse them.

## Confirmation

`web/omp-settings.test.ts` checks which retry settings Models owns and that owned rows are counted, not listed or counted as changed.

## Revisit when

Models starts editing another `retry.*` setting, or the server needs to know which section owns a setting.
