---
status: accepted
date: 2026-11-02
decision-makers: Maxence
---

# Put storage cleanup in Settings

For cleanup that can take minutes and remove sessions from the roster, we chose a Storage section reached from the disk card over running cleanup inside the card or a long-lived modal.
This keeps progress and rules on a linkable page, accepting another click and navigation away from the panes.

## Context

The disk fact already shows volume use, while cleanup also needs kept reasons, rules, and irreversible confirmation.

## Options considered

- A disk card with a cleanup dialog keeps the conversation visible but holds a slow operation in a modal.
- An inline disk card is shorter to reach but cannot fit the rules, warnings, and kept reasons.
- A Storage section has a stable URL and room for the whole operation; only confirmation is modal.

## Consequences

The disk reading stays neutral and opens a hover-and-click popover with a Clean up link.
Settings reuses its sections and native setting rows, and switching sections preserves the mounted run.

## Confirmation

The browser smoke opens the disk card, follows its link, confirms fixture cleanup, and observes per-step results.

## Revisit when

Revisit if cleanup becomes instantaneous and no longer needs configuration or irreversible warnings.
