---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# Bot sections live on each Bot as a name

In the context of the **Bots** tab and the `#bots` gallery, facing a user who wants to group Bots into sections and keep favorites pinned at the top, as Grok does, we chose a `pinned` flag and a `section` name on each Bot over a separate list of sections in `bots.json`.
That keeps the file a list of Bots and the reducer a function of that list, accepting that sections sort by name, cannot be reordered, and cannot stay empty.

## Context

`bots.json` holds `{ bots }`, and `applyBot` reduces that list on the server and, optimistically, on the page.
The `bots` socket message carries the same list, and the Bot extension reads it to find its own Bot.
A section with no Bot in it has nothing to show in either surface.

## Options considered

- `pinned` and `section` on each Bot, a section being the name its Bots share, sorted by name: chosen.
  New ops `pin`, `move`, and `rename-section` edit them, a save keeps them, and an old file reads with neither.
- A `sections` list in `bots.json`, each with an id, a name, and a place in a user-set order, and a `sectionId` on each Bot: it allows empty sections and reordering, but changes the file's shape, the reducer's state, the `bots` message, and every reader of the file, for two abilities nobody asked for yet.

## Consequences

- Sections list by name, and the only way to make one is to move a Bot into it.
- Renaming a section to another section's name merges the two.
- A pinned Bot keeps its section, so unpinning returns it there, and a section whose Bots are all pinned shows no group but stays a choice under **Move to section**.
- `web/bots-model.ts`'s `botGroups` is the one place that orders the groups, which the tab and the gallery both draw.

## Confirmation

`src/server/bots-file.test.ts` reads an old file, pins, moves, renames, and removes sections; `web/bots-model.test.ts` checks the groups' order.

## Revisit when

Someone asks to reorder sections or to keep an empty one.
