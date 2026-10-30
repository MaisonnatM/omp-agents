---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# The title bar reads where the window's buttons end

In the context of the desktop app's title bar on macOS, facing Back and Forward drawn 4px after the close, minimize, and zoom buttons and 1.5px off their center, because the bar assumed 52px of 12px buttons where macOS 27 draws 60px of 14px buttons, we chose to turn on Electron's `titleBarOverlay` and pad the bar by `env(titlebar-area-x)`, over a new hardcoded width, so the gap follows the buttons on any macOS version.
We accept a gap of 14px, as wide as the buttons' inset, which Electron chooses, instead of the 12px the bar asked for.
`trafficLightPosition.y` is 11 in `desktop/main.ts`, which makes Electron's button area 36px tall, the bar's `h-9`, and still assumes 14px buttons.
A desktop smoke run read the overlay at x 88 and 36px tall, Back at x 88, and an AppKit window's buttons at 14px wide with 9px gaps.
