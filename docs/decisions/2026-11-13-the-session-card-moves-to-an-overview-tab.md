---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
supersedes: [2026-10-28-files-images-and-sources-live-in-the-todos-card, 2026-11-03-subagents-live-in-the-todos-card, 2026-11-10-the-todos-card-floats-beside-the-messages-again]
---

# The Session card moves to an Overview tab in the session details sidebar

In the context of the Session card, which floated at a transcript's top right with the **Subagents**, **Files**, **Images**, and **Sources** sections, facing Maxence's request to remove the card and show those sections in the right sidebar as Capy's Overview panel does, we chose a first tab named **Overview** in the session details sidebar, the default tab, with each section under a filled header that folds.
We chose it over keeping the floating card and over a separate panel beside the sidebar, so the messages keep their full width in every pane and the session's summary sits with its pull requests, tickets, and artifacts, accepting that the sections take the right sidebar's room and stay out of sight while it is hidden or while two panes sit side by side.

## Context

The card narrowed and shifted the message lane, and needed its own toggle in the session header and a **Show session card** switch in Settings › Preferences.
The session details sidebar already follows the focused view and hides for split panes, pages, and Settings.
The decision of 2026-11-03 to keep subagents in the card turned down a sidebar tab to keep them in view while the transcript scrolls; the sidebar tab now keeps them in view the same way, beside the messages rather than over them.

## Consequences

The header toggle, the Settings switch, and the lane offset the card needed are gone.
The sections' lists no longer scroll on their own; the tab scrolls as a whole.
A saved tab choice still wins over the new default, so someone who last chose **PRs** lands on **PRs** until they pick **Overview**.

## Revisit when

Split panes need the sections, since the sidebar hides while two panes sit side by side.
