---
status: superseded
date: 2026-11-26
decision-makers: Maxence Maisonnat
superseded-by: 2026-11-27-a-copied-routine-follows-its-template-until-detached
---

# A routine can be copied into every new Workspace

In the context of routines that each belong to one Workspace, facing routines the user wants in every repository, such as shepherding pull requests, we chose a template routine that the owner server copies into each Workspace, each copy its own routine, over one routine that runs in every Workspace and over copies that follow the template's edits.
A copy starts enabled or paused as its template is, and the visible Workspaces that lack a template get it as soon as it is turned on, accepting one routine per Workspace in the list and no way to edit them all at once.

## Context

A routine posts on one Workspace's Board and runs its command there, so a routine for every repository meant making it again in each one.
The Workspaces the dashboard shows include every repository a session ever ran in; hiding one is how the user leaves it out.

## Options considered

- One routine marked for every Workspace that runs once per Workspace: its runs, schedules, and Board tasks would each need a Workspace key, and one Workspace could not pause or change its own.
- Copies that follow the template's edits: a copy could not be changed on its own without breaking the link.
- Independent copies, with `copyOf` naming the template: chosen.

## Consequences

- `everyWorkspace` marks a template, and `copyOf` names a copy's template; both are routine fields Settings sync carries.
- Only the server that owns routines copies, into the visible Workspaces that are a repository's main checkout outside the temp roots.
- It keeps the Workspaces and templates it already copied for in `routine-copies.json`, on this computer only, so a deleted copy stays deleted and the first run copies nothing.
- Turning the mark off stops new copies and removes none.

## Revisit when

The user wants one edit to reach every copy, or copies pile up in Workspaces nobody works in.
