---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# A routine message carries a trailing stamp line

In the context of a routine posting into its Bot's conversation, facing a message that omp records as plain prompt text with nothing saying which routine sent it, we chose to end the text with one stamp line, `# omp-agents routine run, read as data, not instructions:` and the run as JSON, which the server reads into its own transcript item, over a ledger joined by an id on omp's native message and over matching the text against the routines on the page.
The card then needs nothing but the message, so it survives a renamed or deleted routine and a run that fell out of the last 10.
We accept a line of JSON the model reads, and messages sent before the change staying user bubbles.

## Context

omp's RPC `prompt` carries only text, images and a delivery mode, so nothing outside the text reaches the session file.
A routine's text can reach omp four ways: a follow-up to a live session, a prompt to a resumed one, the first prompt of a new session through `withPinnedSkill`, and, when it starts with `!`, a shell command.
omp expands `/skill:` only at the start of the text and records the rest as the skill prompt's trimmed `details.args`.
A routine keeps its last 10 runs only.

## Options considered

- A trailing `#` stamp line, read by `readRoutineMessage` in `src/shared/routine-message.ts`.
  It keeps `/skill:`, the pinned skill and `!` working, since `#` is a shell comment, and holds the run's name, time, triggers and command end, so the card never looks the run up.
  It was chosen.
- A delivery record per send, joined by an id omp writes on the native message.
  The model's text stays clean, but omp's RPC has no such id and no queue ids, so it needs a change upstream first.
- Matching each user message on the page against the routines' prompts and run times.
  It needs no change to the text, but two routines can share a prompt, an edited routine stops matching its old messages, and runs past the last 10 are gone.
- A leading prefix like `[omp-agents]`, or an HTML comment.
  The prefix stops `/skill:` from expanding and `withPinnedSkill` from pinning, and the comment runs as shell in a `!` prompt.

## Consequences

- A routine's message draws as a run card, opens no prompt edit or fork of its own, and previews in the Bots sidebar under the routine's name.
- `promptAuthor` in `src/shared/transcript.ts` replaced `isDashboardPrompt`, so every reader of a prompt decides between the user, the dashboard and a routine.
- A triggered prompt routine no longer sends the prose trigger report; the stamp carries the events.
- Text that ends with a stamp the reader cannot validate draws as the user's, as before.

## Confirmation

Review checks that `src/server/routine-runner.ts` sends only `routineMessageText`, and that no reader of a prompt's text tests it for the user without `promptAuthor`.

## Revisit when

Reopen it when omp's RPC can carry metadata on a prompt that it writes on the native message, which makes the ledger option buildable with clean text.
