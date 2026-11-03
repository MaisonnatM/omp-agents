---
status: accepted
date: 2026-11-02
decision-makers: Maxence Maisonnat
---

# omp memory shows each store in its own shape

In the context of Settings › omp memory, facing five omp memory backends that keep very different stores, we chose a backend bar over the store: the backend picker and **Auto-learn** on top, then the store of the backend in effect as it is, Local's and Sharpshooter's files in the **Files** view and Mnemopi's and Hindsight's rows in a list.
We rejected one entry list beside an open entry for every backend, and a memory tab in the session sidebar.
The bar turns memory on from the off state, and no store is shown as something it is not, accepting two shapes to build and maintain in one section.

## Options considered

- Backend bar over the store, chosen: files stay files, rows stay rows, and Hindsight stays remote, and the file view already existed.
- One entry list for every backend: one interaction everywhere, but it splits the file backends' prose into entries that the next consolidation rewrites, so an edit could silently vanish.
- A session sidebar tab: closest to the moment a bad lesson shows, but it needs a live session, whose memory is fixed when it starts, and it cannot turn memory on.

## Consequences

A user sees exactly what each backend keeps and can fix it where it lives.
A new backend in omp needs its own store shape here; until then the bar can pick it and the store says the page cannot show it yet.
The proposal is in `tmp/designs/omp-memory.md` on the branch that built it.

## Revisit when

The section proves useful and a session sidebar link into it is wanted, or omp adds a backend.
