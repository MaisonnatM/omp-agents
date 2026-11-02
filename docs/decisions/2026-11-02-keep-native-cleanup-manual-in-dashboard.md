---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Keep native cleanup manual in the dashboard

For the dashboard's daily owner tick, facing cleanup with irreversible consequences, we chose no new unattended native gc over applying every selected phase each day.
This preserves the existing automation boundary, accepting that users must request native cleanup.

## Context

The owner already sweeps safe isolation sandboxes daily.
Native gc has no general daily scheduler, and its phase switches choose a manual command.

## Options considered

- Keep native gc manual and retain the existing sandbox sweep.
- Apply selected native phases from the owner tick, making saved checklist defaults into a deletion schedule.

## Consequences

No new scheduler or background apply is added.
Cleanup rules explain that default checklist switches do not schedule daily cleanup.

## Confirmation

The owner tick still calls only the existing isolation sweep; Storage apply begins only after confirmation.

## Revisit when

Revisit after an explicit user-facing schedule and retention policy are approved.
