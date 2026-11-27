---
status: accepted
date: 2026-11-27
decision-makers: Maxence Maisonnat
supersedes: 2026-11-26-a-routine-can-be-copied-into-every-new-workspace
---

# A copied routine follows its template until detached

In the context of routines copied into every Workspace, facing one prompt fix that had to be saved again in each copy, we chose linked copies that take the name, task, triggers, and launch from their template and keep their own Workspace, schedules, and switch, over independent copies and over a button that pushes the template to its copies.
A copy whose template fields are changed, or detached with **Detach**, becomes an ordinary routine, accepting that a linked copy cannot change its prompt without leaving the template.

## Context

The PR shepherd routine had copies in five Workspaces; a prompt fix meant five saves, and a disabled copy kept the old prompt.
Each field has one owner: the template owns what the routine does, and the Workspace owns when and whether it runs there.

## Options considered

- Independent copies, as decided on 2026-11-26: every edit repeated in each copy.
- A push button on the template that overwrites its copies: one click, but it overwrites a copy's own changes, and forgetting it leaves copies behind.
- Linked copies with detach: chosen.

## Consequences

- `linked: true` marks a copy that follows its template; a save of the template rewrites its linked copies in the same list change.
- A save of a linked copy that differs from its template in those fields drops `linked`; deleting the template drops it from every copy.
- The owner server links, once, the copies made before this decision that still match their template, and records that in `routine-copies.json`.
- The editor leaves a linked copy's name, model, task, and triggers read-only.

## Revisit when

A copy needs its own prompt and still wants the template's later changes.
