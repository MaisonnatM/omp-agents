---
status: accepted
date: 2026-11-10
decision-makers: Maxence Maisonnat
supersedes: 2026-11-04-the-todos-card-is-a-line-that-opens-over-the-messages
---

# The Todos card floats beside the messages again

In the context of the Todos card, which since 2026-11-04 showed as one line above the messages that opened the card over them on a click, facing sections that stayed out of sight until that click, we chose to float the card at the transcript's top right again, and to stack it above the messages in a narrow conversation, over keeping the line.
We chose it so the ship stepper, the todo list, the subagents, the files, the images, and the sources stay in view while the agent works, accepting that the message lane narrows and moves left beside the card, and that a narrow conversation gives the card some of the messages' height.

## Context

[The Todos card is a line that opens over the messages](2026-11-04-the-todos-card-is-a-line-that-opens-over-the-messages.md) traded the sections' visibility for the messages' room.
After using it, Maxence asked for the previous layout back, with the card on the right of the transcript.

## Options considered

- The line above the messages: the messages keep their full width and height, but every section takes a click, and the open card covers the messages.
- The floating card, stacked above the messages in a narrow conversation: every section is in view without a click, but the messages narrow beside it.

## Consequences

From a 65.75rem wide conversation the card floats at the top right, 20rem wide, and the `conversation-lane` utility moves the messages and the composer left beside it; narrower, it sits above the messages and scrolls as a whole.
The **Subagents**, **Files**, and **Sources** lists scroll within their sections again, so one long list leaves the others in view.
The todo list and the ship stepper start folded to their summary again, as they did beside the messages.
The section headers keep the words the line brought, such as `11/12` for the todo list and `Step 8 of 9` for /ship.
The Activity control that recorded the line's clicks is gone with the line.
A dialog opened from the card still gives the focus back to the row that opened it.

## Revisit when

The card's sections crowd the messages in common pane widths, or a split of two panes leaves the messages too narrow beside it.
