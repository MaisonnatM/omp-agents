---
status: accepted
date: 2026-11-04
decision-makers: Maxence
---

# List New session starters in the composer's suggestion list

In the context of the New session page, facing starters drawn as pills that looked unlike the suggested prompts a finished turn offers, and Maxence's request that they look like those, we chose to list the starters in the composer's numbered suggestion list, `useSuggestions`, under the raised composer, showing each starter's short label.
We chose it over the pills, so every prompt the composer offers looks and works the same, accepting that an empty composer's digits pick a starter instead of typing.

## Context

[Show New session starters as pills under a raised composer](2026-11-04-show-new-session-starters-as-pills-under-a-raised-composer.md) turned down this list when it sat under a composer docked at the bottom and showed seven full prompts.
The composer now stays raised and the rows show the short labels, which answers that record's objection.

## Options considered

- The composer's suggestion list with short labels under the raised composer: one look and one set of keys for every suggested prompt; chosen.
- Pills: the previous choice, which looked like no other part of the composer.

## Consequences

The starters show inside the composer, under its action bar, while the draft is empty, with the same digits, arrows, Tab, Enter, and marks as a turn's suggestions; `useSuggestions` takes `labelOf` so a row can show a label instead of its prompt.
Every pick, by click, digit, Enter, or Tab, puts the prompt in the composer unsent with the caret after it, since starters such as `/ship ` wait for a blank.
**All of them** fills the chosen starters as a Markdown list.
A starter's pick records `composer-suggestions.pick`.

## Revisit when

Users ask for a starter to start the session in one key.
