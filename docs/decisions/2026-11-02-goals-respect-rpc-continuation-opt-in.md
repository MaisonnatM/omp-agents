---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# Respect the RPC continuation opt-in for goals

In the context of dashboard goal creation, facing an interactive-only native continuation default, we chose prompt-driven goals unless the user configured rpc over changing configuration or silently enabling automatic continuation, to avoid starting unrequested model work, accepting that a default goal does not run autonomously.

## Context

Native goal.continuationModes defaults to [interactive].
RPC continuation is supported only when the loaded configuration explicitly includes rpc.

## Options considered

Respecting configuration keeps the native policy authoritative.
Changing the user configuration would make the goal run automatically but affects later sessions.
A runtime override would need an omp capability that the dashboard cannot supply.

## Consequences

The pill and dialog say that the goal advances when a prompt is sent.
No goal control changes a configuration file.

## Confirmation

The session-control tests cover the native command mapping and state transitions; the live dashboard smoke exercises these controls.

## Revisit when

omp changes its default continuation policy or exposes an explicit per-goal continuation option.
