---
status: accepted
date: 2026-11-04
decision-makers: Maxence
---

# List New session starters as the composer's suggested prompts

In the context of the New session page, facing a board of todos, past sessions, and pull requests above the composer that repeated other pages, and a request for prompts that start common work, we chose to drop the board and list ranked starters under the composer with the component that lists a reply's suggested prompts.
We chose it over a Starters column on the board, a hero card, an intent palette, context cards, a ghost prompt in the empty composer, and chips under the composer, to keep one look and one set of keys for prompts the composer offers, accepting that a starter cannot be hidden, saved, or filtered as you type.

## Context

Pull request #209 put a board above the New session composer, with columns for todos, sessions to pick up, and pull requests waiting.
Todos already have the Todo page, past sessions the sidebar, and pull requests the Pull requests page, each with more room.
A Starters column then replaced the todos column, and a throwaway prototype on the `board-starters` branch tried five other shapes for the starters, which Maxence compared side by side.
The composer already lists a reply's suggested prompts under its action bar while the draft is empty, numbered, with keys to send or fill each one.

## Options considered

- Starters in the composer's suggestion list, filled in and ranked: one component and one set of keys for every prompt the composer offers, and the page shrinks to the composer; chosen.
- A Starters column on the board: keeps the board, which repeats other pages and pushes the composer down.
- Composer chips, Maxence's pick of the prototype: ranked chips with filled-in blanks, a hide button, filtering as you type, and saving the typed draft as a starter, but with a look and keys of their own beside the suggestion list.
- A hero card, an intent palette, context cards, and a ghost prompt: each a second way to offer a prompt, and each turned down in the side-by-side comparison.

## Consequences

The New session page shows the empty-draft note and the composer, with the starters numbered under its action bar while the draft is empty.
`useSuggestions` takes no `onSend` for starters, so a number, a click, Enter, and Tab all fill the composer, and a starter never sends; the list has no marks, no 0, and no **All of them** row there.
The starters keep Composer chips' ranking and filled-in blanks, from `starterPrompts` in `web/starters.ts`.
They drop the hide button, since suggestion rows have no buttons of their own, and filtering as you type and saving the draft as a starter, since the list hides once the draft holds text.

## Revisit when

Users ask to hide a starter, keep their own, or pick one after they started typing.
