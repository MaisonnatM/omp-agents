---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
supersedes: 2026-11-09-on-a-phone-the-sidebars-float-closed-and-leave-no-rail
---

# Plan quota and machine load move to the sidebar's foot, and the terminal loses its toggle

In the context of the window's bottom strip, which held plan quota, the **Terminal** button, and the Mac's CPU, memory, and disk, and of the sidebar's **Keyboard shortcuts** link, facing Maxence's request to drop the link, show the models' usage and the machine's stats in the sidebar instead, and remove the terminal for now, we chose to draw plan quota and the machine's load as one grid of ring tiles at the sidebar's foot, to remove the bottom strip, and to drop the terminal panel's button, its Ctrl+` shortcut, and its command.
We chose it over keeping the strip without the terminal, so the window loses a row and the figures sit with the rest of the app's chrome, accepting that they hide with the sidebar and take room from the roster.
We kept the panel itself, under the panes, since the details sidebar's **New terminal** opens it on a new shell, and that menu item is now the one way in.
This replaces the strip that [On a phone, the sidebars float closed and leave no rail](2026-11-09-on-a-phone-the-sidebars-float-closed-and-leave-no-rail.md) kept on a phone: its floating sidebars, closed on load and with no rail, stand as it chose, but its one row of plan quota now sits in the sidebar's foot.

## Consequences

Settings › Keyboard and `?` remain the way to the shortcuts.
The plan, CPU, and disk cards keep their popovers, which open to the sidebar's right, aligned with its foot.
On a phone, plan quota no longer shows until the floating sidebar is opened, and the foot still leaves out the CPU, memory, and disk, which describe the Mac.
The terminal panel opens only from **New terminal**, and its own hide button or its last tab closing hides it again.

## Revisit when

The terminal needs a way to show its running shells without starting a new one: give it a toggle again.
