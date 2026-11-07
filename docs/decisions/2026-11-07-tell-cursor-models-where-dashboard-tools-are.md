---
status: accepted
date: 2026-11-07
decision-makers: Maxence, agent
---

# Tell Cursor models where the dashboard's tools are

In the context of sessions on a Cursor model, facing agents that decide land, end_session, or move_session are missing because Cursor lists omp's tools only behind its GetDynamicTools lookup, we chose to add one paragraph for Cursor models to the session visuals extension's prompt and one rule naming the hidden tools to omp's Cursor connector, over the connector patch alone and over a new extension of its own, so the hint survives a stock omp upgrade without a new file to bundle and ship, accepting that an extension named for visuals now carries a tool hint and that a patched omp sends Cursor both texts.

## Revisit when

Cursor starts listing MCP tools in the model's function list, or upstream omp takes the connector rule, which makes the dashboard paragraph redundant.
A third prompt addition that has nothing to do with visuals should rename the extension to the dashboard's session prompt.
