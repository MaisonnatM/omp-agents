---
status: superseded
superseded-by: 2026-11-09-a-personal-session-is-any-session-in-the-personal-space
date: 2026-11-03
decision-makers: agent
---

# A personal session is one that runs in the personal directory

In the context of personal sessions, which help the user with everyday life and share one memory across conversations, facing resume, fork, keeper reattach, scheduled starts, and `/move`, which each carry a session's cwd but no other field, we chose to make a session personal exactly when its cwd is the dashboard's personal directory, with a Bot-style `personal-memory.md` that a `remember` tool appends, over a stored `scope` field, a Bot kind, and omp's own memory. This needs nothing copied between those paths, accepting one more extension in every non-Bot session that stays inert outside the personal directory.

## Options considered

- **The cwd decides (chosen).** Every path that restarts or copies a session already keeps its cwd, so it stays personal with no new state; the extension checks the cwd at each turn.
- **A `scope` field on the request and the row.** Fork, resume, reattach, and scheduled starts would each have to copy it, and it could disagree with the cwd.
- **A Bot kind.** A Bot has one conversation, a job, and routines; personal help needs many conversations sharing one memory.
- **omp memory.** It depends on the user's `memory.backend` setting, which is off by default, and the dashboard cannot rely on what it keeps.

## Consequences

- The memory is append-only in this version: a later fact overrides an earlier one in the prompt, and the user cannot edit facts from the page.
- Personal sessions get no `move_session`, as a Bot's fixed directory does not.
