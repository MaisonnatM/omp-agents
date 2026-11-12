---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Browser scales a screen size down, never up

In the context of a screen size that does not match the Browser's box, facing Desktop's 1440 pixels in a sidebar a third as wide, we chose to scale the page down until it fits and to center it at 100% on a muted background when it is smaller, with its size and zoom shown, over scrolling a page kept at 100% and over scaling a small page up, so the whole layout shows at once, accepting small text in a narrow sidebar.

## Options considered

- Scroll at 100%: crisp text, but only one corner of a Desktop page shows in the sidebar.
- Scale up to fill: a Mobile page in a maximized window gets blurry text and proportions no phone has.
- Down to fit, never up: chosen.

## Consequences

- Picking, Region, Draw, and the Attach card map their boxes through the zoom, so marks land where the pointer is.
- Maximize Browser gives a Desktop page more room and a smaller zoom-out.

## Confirmation

A desktop smoke run on Desktop in the sidebar and on Mobile maximized checks the zoom shown and a Region box drawn over a known element.
