# Coding standards

## omp imports

Import omp's modules only from `src/omp/`, and only through `src/omp/modules.ts`.
It checks each export this app uses at startup, so add a new export there.

## Markdown

Write every Markdown file with one sentence per line.
Tools that read a doc cut a line at 768 characters, and an edit that copies the cut line back writes the truncation mark `…` into the file.
`src/docs.test.ts` fails a line over 700 characters or ending in `…` in root Markdown and all Markdown under `docs/` and `templates/omp/`, including nested agent instructions.
