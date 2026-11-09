---
status: superseded
date: 2026-10-20
decision-makers: Maxence Maisonnat
superseded-by: 2026-11-09-drop-graphite-from-the-dashboard-and-starter-kit
---

# Plain git, not Graphite, for this repository

omp-agents uses `git`, `git push`, and `gh pr create --draft`, and never `gt`, even where the maintainer's other repositories use Graphite.
The starter kit's `git-workflow.md` names this exception.
