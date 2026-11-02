---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp memory shows Hindsight read-only

In the context of the Hindsight backend, whose memories live on a Hindsight server, facing a delete that omp offers only per retained document, `HindsightApi.deleteDocument`, which forgets a whole session's transcript at once, we chose to list the bank's memories read-only, with the picker still working when the server cannot be read.
We rejected offering that delete, since one click would remove far more than the row it sits on.
The page shows what Hindsight recalls without a destructive action whose reach the row does not show, accepting that a wrong Hindsight memory is still fixed on the server.

## Revisit when

omp or Hindsight offers a delete of one memory.
