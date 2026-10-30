---
status: accepted
date: 2026-10-30
decision-makers: Maxence Maisonnat
---

# The worktree guard decides where isolated subagent changes may apply

In the context of isolated subagents spawned by a session whose cwd is the main checkout, facing a 122-file patch that applied into `yampa` on `main` instead of the linked worktree the work belonged to, we chose to have omp name the destination checkout on every isolated spawn and fire a `before_subagent_apply` extension event that the starter kit's worktree guard answers, over a refusal rule built into omp's apply step.
The guard already owns the rules for which checkout a session may change, so an apply follows the same rules as an edit there, and one place states them.
We accept that the protection holds only where the guard is installed and omp is new enough to fire the event, and that a guard check and the apply that follows are not atomic, the same window an edit has.

## Options considered

- A `before_subagent_apply` event answered by the worktree guard: one policy for edits and applies, and omp keeps no opinion about default branches or session claims.
- A rule in omp's apply step that refuses the main checkout on its default branch: works without the starter kit, but duplicates the guard's default-branch rule and cannot see the guard's session claims, so a concurrent session's dirty checkout would still take the patch.

## Confirmation

The `checkout ownership` tests in `templates/omp/extensions.test.ts` refuse an apply into the main checkout on `main` and into another live session's dirty checkout, and allow one into a linked worktree.
omp's `test/task/isolation-apply-destination.test.ts` proves the spawn's `checkout` decides the destination and that a refused apply leaves the checkout untouched and keeps the patch.

## Revisit when

omp gains its own notion of protected checkouts, or a session needs isolated changes applied into a main checkout on its default branch.
