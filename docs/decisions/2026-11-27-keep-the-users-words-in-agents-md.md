---
status: accepted
date: 2026-11-27
decision-makers: Maxence Maisonnat
---

# Keep the user's words in AGENTS.md

In the context of agents misreading the user's own words, such as "plan" or "project", which `GLOSSARY.md` cannot cover because it holds one repository's vocabulary, we chose a `## My words` section in `~/.omp/agent/AGENTS.md` that agents fill in on their own whenever the user corrects a word, over a store with its own tool and dashboard page and over `_You say_:` lines in each repository's glossary.
Every session in every repository gets the words in its cached head with no tool call, and Settings sync already carries the file, accepting a file the installer then treats as edited and a list agents grow without review.

## Options considered

- **A store with a tool and a page, like project memory.** Editable on its own page, but a tool, a store, and a page for about thirty lines.
- **`_You say_:` lines in each repository's `GLOSSARY.md`.** Reach only sessions in that repository, and only once they read the glossary.

## Revisit when

The section grows past what a session's head should carry, or agents add lines the user removes.
