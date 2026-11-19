---
status: accepted
date: 2026-11-19
decision-makers: Maxence, agent
---

# The Linear tab opens behind the tab on screen when a session links an issue

In the context of the session sidebar's **Linear** tab, facing Maxence's ask that it open by itself when a session links a ticket, we chose to add the tab to the open tabs behind the one on screen each time the session links more issues than before, over switching to it as a saved artifact switches to **Artifacts**, and over keeping it in the **+** menu, to put the ticket one click away without taking the screen from a tab the user reads, accepting that the user still clicks the tab to read the issue.

## Context

Replies mention Linear links often, in passing, while the user reads **PRs**, **Browser**, or a subagent; a tab that took the screen at each new link would pull the user away mid-read.
A saved artifact is something the agent made for the user to look at, so its tab takes the screen; a linked issue is context.
The open tabs are kept across views, so a closed tab would reopen at every render unless the opening follows a change.

## Consequences

The tab opens when a session's conversation loads with links and when a reply adds one, and its count shows on its chip.
Closing it keeps it closed until the session links another issue or the user opens the session again.

## Revisit when

Users say they open the tab every time it appears, which would argue for switching to it.
