---
status: accepted
date: 2026-11-13
decision-makers: Maxence
---

# A header tab follows where you go in it

In the context of the header tabs of [The window uses an inset sidebar and a tab strip across the top](2026-11-13-the-window-uses-an-inset-sidebar-and-a-tab-strip-across-the-top.md), facing a row that grew a tab for every page and session you clicked, we chose tabs that work like Capy's and a browser's: going somewhere shows it in the tab on screen, and only the + opens a new tab.
We accept that the tabs stored before this reset once, and that a page you leave in a tab is gone from the row until you open it again.

## Context

Maxence asked that clicking a session or a page stop opening a new tab, as in Capy, where a thread pane's tabs follow its links and its + menu opens new ones.

## Options considered

- Keep one tab per page kind and session, eight at most: the row filled on its own and every click moved focus to another tab.
- Preview tabs, as Capy's thread pane opens files: a tab you only pass through closes when you move on, and a double-click keeps it; more to learn for a row of pages.
- Each tab follows where you go in it, and + opens a new one: chosen, the browser's rule.

## Consequences

- A tab has an id of its own and the address it shows now, so it keeps its place and its drag order while you move through pages in it.
- Going to a page or session another tab already shows focuses that tab, so no two tabs show the same thing.
- The + opens New session in a new tab; the sidebar's **New session** row and Cmd+N open it in the tab on screen.
- The row has no limit: it grows only when you ask for a tab.

## Confirmation

`web/header-tabs.test.ts` checks that going somewhere stays in the same tab, that only a new-tab request adds one, and that going to what another tab shows focuses it.
A browser smoke clicked Todo, Notes, the +, Bots, Pull requests, and Calendar in the sidebar and saw two tabs, then closed the one on screen and went Back.

## Revisit when

Revisit if you often want a page kept open beside another, such as a Cmd+click that opens a sidebar row in a new tab.
