---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# A Browser element chip is a code span in the prompt

In the context of showing an element picked in the Browser as a chip in the composer, as T3 Code does, facing a prompt that stays a string whose chips are a view over single-line text tokens, we chose to append the pick as one inline code span, `` `browser element "<label>" "<content>"` `` with both strings JSON-encoded, over matching the multi-line pick text as a token and over keeping picks as records beside the prompt.
It keeps the draft, the queue, and the sent prompt plain strings that read back as chips in the composer and the transcript, accepting that the model reads the element's HTML as an escaped string.

## Options considered

- One code span holding JSON strings, `elementReference` in `web/prompt-tokens.ts`: one line, so the composer's per-line transform finds it, and the transcript's Markdown keeps a code span verbatim as an `inlineCode` node; chosen.
- The raw multi-line pick text matched as a token: what the model reads is unchanged, but the composer matches tokens within one line, and Markdown splits the HTML into blocks and raw nodes.
- Picks kept as records beside the prompt, as T3 Code's context records are: the model could get the raw HTML, but every place a prompt travels as text, drafts, queued rows, sends, and transcripts, would carry a second field.

## Consequences

The code span's fence is longer than any backtick run inside, so an element's own backticks cannot end it.
A pick sent before this change stays plain text in its transcript.

## Confirmation

The desktop smoke picks an element and finds an `element` chip in the composer and, once sent, in the transcript.

## Revisit when

The prompt carries structured parts beside its text.
