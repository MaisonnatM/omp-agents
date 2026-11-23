---
status: accepted
date: 2026-11-19
decision-makers: user, agent
---

# The session sidebar links only the session's own PRs and tickets

In the context of the session sidebar's PRs and Linear tabs, facing links to every PR or ticket an agent read or mentioned, we chose to list only the session's own work, over every reference in the transcript, to keep the tabs about what the session changed, accepting that a ticket the agent only discussed does not show.

## Consequences

Linear: the /ship issue, issues the session's own `save_issue` calls saved (`SessionFacts.issues`), and issues the user's own prompts link; links in the agent's replies do not count. PRs: the session's own refs plus PRs a subagent opened with `gh pr create`; PRs a subagent only reviewed or commented on are dropped.

## Revisit when

The user asks to see referenced but untouched PRs or tickets.
