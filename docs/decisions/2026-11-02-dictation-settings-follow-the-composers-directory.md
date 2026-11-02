---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Dictation settings follow the composer's directory

In the context of omp's `stt` settings that a project's config or an environment variable can override, facing composers that belong to a session, a subagent, or a new-session draft, we chose to have the page send the composer's directory with each read of the settings and each capture, and the server resolve it with `directoryOf`.
We rejected naming the session's live view, as the proposal sketched, because a new-session draft has no session yet.
We accept that the page names a directory the server must check before it reads settings there.

## Context

A new-session draft has a directory and a draft key but no instance id.

## Options considered

- The composer's directory: one rule for every composer that keeps a draft.
- The live view: works only once a session runs.

## Consequences

`GET /api/dictation/settings?cwd=` and `dictation-start` both take the directory.
