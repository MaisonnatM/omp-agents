---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat, agent
---

# Files, images, and sources live in the Todos card

In the context of a conversation's two cards, the changes card tucked above the composer and the floating Todos card, facing two surfaces that both summarize what the agent is doing and a changes card that took room from the composer, we chose to fold the **Files**, **Images**, and **Sources** sections into the Todos card under its todo list, over keeping two cards and over making the changes card float as a second card, to keep one place that says what the agent planned and what it touched, accepting a card that can grow tall enough to scroll as a whole and a ~20rem width that wraps the image selection bar.

## Context

The changes card sat between the transcript and the composer of a live session, and below the transcript of a past session.
The Todos card floats at the transcript's top right when there is room beside the messages, and sits above them otherwise.
Both list per-view facts that the page already holds, and both fold.
Settings › Preferences has **Show todos card**, which hid the whole card when it held only the todo list.

## Options considered

- Keep two cards: no change, but the composer keeps losing height to the changes card, and the agent's plan and its effects stay apart.
- Float the changes card as a second card under the Todos card: keeps the two concerns apart, but two floating stacks compete for the same margin and need their own height split.
- One card, a stack of sections: the todo list, then Files, Images, and Sources, each shown only with items; the card renders nothing when no section shows.

## Consequences

Users see the files, images, and sources beside the messages, and past sessions show them the same way.
**Show todos card** now hides only the todo list, since the other sections have no switch of their own.
The changes sections reach the card through an optional `changes` prop on `Transcript`, which passes it only while `ActivityShown` is on, so a Bot's page still leaves them out.
The card belongs to the transcript, so it hides while the trajectory takes the transcript's place, where the changes card used to stay.
The fold key `omp-agents.changes-card-closed` and the `changes-card.*` Activity control ids stay as they were, so folds and recorded use carry over; only the labels say Todos card.

## Revisit when

Users ask for a switch per section, or the card's sections routinely outgrow the margin beside the messages.
