---
status: accepted
date: 2026-11-04
decision-makers: Maxence
---

# Send every UI change through a workflow with a separate critic

In the context of agents doing design work on omp-agents and yampa, facing first rounds rejected whole, the app's own components ignored, and layout bugs the user found himself, we chose one always-loaded workflow skill with a separate `design-critic` agent over installing a direction-setting design skill and over builder self-critique.
It checks the app and the user's references before the first edit and has a fresh agent measure screenshots before the user sees them, accepting a few extra minutes and tokens on every UI change, one-value tweaks included.

## Context

Thirteen design sessions from 2026-10-26 to 2026-11-04 showed the failures.
The whole first round of options was rejected in 7, the app's existing components were ignored in 6, the user supplied the reference in 6, and layout bugs reached him in 5.
In one session the agent wrote that buttons sat about 5px low, then shipped them.
Seven of the thirteen read no design skill, so guidance that already existed went unused.
A generic AI look appeared in 2.

## Options considered

- A direction-setting skill, such as Anthropic's `frontend-design`, Impeccable, or Taste Skill: each sets a fresh visual identity, which fights the rule that the app's existing pattern wins unless the user asks for a redesign, and the generic look it targets was the rarest failure.
- Builder self-critique: cheapest, but the builder already took screenshots in nearly every session and still missed or excused the bugs.
- Impeccable's detector as a hook on every edit: catches AI tells with no model, but its rules may clash with an app's own design system.

## Consequences

The user sees five structurally different variants for a structural ask, built from the app's shared components, and a critic report instead of discovering bugs.
Every UI change costs a critic run, up to two rounds.
The critic runs on the `default` role, so both builder and critic follow that role's model, Opus here.
The user's saved UI library is personal, so its path lives in the user's own `AGENTS.md`, not the kit.

## Revisit when

Revisit when design sessions still end with the user reporting layout bugs or rejecting first rounds, or when the critic's cost on small tweaks outweighs what it catches.
