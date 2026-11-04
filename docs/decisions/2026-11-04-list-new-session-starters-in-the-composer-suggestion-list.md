---
status: accepted
date: 2026-11-04
decision-makers: Maxence
supersedes: 2026-11-04-show-new-session-starters-as-pills-under-a-raised-composer
---

# List New session starters in the composer's suggestion list

In the context of the New session page, facing starters drawn as pills under a raised composer that looked unlike the suggested prompts a finished turn offers, and Maxence's request that they look like those and that the composer sit at the bottom, we chose to dock the composer at the page's bottom, as a live session's is, and list the starters in its numbered suggestion list, `useSuggestions`, showing each starter's short label.
We chose it over the pills under a raised composer, so a new session's composer looks and works as a live session's does, accepting that an empty composer's digits pick a starter instead of typing.

## Context

[Show New session starters as pills under a raised composer](2026-11-04-show-new-session-starters-as-pills-under-a-raised-composer.md) turned down this list, docked at the bottom, because seven full prompts read as a reply's suggestions.
The rows now show the short labels, and Maxence asked for the docked look itself.

## Options considered

- The composer's suggestion list with short labels, the composer docked at the bottom: one look and one set of keys for every suggested prompt; chosen.
- Pills: the previous choice, which looked like no other part of the composer.

## Consequences

The composer docks at the page's bottom with the directory and branch pickers above it, and the `/` and `@` list opens above it again, so `useCompletion` lost its `below` option.
The starters show inside the composer, under its action bar, while the draft is empty, with the same digits, arrows, Tab, Enter, and marks as a turn's suggestions; `useSuggestions` takes `labelOf` so a row can show a label instead of its prompt.
Every pick, by click, digit, Enter, or Tab, puts the prompt in the composer unsent with the caret after it, since starters such as `/ship ` wait for a blank.
**All of them** fills the chosen starters as a Markdown list.
A starter's pick records `composer-suggestions.pick`.

## Revisit when

Users ask for a starter to start the session in one key.
