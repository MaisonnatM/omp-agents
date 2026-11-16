---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# The Pull requests page has no board

In the context of the Pull requests page, which showed its pull requests either as a table by repository or as a board with a column per section, facing Maxence's request to remove the board, we chose to delete the board and its switch so the page always shows the table, over keeping the board behind the switch and over keeping its drop actions somewhere else.
The page has one layout to read, keep, and test, and we accept losing a drag onto a column as a way to start a pull request's quick action, merge it, or change its draft state; the row's `⋯` menu, its move badge, and the details still do each of those.

## Context

The board held the same sections as the table, as columns of cards over every repository, with its own folds, its own keys, and a drag that ran the step a column stands for.
It kept a second card component, a pointer drag of its own, a Space key binding, two activity controls, and two stored values, the view and the columns' folds.

## Options considered

- Keep the board behind **List** and **Board**: no change for someone who used it, but keeps a second layout, its drag, and its keys to maintain beside the table.
- Remove the board and move its drops to the table: keeps drag to change a state, but the table's drag already reorders, so one gesture would mean two things.
- Remove the board and its switch: chosen, the table and its menus already offer every step the board's drops ran.

## Consequences

- The page loses **List** and **Board**, and the Space shortcut that picked up a card.
- The browser's stored `omp-agents.pull-requests-view` and `omp-agents.pull-requests-board-folds` values are no longer read.
- The activity log no longer records `pull-requests.view.list` or `pull-requests.view.board`.

## Confirmation

`bun run typecheck` and `bun test` pass with the board's component, its pointer drag, and its model and tests gone.

## Revisit when

Revisit if the table stops being enough to see which pull requests wait on whom across repositories, which a board by section answers at a glance.
