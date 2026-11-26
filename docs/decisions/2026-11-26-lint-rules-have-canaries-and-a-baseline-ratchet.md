---
status: accepted
date: 2026-11-26
decision-makers: agent
---

# Lint rules have canaries and a baseline ratchet

In the context of turning recurring lessons into checks, facing Biome as the only linter, a config that can drop a rule silently, and a rule that `CODING_STANDARDS.md` allowed only when it had a handful of hits, we chose a small rule runner of our own in `scripts/lint/`, a canary file per rule, and a per-rule, per-file baseline that may only fall, over Biome GritQL plugins and over one-off `bun test` scans.
A rule can now read repository files such as `GLOSSARY.md`, land with its existing findings listed, and fail the tests the day it stops firing, accepting a second lint step in `bun run lint`, a `lint-baseline.json` that changes with fixes, and a `lint-baseline: <reason>` commit line to raise it.
The approach follows the lint ratchet and canary scripts of [mattpocock/cookout](https://github.com/mattpocock/cookout).

## Options considered

- Biome GritQL plugins keep every rule in one tool and honour `biome-ignore`, but a pattern cannot read another file, count a file's size, or carry a baseline.
- One `bun test` file per rule, as `src/serve-idle-timeout.test.ts` and `src/extension-zod-defaults.test.ts` were, needs no new code, but every file repeats its own glob and scan, and none can land with findings it does not fix.
- An ESLint or oxlint plugin setup, as cookout has, gives AST rules and fixers at the cost of a second linter's config and dependency beside Biome.

## Confirmation

`scripts/lint/canaries.test.ts` fails a rule with no canary or a canary its rule ignores, and `scripts/lint/run.test.ts` covers growth, a stale baseline, and a raise with and without the commit line.
`.omp/land.json` runs `bun run lint --base="$LAND_BASE"`, so a baseline raised on a branch fails the landing unless a commit says why.

## Revisit when

Biome plugins can read files and keep a baseline, or the rules need fixers or type information a text scan cannot give.
