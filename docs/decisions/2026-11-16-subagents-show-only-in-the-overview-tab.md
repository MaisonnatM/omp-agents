---
status: accepted
date: 2026-11-16
decision-makers: Maxence Maisonnat
---

# Subagents show only in the Overview tab

In the context of a live session's subagents, which showed both as links under the `task` call that spawned each and in the right sidebar's **Overview** tab, facing Maxence's request to show them in the right sidebar and no longer in the conversation, we chose to drop the links from the transcript and keep the **Subagents** section of **Overview** as the one place that lists, opens, and stops them.
We chose it over keeping both, so a `task` call reads as one tool line like any other and its group folds once it finishes, accepting that the subagents stay out of sight while the right sidebar is hidden or two panes sit side by side, and that a past session, whose subagents have no view, no longer names them anywhere.

## Consequences

The transcript's tool items no longer carry the subagents a `task` call spawned, so the server stops reading them from `task` results and live updates.
The `SubagentLinks` context, which only the transcript read, is gone; `useSubagentLinks` builds the value for the details sidebar alone.

## Revisit when

Users miss which `task` call started a subagent, or ask to see a past session's subagents.
