---
status: accepted
date: 2026-11-04
decision-makers: agent
---

# Bot messages reuse the stamped prompt and the Bot inbox

In the context of one Bot handing work to another, as Grok Bots do, facing a recipient that must tell another Bot's message from the user's and a server that alone writes to Bots, we chose a `message_bot` tool that leaves a request in `bot-inbox/`, addressed by the recipient's id, which the server delivers through `Bots.message` as the text with a trailing stamp line naming the sender, and an hourly limit per pair of Bots, over a channel of its own and over a switch that turns Bot messages on.
The recipient then reads the message as another Bot's, the transcript draws it as a card, and two Bots that keep answering each other stop within the hour.
We accept a line of JSON the model reads, as with routines, and a limit that forgets its count when the dashboard restarts.

## Context

A routine already reaches a Bot's conversation this way: `Bots.message` queues a follow-up, resumes the session, or starts one, and a trailing `#` stamp line, read by `promptAuthor`, tells the transcript, the sidebar preview, and the title who sent it.
A Bot's `set_job` already asks the server for a change through `bot-inbox/`, which the server drains one file at a time and which holds requests while the dashboard is stopped.
omp runs a prompt that starts with `!` as a shell command and one that starts with `/` as a command.
Grok Bots hand off work with no switch to turn it on, and nothing stops two of them from replying to each other.

## Options considered

- A `message_bot` tool, a `BotMessageRequest` in `bot-inbox/`, delivered as stamped text through `Bots.message`.
  It reuses the routine's stamp, the inbox, and the delivery, and needs no new transport.
  It was chosen.
- A server endpoint the tool calls directly.
  It fails while the dashboard is stopped and gives the extension a second way to reach the server.
- Addressing Bots by name.
  Names change and two Bots can share one; the prompt lists each Bot's id beside its name.
- A setting that turns Bot messages on, or one per pair of Bots.
  Grok has none, and a limit per pair of Bots stops the one failure a switch would guard against, two Bots answering each other, without asking the user to choose.

## Consequences

- The recipient's prompt lists the other Bots and tells it that its reply in its own conversation does not reach the sender, so it answers with `message_bot` only with a result or a question, never with thanks or an acknowledgment.
- `BotInbox` delivers at most 20 messages from one Bot to another in a rolling hour; past that it drops the message and tells the sender once, so the sender is not woken by each drop, and it tells again after its next delivery to that Bot.
- A delivery that fails tells the sender why, as the shepherd's refusals do.
- The tool and the inbox refuse a message that starts with `!` or `/`, so a Bot cannot run a command in another Bot's session.
- A Bot message is not the user's: it opens no edit or fork, it is not searched as the user's words, and it does not title the session through the dashboard's rename.

## Confirmation

Review checks that `src/server/bot-inbox.ts` sends only `botMessageText`, and that `parseBotMessageText` guards both the tool and `parseBotInboxRequest`.

## Revisit when

Reopen it when Bots need to message each other more than 20 times an hour for real work, or when the count must survive a restart.
