---
status: superseded
superseded-by: 2026-11-13-remove-the-personal-and-work-spaces
date: 2026-11-09
decision-makers: Maxence, agent
supersedes: 2026-11-04-private-pill-and-personal-item
---

# Split the dashboard into a Personal and a Work space

In the context of a dashboard that shows personal sessions, their sport plan, and work repositories in one sidebar, facing work clutter whenever Maxence opens it for his own life, we chose two spaces, each holding its own workspaces, where the Personal space can hold repositories such as `~/code/culture-escalade` as well as the personal directory.
We rejected keeping one roster with a Personal badge, which the superseded record chose, and a Personal space limited to the personal directory, which would leave every personal repository mixed with work.
This gives each space its own sessions, todos, and pages, accepting that every workspace now carries one more fact to keep right.

## Context

The record `2026-11-04-private-pill-and-personal-item` kept the status groups unsplit because a split would repeat them twice, and named personal sessions outnumbering project ones as its trigger to revisit.
Maxence now asks for the split outright, so the repeated groups are the accepted cost.
That record's Private pill choice still stands; only its choice against a split and its Personal item are replaced here.

## Consequences

- A workspace belongs to exactly one space.
- The Personal sidebar item and Cmd+Shift+P need a new role once the switch exists; a later record settles them.

The draft design is `~/.local/share/omp-agents/personal/plan-spaces-personal-work.md`.
