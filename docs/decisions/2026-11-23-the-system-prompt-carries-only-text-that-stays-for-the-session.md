---
status: accepted
date: 2026-11-23
decision-makers: agent
---

# The system prompt carries only text that stays for the session

In the context of Anthropic's prompt cache, where a changed system prompt makes the next request write the system head and the whole conversation again, facing kit extensions that append per-turn state to the system prompt, we chose that a kit extension sends state that changes mid-session as a hidden conversation message, only when it changed and again after a compaction, as `project.ts` sends a project brief, over appending it to the system prompt at every prompt.
`todos.ts` moved its open-todos note this way.
We accept that a mid-session change reaches the model as a newer message rather than an edited instruction, and we left the dashboard's Bot extension, `src/omp/bot-extension.ts`, appending its memory, routines, and other Bots to the system prompt: over 14 days its changes cost about $2 of rewrites within the hour, and moving them changes what a Bot reads after a compaction.

## Confirmation

`templates/omp/todos-note.test.ts` checks that the todos hook returns no system prompt and sends its note once per change.
The digest-change count in `docs/architecture/token-cost.md` comes from `system-prompt-digest` entries in session files; rerun it after two weeks and expect no rewrite within the hour after a `user_todo` call.
