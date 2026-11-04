---
status: accepted
date: 2026-11-04
decision-makers: Maxence
---

# Storage can discard sandboxes with leftover changes

In the context of Settings › Storage, facing a disk at 97% full while the checklist found almost nothing to clean, because every one of 111 leftover isolation sandboxes kept edits in its checkout and so was never sized or offered, we chose to size those sandboxes and offer them as their own unchecked row that removes them with their changes, over only showing their size and over leaving them hidden.
It lets you reclaim the gigabytes they hold from the dashboard, accepting that edits omp never brought back to your checkout are lost when you pick that row.

## Context

The daily sandbox sweep and the **Sandboxes of ended tasks** row remove a sandbox only when its omp process ended and its checkout is clean, unlocked, and unused.
A task that ends with edits still in its sandbox leaves it behind forever, and the checkout is a full copy of the repository, measured at 0.3 to 9.4 GB each.
The Storage preview measured only removable sandboxes, so these showed no size, and the folder total timed out after ten seconds.

## Options considered

- Show sizes only, and leave removal to a terminal: honest, but the user still has to find and delete each folder by hand.
- Show sizes and offer an opt-in row that discards changes: chosen.
- Remove changed sandboxes in the daily sweep: rejected, since an unattended job would lose edits nobody looked at.

## Consequences

The new row **Sandboxes of ended tasks with leftover changes** starts unchecked, and the confirmation warns that their edits are lost.
Sandbox sizes read "Up to" and stay out of the cleanup estimate: on this machine the 111 changed sandboxes added up to 617 GB on a 461 GB disk, because `du` counts again the files APFS clones share with the source checkout and the package cache.
A live owner, a Git lock, or a checkout in use still keeps a sandbox, and each one is rechecked right before removal.
The daily sweep keeps changed sandboxes as before.
The preview takes longer, since each changed sandbox is measured, for up to two minutes each.

## Confirmation

`src/server/isolation-sweep.test.ts` checks that only a removal that discards changes takes a changed sandbox, that the sweep keeps it, and that a lock or a live owner still keeps it.

## Revisit when

omp starts removing or reporting its own sandboxes with unsaved changes, or the preview's measuring grows too slow to wait for.
