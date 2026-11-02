---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Keep the disk fact neutral

For the status bar's disk fact, facing a choice between information and a low-space warning, we chose neutral styling over an amber threshold and automatic cleanup nudge.
This keeps machine-wide disk use from implying that omp caused it, accepting a less prominent cleanup entry.

## Context

The fact measures the whole home volume, not omp alone.
Storage measures omp folders only when opened.

## Options considered

- Keep the disk reading neutral with a discoverable Clean up link.
- Color it below a threshold and nudge cleanup before measuring how much omp can reclaim.

## Consequences

The disk popover adds an entry to Storage but no warning color or background cleanup read.
Users decide when to inspect omp storage.

## Confirmation

DiskFact uses ordinary foreground and muted tokens at every free-space level.

## Revisit when

Revisit if there is an approved machine-wide pressure policy with a useful measured reclaim estimate.
