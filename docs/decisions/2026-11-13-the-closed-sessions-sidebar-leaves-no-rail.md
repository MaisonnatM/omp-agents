---
status: accepted
date: 2026-11-13
decision-makers: Maxence Maisonnat
---

# The closed Sessions sidebar leaves no rail

In the context of the desktop window, where the closed Sessions sidebar kept a 46-pixel rail down the window's left edge for its toggle, facing the request that a closed sidebar be closed all the way with its button kept in the header, we chose to close it to nothing and float its toggle over the tab row's left end, past the window buttons, as the phone layout already does, over keeping the rail.
The header row pads its tabs past the toggle, and the page panel keeps the same small gap from the window's left edge as from its right.
We accept that the toggle jumps from the sidebar's top row to the tab row as the sidebar slides, rather than gliding with its edge.

## Options considered

- Keep the rail: the toggle has its own column, but every page loses 46 pixels down the whole window.
- Move the toggle into `HeaderTabs` for good: one place for it, but the open sidebar's top row then loses the button it carries today.
- Float the toggle over the tab row only while closed: chosen, it reuses the phone's layout and leaves the open sidebar as it was.

## Consequences

`--sidebar-rail` is gone; the tab row's left padding counts the window buttons and the toggle's clearance instead.
The floating sidebar's tap-to-close strip keeps its 46 pixels as its own constant.
