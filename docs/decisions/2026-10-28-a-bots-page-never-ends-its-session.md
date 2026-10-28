---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# A Bot's page never ends its session

In the context of a Bot's page, whose details offered **End session** and whose conversation took Cmd+Shift+X, facing a user who wants a Bot to be one conversation that is always there, we chose to drop both from the page over refusing the end on the server, to keep a Bot's session out of reach of a stray click or shortcut, accepting that merge cleanup, the end inbox, and the agent's own `end_session` can still end it.

## Context

A Bot is one conversation you come back to.
The Sessions tab and the command palette already hide a Bot's session, so its page was the one place a person could end it.
The server resumes a Bot's ended session with the next message, so an end never loses the conversation, it only stops it.

## Options considered

- Refuse `end` on the server for a Bot's session: also stops merge cleanup and the end inbox, which share that path, and needs a new refusal the page has to show.
- Drop **End session** from `BotDetails` and gate the end shortcut on the conversation's header, which only a Bot's page hides: chosen.

## Consequences

- `Conversation`'s `endSession` handler returns `false` while `header` is `false`, so Cmd+Shift+X falls through on a Bot's page.
- A Bot's turn that hangs can still be interrupted from its composer, and its session still ends where the agent or the server ends it.

## Confirmation

On a Bot's page with its session running, the details show no **End session**, and Cmd+Shift+X leaves the session in the roster.

## Revisit when

A Bot can run more than one session, or another page draws a conversation without its header.
