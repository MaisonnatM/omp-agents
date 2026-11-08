---
status: accepted
date: 2026-11-08
decision-makers: Maxence Maisonnat, agent
---

# Record grilling decisions with decision-records

In the context of the starter kit's copy of Matt Pocock's `domain-modeling` skill, which `grill-with-docs` loads, facing two rules for the same decision, its own numbered ADRs in an adr folder under docs, offered only past three tests, and the kit's `decision-records` skill, which keeps every choice between viable options as a dated file in `docs/decisions/`, we chose to replace the skill's ADR section with a pointer to `decision-records`.
We rejected keeping the upstream ADR rules, which would start a second records folder beside `docs/decisions/`, and keeping its three tests as a stricter filter, which would tell an agent to skip choices that `decision-records` tells it to record.
This keeps one place and one rule for decisions in every project, accepting that the kit's `domain-modeling` no longer matches upstream and that a grilling session records more decisions than Matt's version does.

## Confirmation

The kit's `domain-modeling/SKILL.md` names no adr folder and links `../decision-records/SKILL.md`, and the kit ships no `ADR-FORMAT.md`.

## Revisit when

Upstream `domain-modeling` changes its decision rules, or the kit drops `decision-records`.
