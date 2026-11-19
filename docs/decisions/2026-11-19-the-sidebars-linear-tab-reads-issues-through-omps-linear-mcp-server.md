---
status: accepted
date: 2026-11-19
decision-makers: agent
---

# The sidebar's Linear tab reads issues through omp's Linear MCP server

In the context of the session sidebar's **Linear** tab, facing the need to read an issue without the Linear integration and Tickets page removed on 2026-11-16, we chose to call the `get_issue` tool of the Linear MCP server omp already loads, with omp's own sign-in, over a Linear API token kept by the dashboard and over a Linear integration of its own, to show any issue with no new setup for someone who already uses Linear in omp, accepting one MCP connection per read and the shape of an answer Linear's server may change.

## Context

omp sessions already reach Linear through `mcp.linear.app`, and omp holds the OAuth sign-in for it.
The dashboard reads Slack through omp's sign-in the same way, and Settings › MCP servers already lists, checks, and signs in to every MCP server omp loads.
The removed Tickets page read Linear through its own loader and is not coming back; the tab shows one issue, not a list or a board.

## Options considered

- **omp's Linear MCP server.** No token or client in the dashboard, and Settings › MCP servers already adds and signs in to it; it costs a connection per read and parses `get_issue`'s JSON, which Linear may change.
- **A Linear API key in the dashboard.** Faster GraphQL reads, but a second credential to set up and keep, beside the one omp already has.
- **A Linear integration in Settings › Integrations.** The same second sign-in, and the integration code removed on 2026-11-16 back.

## Consequences

The tab works once Linear is in Settings › MCP servers, which now offers it in the catalog, and says so when omp has none.
`parseLinearIssue` in `src/linear.ts` is the one place that follows `get_issue`'s answer; a change there shows as a read error in the tab.

## Revisit when

The tab grows into lists, search, or edits of issues, where one MCP call per read would be slow, or omp stops loading Linear's server.
