---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# Put the advisor switch under Fast

In the context of a session-level passive reviewer, facing an already dense composer, we chose a switch under Fast in the model menu over a second model badge or an inline composer toggle, to reuse the existing model-setting interaction, accepting that advisor state is not visible while the menu is closed.

## Context

The advisor is a configured model role or WATCHDOG roster, not a new subagent picker.
RPC has no advisor-enabled field, so the dashboard seeds configuration and tracks successful dashboard commands rather than claiming to read runtime state.

## Options considered

A switch under Fast shares the established control and pending state.
A second model badge keeps the reviewer visible but competes with the main model.
An inline toggle is easier to discover but expands every composer.

## Consequences

The label names one configured model or the number of configured advisors.
A server reattachment cannot recover a runtime-only toggle until omp exposes it.

## Confirmation

The session-control tests cover the native command mapping and state transitions; the live dashboard smoke exercises these controls.

## Revisit when

RPC exposes advisor state or users need to inspect multiple reviewers separately.
