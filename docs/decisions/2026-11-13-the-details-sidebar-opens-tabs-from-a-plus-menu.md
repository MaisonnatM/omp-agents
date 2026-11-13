---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
---

# The details sidebar opens tabs from a + menu

In the context of the session and Bot details sidebars, whose segmented control showed every tab at once and fell back to icons alone from five tabs, facing Maxence's request that the right sidebar's elements be tabs as in Capy, we chose a row of open tabs that starts with the first tab alone and a **+** menu listing every tab the view can show, each opened tab closable with its ×.
We chose it over the segmented control, so the header shows names at any width and only what the person opened, accepting that a tab not yet opened, such as **PRs**, takes a click on **+** before its first use.

## Context

Capy's side panel opens Overview, Diffs, Files, and the rest from a **+** menu and shows them as tabs beside Overview.
The header's own tabs, `HeaderTabs`, already draw tabs with an × that shows on hover, which the sidebar's tabs now match.

## Consequences

The sidebar keeps the open tabs and the one on screen in one localStorage entry per sidebar; an older single tab name opens that tab.
The first tab, **Overview** or a Bot's **Details**, is always open.
**Review visuals** and a saved artifact open their tab when it is closed.
The tabs no longer need the icon-only fallback that five or more tabs did.

## Revisit when

People keep the same tabs open in every session, which would argue for opening them by default.
