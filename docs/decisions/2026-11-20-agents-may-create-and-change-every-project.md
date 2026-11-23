---
status: accepted
date: 2026-11-20
decision-makers: user, agent
---

# Agents may create and change every project

In the context of the `project_list` and `project_update` tools, facing an allowlist that limited agents to some project operations, we chose to let agents list, create, and change every project, over keeping the allowlist, to let the user steer projects from any session, accepting that an agent can change a project it is not in.

## Consequences

The allowlist was removed and `project_join` folded into `project_update`; the kit guidance still tells agents to create, rename, archive, or join only when the user asks.

## Revisit when

Agents change projects the user did not ask them to touch.
