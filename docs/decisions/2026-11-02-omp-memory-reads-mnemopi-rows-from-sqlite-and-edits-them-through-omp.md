---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp memory reads Mnemopi rows from SQLite and edits them through omp

In the context of listing and editing Mnemopi memories without a running session, facing an omp whose Mnemopi lists only working rows, by importance and a few at a time for a prompt (`getContext`), and whose edit path, `MnemopiSessionState.editScopedMemory`, needs a session, we chose to read each bank's working, episodic, and fact rows from its SQLite file, read-only, with the visibility rules omp's `getContext` and `get` apply, and to edit a row through omp's own `Mnemopi` class opened on the bank as `createMemory` opens it.
We rejected writing the rows with SQL, which would skip omp's re-embedding and redaction, and waiting for a sessionless export from omp.
Edits stay omp's own, with secrets redacted by `redactMemorySecrets`, accepting that `src/omp/memory.ts` mirrors omp's table names and edit rules, which a Mnemopi schema change could break.

## Confirmation

`src/memory.test.ts` seeds a bank through omp's `Mnemopi`, lists it, and updates, refuses, and forgets a row against the text the page showed.

## Revisit when

omp exports a sessionless list and edit for Mnemopi; then the page calls those and drops its mirror.
