---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Keep native archive selection in Storage

For Storage's initial checklist, facing cold sessions leaving History and Resume, we chose the user's native archive switch over forcing archiving off or building a separate archive browser.
This keeps dashboard cleanup aligned with native settings, accepting that users must understand the explicit confirmation warning.

## Context

The native archive switch defaults on and native gc retains active and newest sessions.
The dashboard cannot list and resume archived sessions through an existing native API.

## Options considered

- Honor the saved native switch and warn before applying.
- Force archiving off in the dashboard, which would make the same settings mean different things.
- Add archive browsing first, which needs an omp capability outside this proposal.

## Consequences

Cold sessions show counts, never invented byte savings.
The confirmation says they leave the roster, History, and Resume and that their compressed archive stays on disk.

## Confirmation

The checklist reads the global archive switch, and the confirmation names its consequence.

## Revisit when

Revisit when omp exports supported archive listing and resume operations.
