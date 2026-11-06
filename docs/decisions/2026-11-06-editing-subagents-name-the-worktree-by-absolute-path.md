---
status: accepted
date: 2026-11-06
decision-makers: Maxence Maisonnat
---

# Editing subagents name the worktree by absolute path

In the context of sessions on `main` that spawn editing subagents for a linked worktree, facing about 28 worktree-guard rejections on 2026-11-06 because the steering told agents to pass a `checkout` task field that omp 18.16.0 does not have, we chose to spawn those subagents without `isolated` and name the worktree's absolute path in their task for every read, edit, and command, over patching omp's task tool to accept a per-task cwd.
The steering then matches the installed runtime, and the guard still rejects any relative path that lands in the main checkout.
We accept that the subagent must carry the path itself, and that competing attempts need a worktree each.

## Options considered

- Absolute paths in the task, no `isolated`: works on the installed omp, with no runtime patch to carry across upgrades.
- A pinned runtime patch adding a per-task cwd or `checkout`: subagents start in the right place, but every omp upgrade must port it.

## Confirmation

The guard's apply refusal in `templates/omp/agent/extensions/worktree-guard.ts` names this recovery, and `templates/omp/extensions.test.ts` checks the wording.

## Revisit when

omp ships a per-task cwd or the `checkout` option that `2026-10-30-the-worktree-guard-decides-where-isolated-subagent-changes-may-apply` assumed.
