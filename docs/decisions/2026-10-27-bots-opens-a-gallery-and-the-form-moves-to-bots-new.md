---
status: accepted
date: 2026-10-27
decision-makers: Maxence Maisonnat
---

# `#bots` opens a gallery and the New Bot form moves to `#bots/new`

In the context of the **Bots** tab, whose `#bots` address opened the New Bot form, facing a user with several Bots and no page that shows them side by side, we chose a gallery of Bot cards at `#bots` and the form at `#bots/new` over keeping the form at `#bots` with the gallery elsewhere, to make the tab's own page show what you have before what you could add, accepting that old `#bots` links now open the gallery.

## Context

Grok's companions open on a grid of cards, each with a face and a one-line tagline, and the user asked for the same.
The sidebar's **Bots** tab already lists every Bot as a messaging-app row, but only one line of its last message, never its job.
Bot ids are UUIDs, as routine ids are, so `new` cannot name a Bot.

## Options considered

- Keep the form at `#bots` and put the gallery at `#bots/all`: no address changes meaning, but the tab's own page stays a form most visits skip.
- Gallery at `#bots`, form at `#bots/new`, as `#email/new` is beside `#email`: chosen.

## Consequences

- Choosing the **Bots** tab opens the latest Bot's page, as Sessions opens the latest session, so the gallery is reached by its address and the tab's grid button.
- `BotsRoute` gains `adding` beside `target: null`, and `hashForNewBot()` names the form.
- Deleting a Bot lands on the gallery instead of the form.
- Settings › Activity counts `bots` and `bots/new` as two views.

## Confirmation

`web/routing.test.ts` parses and builds both addresses.

## Revisit when

The sidebar's rows show enough of each Bot that the gallery adds nothing.
