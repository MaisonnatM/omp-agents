---
status: accepted
date: 2026-11-11
decision-makers: Maxence
---

# A workflow skill draws its own diagram

In the context of Settings › Workflows, facing a flowchart built from a skill's numbered step titles that drew `/ship` as a straight line of eight steps while `ship_stage` records nine stages with skipped reviews and a live review loop, we chose to draw a skill's first `mermaid` fence when it has one and the step line only without one, over retitling the ship skill's steps to match the stages, so a workflow can show its branches and loops, accepting a diagram that its author keeps in step with the steps by hand and that every session running the skill reads as context.

## Consequences

The ship skill's diagram shows the Ready gate, the Merged end, the review skips, and the rebase, comment, and CI loop that the step line could not.
A skill without a fence still gets its steps drawn, so nothing changes for other workflows.
An edit to the ship skill's steps must update its diagram in the same file, which nothing checks.

## Confirmation

`web/components/settings/workflows-tab.test.tsx` checks that a skill's own diagram wins over its steps.

## Revisit when

A second workflow's diagram drifts from its steps; then derive the diagram from structured stages instead.
