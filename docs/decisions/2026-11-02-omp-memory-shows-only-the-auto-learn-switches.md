---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp memory shows only the Auto-learn switches

In the context of **Auto-learn**, which also writes managed skills under `~/.omp/agent/managed-skills`, we chose to show only its switch and the switch for its capture turn at stop.
We rejected listing the managed skills here, since they are skills, which **Files** already lists and edits, not memories of a workspace.
The section stays about what omp remembers in one workspace, accepting that a user who wants to see what **Auto-learn** wrote opens **Files**.

## Revisit when

Managed skills need actions **Files** does not give them.
