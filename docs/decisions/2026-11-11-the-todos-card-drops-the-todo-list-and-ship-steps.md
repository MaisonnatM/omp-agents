---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# The Todos card drops the todo list and the Ship steps

In the context of the Todos card at a transcript's top right, which stacked the /ship stepper, the agent's own todo list, then the **Subagents**, **Files**, **Images**, and **Sources** sections, facing Maxence's request to remove the todo and ship sections from it, we chose to delete those two sections and the todo-list data that only fed them, and to keep the card's name for now.
We chose it over hiding the two sections behind a setting and over renaming the card in the same change, so the card holds only what the agent spawned and touched, accepting that the dashboard no longer shows the agent's todo list or the /ship step anywhere and that the name **Todos card** no longer matches its contents.

## Context

The card's Ship section read `SessionFacts.ship`, and its todo list read the `todos` that `src/transcript.ts` copied from each successful `todo` call onto the tool row, which `transcriptModel` in `web/transcript-view.ts` carried to the card.
Nothing else on the page read that todo list.
`SessionFacts.ship` has another reader: the Todo page's work state shows **Shipped** once a linked session's run reaches `merged`.

## Options considered

- Delete both sections and the todo-list data: the card and the transcript model lose code nobody else reads; chosen.
- Keep the sections behind a new preference: no code leaves, but it adds a switch Maxence did not ask for.
- Delete the sections and rename the card, its toggle, its preference, and its stored key: names would match, but the rename touches the synced preference key and every doc, and Maxence asked only for the removal.

## Consequences

The card shows once it has subagents, files, images, or sources, and the header's checklist toggle appears under the same rule.
A tool row no longer carries `todos`, and the todo-list types in `src/shared/transcript.ts` and Arc's vertical stepper are gone.
The ship progress the server records stays, for the Todo page's **Shipped** state.
The Activity controls `transcript.todos` and `transcript.ship` are gone; Settings › Activity lists features from the page's registries, so rows already stored under those ids are no longer listed and break nothing.
The stored folds `omp-agents.todos-card-open` and `omp-agents.todos-card-ship-open` stay in localStorage unread.
**Show todos card**, `omp-agents.todos-card-shown`, `SessionTodosCard`, and `TodosCardToggle` keep their names.

This record replaces only what these records say about the todo list and the ship stepper inside the card, so they stay accepted:
`2026-10-28-files-images-and-sources-live-in-the-todos-card` (the todo list as the card's first section), `2026-11-03-subagents-live-in-the-todos-card` (the Subagents section after the todo list), `2026-11-03-show-todos-card-hides-the-whole-card` (the card holding the todo list and the /ship steps), `2026-11-10-the-todos-card-floats-beside-the-messages-again` (the todo list and the ship stepper folding, and their header words), and `2026-11-02-agents-start-ship-themselves-and-ship-without-a-ticket` (the dashboard's Ship card dropping a stopped run).

## Revisit when

Maxence wants the agent's plan or the /ship step back in view, or asks to rename the card to match what it holds.
