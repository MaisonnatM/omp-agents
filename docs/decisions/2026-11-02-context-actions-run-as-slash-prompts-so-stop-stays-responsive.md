---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# Context actions run as slash prompts so Stop stays responsive

In the context of dashboard context maintenance, facing omp's serial RPC command queue, we chose the native `/compact`, `/shake`, and `/handoff` prompt handlers over the long `compact` and `handoff` RPC operations, to leave Stop able to interrupt maintenance, accepting that completion and errors arrive as command output rather than as the menu request's final result.

## Context

omp dispatches the compact and handoff slash handlers in the background under RPC.
The direct RPC commands share a serial queue that abort does not overtake.
Advisor has a native slash handler and no RPC setter; auto-compaction and goal lifecycle operations are short RPC setters.

## Options considered

The slash handlers use the same native route as typed composer commands and keep abort responsive.
Direct RPC maintenance methods offer a final result but would hold Stop behind the maintenance work.

## Consequences

The dashboard acknowledges command admission, then follows compaction events and native command output.
Maintenance waits until the session's current turn ends, but its auto-compaction switch stays available.

## Confirmation

The dashboard-session tests assert that maintenance calls `prompt`, while automatic compaction calls its RPC setter.
The live smoke exercises a Shake out command and sees omp's command output.

## Revisit when

omp makes abort overtake direct maintenance commands or exposes a cancellable maintenance RPC.
