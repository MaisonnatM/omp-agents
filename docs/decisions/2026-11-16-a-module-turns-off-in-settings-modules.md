---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# Settings › Modules lists every module, and an agent session adds, changes, or removes one

In the context of the module list, facing Maxence's wish for one page with every module and a way to add, edit, and delete them, we chose one Modules section in Settings, a row per module with a switch kept in the portable preference `omp-agents.modules-off`, whose New, Edit, and Delete open a New session draft in the omp-agents checkout with a written request, over a Modules group with a section per module, over modules built from a form without code, and over plugins loaded at runtime.
Modules stay code fixed at build time, accepting that adding one takes an agent session, a review, and a rebuild, and that the packaged app, which has no checkout, can only turn modules on or off.

## Options considered

- A Modules group with a section per module: room for each module's own settings, but no place to see every module at once or to add one.
- One Modules page whose New, Edit, and Delete open an agent session that writes the code: keeps the typed registries and the tests, and the user reviews the request before it runs; chosen.
- Modules made from a form without code: a module needs a page, routes, and often stored state and a tool, which a form cannot describe.
- Plugins loaded at runtime: needs dynamic imports and a plugin contract, which the build-time list in docs/architecture/modules.md avoids.

## Consequences

The switch syncs across machines with the other portable preferences, because the server keeps them.
A turned-off module's tab, go-to shortcut, own shortcuts, and palette commands go away, and its address shows that it is off.
Sessions started while Sport is off do not load the sport extension; running sessions keep the tool they started with.
Calendar's notices and routine triggers, Email's mail triggers, and ticket lookups elsewhere keep working, because their server side is core.
Delete turns the module off at once, so it is gone from the page before the session removes its code, and its saved data stays on disk.
New, Edit, and Delete only fill the draft; nothing runs until the user sends it.

## Confirmation

The preference parser, the absent-tab merge, and the session join tests cover the switch; the prompt builder tests cover the requests, and the routing tests the old addresses.
