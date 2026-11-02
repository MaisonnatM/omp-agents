---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# omp memory saves its settings to your config.yml only

In the context of the backend picker and **Auto-learn** in Settings › omp memory, facing a choice between your `~/.omp/agent/config.yml`, which applies in every workspace and to terminal sessions, and a workspace's `.omp/config.yml`, we chose to save to your `config.yml` only, through `PUT /api/settings/agent` like omp settings, and to lock a control whose value the workspace sets.
We rejected an **Only this workspace** choice, which would write a file the repository may commit and add a second writer to keep in step with omp settings.
One write path and one lock rule hold across both sections, accepting that turning memory on applies everywhere, and that a per-workspace backend is set by editing the workspace's file in **Files**.

## Revisit when

Users ask for memory in some workspaces only, or omp settings gains workspace writes.
