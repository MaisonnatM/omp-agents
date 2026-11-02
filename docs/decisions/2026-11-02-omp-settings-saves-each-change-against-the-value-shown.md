---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp settings saves each change against the value shown

In the context of Settings › omp settings, facing hundreds of independent settings that omp's terminal or an editor may change at the same time, we chose to save each row as it changes through `PUT /api/settings/agent`, with `expected`, the user value the page showed, which the server compares with `config.yml` before it writes and answers 409 when they differ.
We rejected the Edit and Save bar Models uses, and a hash of the whole `config.yml` as Files uses.
We gain one-step edits that never undo a change made elsewhere to the same setting, and a change to another key does not refuse the save, accepting that a credential is compared only as set or not set, since its value never reaches the page.
A reset removes the key with omp's `unset` and never writes the default back, and clearing a text field resets it, as omp's panel does.

## Confirmation

`src/settings.test.ts` checks a save and a reset of one key, a refused stale save, a credential's check, and the 404 and 400 answers.

## Revisit when

omp's `config.yml` gains a version or an edit history the server can compare instead.
