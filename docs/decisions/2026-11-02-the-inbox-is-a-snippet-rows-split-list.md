---
status: deprecated
date: 2026-11-02
decision-makers: user, agent
---

# The Inbox is a Snippet rows split list

In the context of several sessions waiting on the user at once, facing a bell that was opened often but whose items were almost never clicked, we chose an `#inbox` page drawn as Snippet rows: grouped two-line rows beside the open item's full reply, question, or notice, worked with J, K, 1 to 9, 0, R, D, and E, opening the next item after each action.
We rejected the Card feed and Single card layouts and the Session pane and Context rail split lists, which the user saw as prototypes and did not pick.
We accept that the roster keeps each unread turn's reply body and suggestions in memory, up to `UNREAD_BODY_MAX` characters, and that a question shows no age, since the roster has no time for when it was asked.

## Context

Measured over the user's sessions: 59% of replies after a Suggestions block picked a suggestion, the median reply came 39 seconds after a turn ended, 41% of waiting time had two or more sessions waiting, and the bell was opened 240 times with 4 item clicks.
The roster already held who asks and who finished, and the notices held pull request moves, Slack messages, and stopped sessions with read and clear operations.

## Options considered

- Snippet rows: each row shows the question or first suggestion, so most items can be judged without opening them.
- Session pane: the open item shows the session's live conversation, heavier and slower to scan.
- Context rail: a third column of session context, which crowds the reply.
- Card feed and Single card: one item at a time, which hides how much waits.

## Consequences

Pull requests in the Inbox come from pull request notices, so marking one done clears its notice.
Marking a finished turn done sends `read`, and a prompt or answer from the Inbox removes the item when the session starts its next turn.
The bell stays as it was; whether pull requests and Slack should live only in the Inbox is open.

## Confirmation

`web/inbox-model.test.ts` covers grouping, order, a question hiding its session's unread turn, and the item that opens after one leaves.

## Revisit when

The bell is slimmed, or the roster learns when a question was asked.
