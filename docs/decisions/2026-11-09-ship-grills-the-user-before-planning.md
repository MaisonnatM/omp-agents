---
status: accepted
date: 2026-11-09
decision-makers: Maxence Maisonnat
---

# /ship grills the user with grill-with-docs before it plans

In the context of the starter kit's `/ship` Plan stage, facing arena runners that plan from a request whose open product calls nobody settled, we chose to run `grill-with-docs` after the stage reads the request and the code and before it lists approaches, over planning straight from the request and over a grill only when the arena runs.
The runners then plan within the user's answers, and the settled terms and choices land in `GLOSSARY.md` and `docs/decisions/`, accepting at least one round of questions before any plan on every change that leaves a decision open.
A request that leaves nothing to decide, such as a typo, skips the grill, and the report says so.
