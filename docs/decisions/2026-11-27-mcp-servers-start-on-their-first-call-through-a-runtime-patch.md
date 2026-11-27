---
status: accepted
date: 2026-11-27
decision-makers: user, agent
---

# MCP servers start on their first call, through a runtime patch

In the context of dashboard sessions on omp 19.0.0, facing every session starting every enabled stdio MCP server at launch and keeping it until the session ends, though most sessions never call it, we chose a runtime patch that makes omp start a stdio server on its first call and stop it after 10 idle minutes, gated by `OMP_MCP_LAZY=1` in the dashboard's launch env, over a shared broker the dashboard would run in front of the servers, to run a server only while a session uses it, accepting a sixth runtime patch to apply and rebuild after each omp upgrade.

## Context

omp's `MCPManager` connects every configured server when a session starts, and a stdio server is a child process of that omp.
With a dozen sessions open, each runs its own copy of every stdio server, such as the `obscura` browser, for its whole life.
omp already caches each server's tool list in `agent.db`, keyed by server name and checked against a hash of its config, and already has deferred tools that resolve their connection per call.
The dashboard cannot change how a session's omp connects its servers; omp-agents keeps runtime changes as patches in `patches/`.

## Options considered

- A runtime patch, `patches/omp-19.0.0-lazy-mcp.patch`, in omp's `MCPManager`: a stdio server with a cached manifest registers its tools and instructions from it, with no process; its first call starts it; it stops after `OMP_MCP_LAZY_IDLE_MS`, 10 minutes by default, with no call. A server with no manifest is started once, listed, cached, and stopped. Chosen; the user picked it.
- A broker the dashboard runs, one process per server shared by every session: sessions would reach it through a proxy server in their MCP config, and it would have to keep each session's browser pages apart.
- Keep starting every server at launch: no code to carry, but idle sessions keep paying for servers they never call.

## Consequences

A dashboard session on the patched omp runs a stdio MCP server only between its first call and 10 idle minutes later; the model sees the same tools and instructions from the start, since they come from the manifest.
A browser server, one of omp's browser names or a command naming `chrome-devtools-mcp` or `obscura`, keeps its pages: once called, it runs until the session ends.
A server that exits or crashes is not restarted until its next call.
A changed server config misses the manifest and is discovered again; remote (`http`, `sse`) servers connect as before, since they run no local process.
A session started outside the dashboard, or on a stock omp, connects every server at launch, as before.

## Confirmation

The patch's tests in `mcp-lazy-stdio.test.ts`: `discovers a new server once, then starts it on its first call and stops it when idle`, `keeps a browser server running after its first call`, `respawns nothing when a started server exits`, and `connects eagerly without OMP_MCP_LAZY`.

## Revisit when

Upstream omp starts MCP servers on demand itself, which makes the patch redundant; or sessions need one server process shared between them, which the broker would give.
