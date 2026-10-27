---
status: accepted
date: 2026-10-20
decision-makers: Maxence Maisonnat
---

# Import omp's modules instead of reimplementing them

The server imports omp's own modules from the installed package, only from `src/omp/`, and only through `src/omp/modules.ts`.
A reimplemented protocol, encryption, or session-file format drifts from the omp version the user runs; an import always speaks that version.
`src/omp/modules.ts` checks every export at startup, so a breaking omp release fails loudly with the missing export instead of misreading sessions.
See [omp modules](../architecture/omp-modules.md).
