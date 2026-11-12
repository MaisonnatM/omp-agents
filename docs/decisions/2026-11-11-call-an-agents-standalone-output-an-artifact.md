---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Call an agent's standalone output an artifact

In the context of a panel that shows what an agent made apart from its replies, facing a name that omp already uses for the folder where it spills tool output and subagent files, we chose **Artifact**, Claude's word and the one the user asked for, over **Canvas** and **Document**.
We chose it so the feature reads the way users already know it from Claude, accepting that code touching omp's artifacts directory, such as `artifactsDir` in `src/subagents.ts`, sits near code about artifacts, which the glossary entry keeps apart.

## Options considered

- **Artifact**: familiar from Claude; clashes with omp's internal artifacts directory, which users never see in the dashboard.
- **Canvas**: no clash, but it suggests a surface the user edits by hand.
- **Document**: plain, but wrong for an HTML app or an SVG image.

## Revisit when

The dashboard starts showing omp's artifacts directory to users, so both meanings would share one screen.
