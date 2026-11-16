---
status: accepted
date: 2026-11-16
decision-makers: Maxence Maisonnat
---

# Subagents show and open in the right sidebar

In the context of a live session's subagents, which showed both as links under the `task` call that spawned each and in the right sidebar's **Overview** tab, and opened in place of the session's conversation in its pane, facing Maxence's request to show them in the right sidebar and no longer in the main content, we chose to drop the links from the transcript, keep the **Subagents** section of **Overview** as the one place that lists and stops them, and open a clicked subagent's conversation in a sidebar tab beside the session's.
We chose it over keeping both lists and over opening subagents in the pane, so a `task` call reads as one tool line like any other and the session's conversation stays in view while you follow a subagent, accepting that the subagents stay out of sight while the right sidebar is hidden or two panes sit side by side, that a past session, whose subagents have no view, no longer names them anywhere, and that the sidebar's narrow tab shows one subagent at a time.

## Consequences

The transcript's tool items no longer carry the subagents a `task` call spawned, so the server stops reading them from `task` results and live updates.
The `SubagentLinks` context, which only the transcript read, is gone; `useSubagentLinks` builds the value for the details sidebar alone, which opens a plain click's subagent in its **Subagent** tab.
The page streams the conversations a component shows through `useShowConversation` beside the panes, not only while a page covers them.

## Revisit when

Users miss which `task` call started a subagent, ask to see a past session's subagents, or want two subagents side by side in the sidebar.
