---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp memory reads Mnemopi rows through omp's export and edits them through omp

In the context of listing and editing Mnemopi memories without a running session, facing an omp whose Mnemopi lists only working rows, by importance and a few at a time for a prompt (`getContext`), and whose edit path, `MnemopiSessionState.editScopedMemory`, needs a session, we chose to open each bank with omp's own `Mnemopi` class as `createMemory` opens it, to list its working and episodic rows from `beam.exportToDict` filtered in the page's server with the visibility rules omp's `get` applies, and to edit a row through the same class.
Facts are the one SQL read left, a query of the bank's `facts` table through `beam.db`, since omp exports and lists no facts.
We rejected reading every table with SQL, which mirrored omp's schema and applied the liveness rules after its row limit, writing rows with SQL, which would skip omp's re-embedding and redaction, and waiting for a sessionless list from omp.
Reads and edits stay omp's own, with secrets redacted by `redactMemorySecrets`, accepting that `src/omp/memory.ts` mirrors omp's visibility and edit rules and the `facts` columns, which a Mnemopi change could break, and that a listing reads the whole bank before it keeps the newest 500.

## Confirmation

`src/memory.test.ts` seeds a bank through omp's `Mnemopi`, lists it, and updates, refuses, and forgets a row against the text the page showed, and lists neither another bank's row nor one past its end.

## Revisit when

omp exports a sessionless list of a bank's rows and facts, or a sessionless edit; then the page calls those and drops its mirror.
