---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# The Todos card drops the todo list and the Ship steps and becomes the Session card

In the context of the Todos card at a transcript's top right, which stacked the /ship stepper, the agent's own todo list, then the **Subagents**, **Files**, **Images**, and **Sources** sections, facing Maxence's request to remove the todo and ship sections from it, we chose to delete those two sections and the todo-list data that only fed them, and to rename the card the **Session card** in the same change.
We chose it over hiding the two sections behind a setting and over keeping the old name, so the card holds only what the agent spawned and touched and its name says so, accepting that the dashboard no longer shows the agent's todo list or the /ship step anywhere and that the stored keys keep the old name.

## Context

The card's Ship section read `SessionFacts.ship`, and its todo list read the `todos` that `src/transcript.ts` copied from each successful `todo` call onto the tool row, which `transcriptModel` in `web/transcript-view.ts` carried to the card.
Nothing else on the page read that todo list.
`SessionFacts.ship` has another reader: the Todo page's work state shows **Shipped** once a linked session's run reaches `merged`.

## Options considered

- Delete both sections and the todo-list data, and rename the card: the card and the transcript model lose code nobody else reads, and the name matches what is left; chosen.
- Keep the sections behind a new preference: no code leaves, but it adds a switch Maxence did not ask for.
- Delete the sections and keep the name **Todos card**: a smaller change, but the name would promise a todo list the card no longer holds.

## Consequences

The card shows once it has subagents, files, images, or sources, and the header's card toggle appears under the same rule.
A tool row no longer carries `todos`, and the todo-list types in `src/shared/transcript.ts` and Arc's vertical stepper are gone.
The ship progress the server records stays, for the Todo page's **Shipped** state.
The Activity controls `transcript.todos` and `transcript.ship` are gone; Settings › Activity lists features from the page's registries, so rows already stored under those ids are no longer listed and break nothing.
The stored folds `omp-agents.todos-card-open` and `omp-agents.todos-card-ship-open` stay in localStorage unread.
The card is `SessionCard` in `session-card.tsx` under `web/components/`, its toggle is `SessionCardToggle` with a list icon in place of the checklist, the preference reads **Show session card**, and the card's other files are named `session-card*`; the card later moved to the session details sidebar's **Overview** tab, as `2026-11-13-the-session-card-moves-to-an-overview-tab` says.
The stored keys keep the old name, so each user's choices survive the rename: `omp-agents.todos-card-shown`, which settings sync also carries, `omp-agents.todos-card-subagents-closed`, and the Activity control ids `todos-card.toggle` and `changes-card.*`, whose recorded counts would otherwise start over.

This record replaces only what these records say about the todo list and the ship stepper inside the card, so they stay accepted:
`2026-10-28-files-images-and-sources-live-in-the-todos-card` (the todo list as the card's first section), `2026-11-03-subagents-live-in-the-todos-card` (the Subagents section after the todo list), `2026-11-03-show-todos-card-hides-the-whole-card` (the card holding the todo list and the /ship steps), `2026-11-10-the-todos-card-floats-beside-the-messages-again` (the todo list and the ship stepper folding, and their header words), and `2026-11-02-agents-start-ship-themselves-and-ship-without-a-ticket` (the dashboard's Ship card dropping a stopped run).

## Revisit when

Maxence wants the agent's plan or the /ship step back in view.
