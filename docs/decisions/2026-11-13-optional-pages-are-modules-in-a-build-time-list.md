---
status: accepted
date: 2026-11-13
decision-makers: Maxence
---

# Optional pages are modules in a build-time list

In the context of Sport, Calendar, Email, and Tickets, each named by hand in about fifteen shared files, facing the cost of adding or removing such a page, we chose one module definition per page, listed in `SERVER_MODULES` (`src/modules.ts`) and `WEB_MODULES` (`web/modules.ts`), over the hand wiring and over plugins loaded and unloaded at runtime like DeepSeek Harness's Cordis.
The shared files read the lists instead of naming the pages, accepting that adding a module still needs a rebuild.

## Options considered

- Keep the hand wiring: each new page edits the router, the page switch, titles, shortcuts, the socket messages, and the server's setup.
- Runtime plugins: page kinds and messages become plain strings, so TypeScript's check that every page is handled is lost, the page bundle needs per-module chunks, and a session that already loaded a module's omp extension keeps its tool after an unload.
- A list fixed when the app builds: keeps the exhaustiveness checks and ships as one bundle; chosen.

## Consequences

Sessions, pull requests, todos, Bots and routines, settings, and Google and Linear accounts stay in the core; a module page reads core data through `CoreData` in `web/components/module-views.tsx`.
Only Sport has a server half; the calendar, Gmail, and Linear server code stays core, because the bell, routine triggers, settings sync, and ticket lookups share it.
A module keeps the tab id, address, and file names it had before, so saved layouts and data still load.
Settings › Activity counts Sport saves under `module-change` from now on, so older counts stay under `sport-changes`.

## Confirmation

`docs/architecture/modules.md` lists the contract; each module's `module.test.ts` and `web/dashboard-state.test.ts` check its routes and state messages.
