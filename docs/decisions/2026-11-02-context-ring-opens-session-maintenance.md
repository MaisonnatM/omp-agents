---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# Open session maintenance from the context ring

In the context of context maintenance for a live dashboard session, facing commands hidden behind slash syntax, we chose a ring dropdown over an inline toolbar or a second composer button, to put Compact, Shake out, Hand off, and Auto-compact beside the usage they affect, accepting nested menus for the less frequent modes.

## Context

The ring keeps its existing meter and terminal sessions keep the read-only version.
The native slash handlers run maintenance in the background, whereas the long RPC compact command would hold the serial command queue ahead of Stop.

## Options considered

The dropdown is compact and preserves the composer layout.
An inline toolbar makes all modes visible but permanently spends composer space.
A second button preserves the ring as a meter but separates the action from its context.

## Consequences

Keyboard users open the same menu with the shared menu primitive.
Compaction disables maintenance actions but not the session-only automatic-compaction switch.

## Confirmation

The session-control tests cover the native command mapping and state transitions; the live dashboard smoke exercises these controls.

## Revisit when

The maintenance modes or their frequency no longer fit a small menu.
