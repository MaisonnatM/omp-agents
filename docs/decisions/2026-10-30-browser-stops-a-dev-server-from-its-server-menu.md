---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# Browser stops a dev server from its server menu

In the context of the Browser's server menu, facing a **Start dev server** whose server could be stopped only from the status bar's CPU card, which shows **Stop** only while you hover the CPU reading, we chose a **Stop dev server** item below **Start dev server**, which stops the one dev server directly and opens a list of them when there are several, over a stop button on each server row and over one submenu per server row.
Each row keeps its one click to load the server and the stop sits beside the start that made it, accepting a second item to reach and, with several servers, a submenu.

## Options considered

- A stop button at the end of each server row: one click from the server, but a button inside a menu item is a second focus target that the menu's arrow keys skip, and a server with two ports would show two buttons that stop the same process.
- A submenu on each server row with **Open** and **Stop**: keyboard-friendly, but loading a server, the menu's main use, would take two picks instead of one.
- One **Stop dev server** item, a list when there are several, each entry one process with all its ports: chosen.

## Consequences

- `devServers` in `web/browser-model.ts` lists a session's dev servers as processes, with the id the stop names, and `browserCandidates` derives the per-port addresses from them.
- The stop goes through `PUT /api/session-processes/stop`, the CPU card's route, so a job the session runs stops as a whole process group and a service through the broker.
- The page a stopped server served stays in the Browser until it reloads.

## Revisit when

The server menu gains other actions per server, such as a restart, which would make a submenu per row worth its second pick.
