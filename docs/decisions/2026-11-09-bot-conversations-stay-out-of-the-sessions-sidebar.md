---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
supersedes: 2026-11-08-sessions-waiting-on-subagents-get-their-own-group
---

# Bot conversations stay out of the Sessions sidebar

In the context of the Sessions sidebar, facing a user request to remove its Bots group, we chose to leave Bot conversations in the Bots tab instead of also listing them in Sessions.
This keeps the Sessions lists and previous and next session keys for ordinary sessions, accepting that users open Bot conversations through Bots instead.

## Context

[Sessions waiting on subagents get their own group](2026-11-08-sessions-waiting-on-subagents-get-their-own-group.md) described a Bots group after Waiting on subagents, including that group's rows in previous and next session traversal.
The user now asks not to show the Bots sessions group in the session sidebar.
This supersedes only that group's presence and traversal, not the waiting-on-subagents behavior.

## Options considered

- Keep the Bots group and its keyboard traversal in Sessions.
  This contradicts the user's request and duplicates access already available in the Bots tab.
- Remove the Bots group and its keyboard traversal from Sessions, keeping Bot conversations in Bots.
  This is the user's choice.

## Consequences

Bot conversations stay out of the Sessions tab's lists, search, and previous and next session traversal, whether running or saved.
The Bots tab and Bot pages stay unchanged.
Previous and next session keys walk pinned, idle, running, waiting on subagents, interrupted, and past rows.
The waiting-on-subagents rule, row status, and attention behavior from the superseded record remain in force.
A session whose main turn ended or waits only in `wait` or `task` calls while a subagent runs still belongs to Waiting on subagents, unless pinned.

## Confirmation

Use the existing `web/sessions.test.ts` behavior tests to check session filtering, grouping, and traversal.
In the running dashboard, confirm that Sessions has no Bots group and that Bots still opens each Bot's conversation.

## Revisit when

Revisit this choice if the user asks to include Bot conversations in Sessions again.
