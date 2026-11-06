---
status: accepted
date: 2026-11-06
decision-makers: agent
---

# Pin council members with per-call models

For the starter kit's council skill, each member must answer on its requested model or fail without substitution.
We chose one council agent with an explicit model on each task item over three role-backed agents, because omp's per-call workers disable automatic model fallback.
The agent grants the three exact models, and the kit enables per-call selection with an allowlist containing those models.
This avoids duplicating the member prompt, accepting that adding a council model requires updating both the agent's model list and the global allowlist.
The allowlist also limits per-call model selection for other delegations, not just the council.

Per-call workers bypass quota-aware fallback routing, so the skill checks usage before dispatch and reports an exhausted member instead of choosing another route.
Paid usage requires the user's explicit approval for that route.
