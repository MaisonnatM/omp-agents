---
status: accepted
date: 2026-11-04
decision-makers: Maxence Maisonnat, agent
---

# The Todos card is a line that opens over the messages

In the context of the Todos card, which floated at the transcript's top right or sat above the messages in a narrow column, facing a card that grew with its ship stepper, todos, subagents, files, images, and sources until it took the conversation's room, we chose one line above the messages that names the /ship step or the task in progress and counts each section in its header's words, and opens the whole card over the messages on a click.
We chose it over the floating card and over a card stacked above the messages, to keep the messages' width and height in every pane while the card's state stays one glance away, accepting that the sections take a click to see and cover the messages while open.

## Context

[Files, images, and sources live in the Todos card](2026-10-28-files-images-and-sources-live-in-the-todos-card.md) and [Subagents live in the Todos card](2026-11-03-subagents-live-in-the-todos-card.md) made the card the one place for what the agent planned and touched, and both named, as the reason to revisit, sections that outgrow the margin beside the messages.
The floating card shifted the message lane aside to make room, and in a narrow column it sat above the messages and pushed them down.
Maxence compared layouts in a prototype and picked the line, which he called the Status strip.

## Options considered

- The floating card: every section in view, but it narrows the messages, and below 14rem of margin it moves above them and takes their height.
- A card stacked above the messages in every width: one layout, but a long todo list or many files push the conversation off the pane.
- One line that opens the card over the messages: the conversation keeps its room, and the line's words repeat the section headers so it reads as a summary of them; the sections take a click.

## Consequences

The line's counts drop from the last one as the conversation narrows, each whole or gone, while the stage or the task keeps its own width up to 12rem.
The open card is a `Popover` bounded by the conversation's wrapper, so it never covers the composer; a click outside it or Escape closes it, and Escape gives the focus back to the line.
The **Subagents**, **Files**, and **Sources** lists no longer scroll inside their sections, as the open card scrolls as a whole, so a long list pushes the sections after it down instead of showing a cut row.
The file and image dialogs its sections open render inside it, so it stays open under them, and closing one gives the focus back to the row that opened it.
The todo list and the ship stepper now start unfolded inside the card, since the line already shows their summary; a stored fold still wins.
**Show todos card** and the header's checklist toggle keep hiding the whole card, now its line too.
The new Activity control `todos-card.open` records the line's clicks.

## Confirmation

`web/todos-strip-model.test.ts` checks that the line's words match the section headers, and the strip's breaks were checked at 744, 440, 280, and 200 pixels in a throwaway harness.

## Revisit when

Users open the card on most visits, which would say the summary hides what they need, or the line's lead and counts no longer fit a narrow pane.
