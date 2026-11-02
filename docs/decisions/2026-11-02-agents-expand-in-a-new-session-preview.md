---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat, agent
---

# Agents expand in a new-session preview

In the context of editing agent model defaults from Settings, facing a small roster whose descriptions and effective models should remain visible while editing one agent, we chose the approved Expandable agent roster over a master-detail pane and a dense table.
Rows expand independently and stay mounted when folded or filtered, so edits survive searching and section changes, accepting a longer page when several rows are open.
The section is explicitly a preview of a new session, since native discovery cannot report the extension context of a running session without new omp RPC commands.

## Options considered

- Expandable agent roster keeps descriptions in the overview and the override beside its definition and effective model.
- Master-detail pane gives one agent more room but hides the other agents' details and adds a selection state.
- Dense table makes comparison quicker at the cost of narrower descriptions and a separate editing surface.

## Consequences

The workspace picker chooses native discovery's directory, while All workspaces discovers from `/` and excludes project definitions.
User and workspace model layers stay separate, and bundled seance never presents a saved override as its effective model.
Each user override saves through the existing settings route as one native map-entry write, checked against the user entry shown when editing began.
Execution controls use omp's panel choices and defaults, including zero for unlimited concurrency.
Running sessions and already spawned subagents are not changed, and no disabled live-session control stands in for the missing native API.

## Confirmation

`src/omp/agents.test.ts` covers discovery precedence, model layers, disabled agents, user-only scope, inheritance, and seance.
`src/settings.test.ts` covers entry conflicts and preserving other entries; `web/omp-settings.test.ts` covers ownership of the five edited ids.
The headless Agents smoke exercises saving and clearing an override, execution settings, search, folding, and section changes.

## Revisit when

omp exports `get_agent_catalog` and `set_agent_model_override`, or users routinely compare more agents than the expandable roster can show clearly.
