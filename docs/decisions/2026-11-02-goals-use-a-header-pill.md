---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# Keep the session goal in a header pill

In the context of one durable objective for a conversation, facing a composer reserved for the next prompt, we chose a header pill and popover over a persistent composer banner or a separate goal page, to keep status visible without taking transcript space, accepting truncation until the pill opens.

## Context

The native goal RPC supports create, pause, resume, drop, and read, but no in-place objective or budget update.
The dialog therefore explains that saving replaces the goal and resets accounting.

## Options considered

The header pill keeps the objective beside session metadata.
A composer banner is more prominent but consumes space every turn.
A separate page accommodates detail but hides current state.

## Consequences

The popover offers lifecycle actions and the dialog edits the objective and budget.
A completed event stays visible as Done during this dashboard lifetime after native mode state clears.

## Confirmation

The session-control tests cover the native command mapping and state transitions; the live dashboard smoke exercises these controls.

## Revisit when

Goals gain multiple objectives or native replacement semantics.
