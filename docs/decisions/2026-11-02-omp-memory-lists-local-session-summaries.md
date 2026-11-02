---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp memory lists Local's session summaries

In the context of the Local store, which keeps one summary per summarized session under `rollout_summaries/` beside the lessons, the summary, and the skills, we chose to list them under **Session summaries**, and to list only the files that exist.
We rejected hiding them as omp's working files, since they are what the summary is rebuilt from and a wrong one keeps coming back.
A user can find and fix the source of a bad summary, accepting a longer file list, which the filter narrows once it holds more than eight files.

## Revisit when

omp stops rebuilding the summary from these files, or users find the list noise.
