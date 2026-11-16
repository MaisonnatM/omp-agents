---
status: accepted
date: 2026-11-16
decision-makers: Maxence
---

# A module turns off in Settings › Modules

In the context of the module list, facing Maxence's wish to turn modules on or off from Settings, we chose a Modules group in the settings sidebar with one section per module, each with a switch kept in the portable preference `omp-agents.modules-off`, over one Modules section listing every switch and over the Sidebar tabs list in Preferences.
A module turned off counts as absent, as a signed-out tab does, accepting that its server half other than its session join keeps running.

## Options considered

- Hide the tab in Preferences › Sidebar tabs: already exists, and leaves the page, its shortcuts, and the sport tool working.
- One Modules section listing every switch: compact, but leaves no place for a module's own settings later.
- A Modules group with a section per module: room for each module's settings; chosen.

## Consequences

The switch syncs across machines with the other portable preferences, because the server keeps them.
A turned-off module's tab, go-to shortcut, own shortcuts, and palette commands go away, and its address shows that it is off.
Sessions started while Sport is off do not load the sport extension; running sessions keep the tool they started with.
Calendar's notices and routine triggers, Email's mail triggers, and ticket lookups elsewhere keep working, because their server side is core.

## Confirmation

The preference parser, the absent-tab merge, and the session join tests cover the switch.
