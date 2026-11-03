---
status: accepted
date: 2026-11-03
decision-makers: Maxence Maisonnat, agent
---

# Subagents live in the Todos card

In the context of a live session's subagents, which a conversation shows only as links under the `task` call that spawned each, facing long transcripts where that call has scrolled far out of view, we chose a **Subagents** section in the Todos card, after the todo list and before **Files**, shown only in a live session.
We chose it over a tab in the session details sidebar and over a menu in the session header, to keep the subagents beside the plan and the changes the card already summarizes, where they stay in view while the transcript scrolls, accepting a taller card and a second place that offers a subagent's stop button.

## Context

[Files, images, and sources live in the Todos card](2026-10-28-files-images-and-sources-live-in-the-todos-card.md) made the Todos card the one place that says what the agent planned and what it touched.
The page already holds every live session's subagents, with their parent, status, and activity, and hands them to the transcript through the `SubagentLinks` context for its `task` rows.
A past session's subagents have no view of their own, so there is nothing to open there.
A subagent can spawn subagents, so the list is a tree.

## Options considered

- A **Subagents** tab in the session details sidebar: room for a long list, but the sidebar shows only the focused pane, can be closed, and already holds **PRs**, **Browser**, and **Tickets**.
- A menu in the session header, as the session chip's menu lists hosts: takes no room, but hides the subagents' status behind a click and leaves no place for activity or the stop button.
- A section of the Todos card, after the todo list: in view beside the messages of every pane, folds like the other sections, and reuses their header.

## Consequences

Users see a session's subagents, nested under the subagent that started each, with their status, and open or stop one from the card.
A subagent's view lists only the subagents under it, and a past session or a Bot's page shows no section.
The section's fold has its own key, `omp-agents.todos-card-subagents-closed`, and its own Activity control, `transcript.subagents`.
A session with many subagents makes the card taller; the list scrolls inside the section past about four rows, and the fifth shows cut to say there is more.

## Revisit when

The card's sections routinely outgrow the margin beside the messages, or users ask to see a past session's subagents.
