---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
---

# Plan quota and machine load move to the sidebar's foot, and the terminal is parked

In the context of the window's bottom strip, which held plan quota, the **Terminal** button, and the Mac's CPU, memory, and disk, and of the sidebar's **Keyboard shortcuts** link, facing Maxence's request to drop the link, show the models' usage and the machine's stats in the sidebar instead, and remove the terminal for now, we chose to draw plan quota, one plan per row, and the machine's load at the sidebar's foot, to remove the bottom strip, and to unmount the terminal panel with its button, its Ctrl+` shortcut, and its command.
We chose it over keeping the strip without the terminal, so the window loses a row and the figures sit with the rest of the app's chrome, accepting that they hide with the sidebar and take room from the roster.
We kept the panel's code in `web/components/terminal/` and the server's shells, unused by the page, over deleting them, since "for now" means the terminal comes back.

## Consequences

Settings › Keyboard and `?` remain the way to the shortcuts.
The CPU and disk cards keep their popovers, opening upward from the sidebar's foot.
The terminal's code still builds and its tests still run while nothing on the page reaches it.

## Revisit when

The terminal comes back: mount the panel again and give it a toggle, or delete its code if it does not.
