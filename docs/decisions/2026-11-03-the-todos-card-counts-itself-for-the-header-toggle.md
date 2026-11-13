---
status: deprecated
date: 2026-11-03
decision-makers: agent
---

# The Todos card counts itself for the header toggle

In the context of the checklist toggle in a session's header, which Maxence asked to show only when the Todos card can appear, facing a header that sits beside the transcript and holds none of the card's inputs, we chose to let `SessionTodosCard` count itself, per view, in a keyed store while it is mounted with a section to show, and to let `TodosCardToggle` render only while that count is above zero.
We chose it over the header computing the same rule from the pane store, the session facts, and the subagent links, to keep one place that decides what the card shows, accepting a toggle that appears one layout pass after the card's inputs arrive and a store that a mounted card must keep in step.

## Options considered

- The card counts itself: one rule, the card's own, and the toggle leaves when the trajectory unmounts the transcript; chosen.
- The header recomputes the rule: no store, but the todo list comes from the transcript model, so the header would scan the transcript on every streamed token, and the two copies of the rule can drift when a section is added.
- A boolean instead of a count: simpler, but two transcripts of the same view would clear each other's flag when one unmounts.

## Revisit when

The header gains another reader of what the card shows, or the card's sections move out of the transcript.
