---
status: superseded
superseded-by: 2026-11-04-list-new-session-starters-in-the-composer-suggestion-list
date: 2026-11-04
decision-makers: Maxence
---

# Show New session starters as pills under a raised composer

In the context of the New session page, facing a board of todos, past sessions, and pull requests above the composer that repeated other pages, and a request for prompts that start common work, we chose to drop the board, raise the composer to the page's upper middle with its directory and branch above it, and show ranked starters as one wrapping row of short-labelled pills under it, as Cursor's new-agent page does.
We chose it over a Starters column on the board, the composer's numbered suggestion list, a hero card, an intent palette, context cards, and a ghost prompt, so the page reads as one place to describe work with a few ways to begin, accepting that starters have no number keys and cannot be hidden, saved, or filtered as you type.

## Context

Pull request #209 put a board above the New session composer, with columns for todos, sessions to pick up, and pull requests waiting.
Todos already have the Todo page, past sessions the sidebar, and pull requests the Pull requests page, each with more room.
A Starters column then replaced the todos column, and a throwaway prototype on the `board-starters` branch tried five other shapes for the starters, which Maxence compared side by side and picked Composer chips from.
A first cut listed the starters with the composer's numbered suggestion list under a composer docked at the bottom; Maxence asked for Cursor's layout instead, the composer high on the page and the starters as pills under it.

## Options considered

- Pills under a raised composer, with short labels and the full prompt in a tooltip: the page leads with the composer, and each starter reads at a glance; chosen.
- The composer's numbered suggestion list under a docked composer: one look for every prompt the composer offers, but seven full prompts stacked at the page's bottom read as a reply's suggestions, not as ways to begin.
- A Starters column on the board: keeps the board, which repeats other pages and pushes the composer down.
- A hero card, an intent palette, context cards, and a ghost prompt: each turned down in the side-by-side comparison.

## Consequences

A new session shows the directory and branch pickers above the composer, the composer about a fifth of the way down the page, and the starters under it while the draft is empty; a scheduled start keeps the docked composer and its note.
A click on a pill puts its full prompt in the composer unsent, with the caret after it.
The starters keep Composer chips' ranking, short labels, and filled-in blanks, from `rankedStarters`, which a later decision removed.
They have no number keys, since pills carry no numbers and digits type in an empty composer, and no hide button, filtering as you type, or saving the draft as a starter, since the row hides once the draft holds text.
The raised composer leaves too little room above it for the `/` and `@` list, so `useCompletion` takes `below` and opens that list under a new session's composer, over the starters.

## Revisit when

Users ask to hide a starter, keep their own, or pick one after they started typing.
