---
status: accepted
date: 2026-11-23
decision-makers: agent
---

# Editing workers run on the task role and the planner stays

In the context of the starter kit's model routing, facing `poteto-agent` and `task` workers spending about $1005 of $1920 over 14 days on the planner's Opus, we chose to point `poteto-agent` at the `@task` role, as the bundled `task` agent already is, and set the kit's `task` role to `anthropic/claude-sonnet-5-5:auto`, over a `task.agentModelOverrides` entry or a new worker agent.
One role keeps both workers on one model that a user moves with one setting, and a planner still passes Opus per call for a spawn whose output is judgment, from the list in `templates/omp/agent/docs/model-routing.md`.
We accept that Sonnet's worker quality is unmeasured: the replay in `docs/architecture/token-cost.md` decides whether `task` stays on it, and an existing config keeps its own `task` role until its user changes it.

## Confirmation

Replay at least 20 worker prompts with `scripts/token-audit/model-replay.ts` on Opus and Sonnet; set `task` back to Opus if Sonnet keeps the checks less often or loses more judge verdicts than it wins.
