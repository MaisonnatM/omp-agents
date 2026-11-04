---
status: accepted
date: 2026-11-04
decision-makers: agent
---

# Remove worktrees through a background queue like Rebase behind

In the context of **Delete**, **Delete N worktrees**, and **Remove N merged** on Settings › Worktrees, facing a request to make removal work like the Pull requests page's **Rebase N behind**, we chose a page-wide queue in `web/worktree-removals.ts` that removes one worktree per request under one loading toast per run, armed by a two-click inline confirm, over keeping the blocking preview dialog and over a queue that still opens that dialog first.
Removal no longer stops the page, keeps running after you leave Settings, and reports each run the way rebases do.
We accept that nothing lists a run's ignored files, saved sessions, or pinned sessions before it starts, and that a worktree whose detached commit no branch holds can no longer be removed from the page.

## Context

The dialog previewed every target, listed the ignored files each checkout would lose, named a detached commit no branch holds, and asked for a checkbox before deleting either.
Almost every worktree carries ignored files such as `node_modules`, so that checkbox was ticked on nearly every removal.
The server still enforces every blocker at removal time, since the confirmation pins what the preview saw.

## Options considered

- Keep the dialog: shows what each removal deletes, but blocks the page for the whole run and cannot outlive it.
- Queue behind the dialog: keeps the preview, but still needs the blocking step the request asked to drop.
- Queue behind an inline confirm, chosen: matches **Rebase N behind**; the tooltips say ignored files go with each checkout, and the queue keeps a worktree whose removal could lose a detached commit instead of asking.

## Consequences

A run shows `Removing 2 of 5 worktrees` and ends with `Removed 4 of 5 worktrees`; a hand-picked worktree that turns out blocked, and any failure, toast on their own, while **Remove merged** only counts the merged ones it keeps.
A removed row leaves the list as soon as it goes, through the time the queue records for it, without reading every worktree again.

## Confirmation

`web/worktree-removals.test.ts` covers the toast sequence, the kept and failed toasts, the detached commit, and a second run waiting behind the first.

## Revisit when

Someone needs to remove a worktree whose detached commit no branch holds from the page, or a run's preview needs to show what it deletes before it starts.
