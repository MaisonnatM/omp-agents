---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Forget everything keeps the shared Mnemopi bank

In the context of **Forget everything** in Settings › omp memory, facing Mnemopi scopes where a workspace also reads the bank every workspace shares, which omp's `/memory clear` deletes too, we chose to delete only the workspace's own banks and keep the shared one, and to refuse the clear when every bank the workspace reads is shared.
We rejected matching `/memory clear`, since a clear started from one workspace's page would wipe what every other workspace remembers.
A user forgets one folder's memory without touching the others, accepting that the page's clear differs from omp's, and that the shared bank's memories are forgotten one by one, under a note that each change applies everywhere.

## Confirmation

`src/memory.test.ts` checks that the clear removes the workspace's bank, keeps the shared one, and is refused under global scoping.

## Revisit when

Users ask to clear the shared bank from the page, or omp's clear stops deleting it.
