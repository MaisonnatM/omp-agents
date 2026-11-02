---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Keep debug cleanup opt-in

For old debug reports and replicas, facing a native default that leaves them alone, we chose the saved stale-cleanup switch over selecting deletion when the disk is nearly full.
This preserves user intent, accepting that reclaimable reports may remain until selected.

## Context

The native switch defaults off.
A low-space threshold says nothing about whether someone still needs a debug report.

## Options considered

- Follow the saved native switch in the initial checklist.
- Override it below a disk-space threshold, making disk pressure change which files a confirmation proposes to delete.

## Consequences

Users can select the phase explicitly or change its default in Cleanup rules.
No space threshold changes the selection.

## Confirmation

Initial selection comes from the global native switch and remains user-controlled.

## Revisit when

Revisit only with an approved policy that explains pressure-triggered selection.
