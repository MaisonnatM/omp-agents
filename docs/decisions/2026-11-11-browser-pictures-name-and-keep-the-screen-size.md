---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Browser pictures name and keep the screen size

In the context of **Attach** and **Screenshot** while a screen size other than Fit panel is on, facing an agent that cannot tell a phone layout from a narrow sidebar, we chose to take the picture at the screen size's own CSS size at a pixel density of 1, whatever zoom the Browser shows, and to name the screen size and its size in the chip, such as `Mobile, 390×844`, over the picture the Browser shows scaled, so "fix this" reads as "fix this on mobile", accepting a capture path that differs from the scaled view.

## Options considered

- The scaled picture the Browser shows: a Desktop page in the sidebar becomes hard to read.
- The page at its emulated pixel density: a Mobile picture of 1170×2532 pixels fills the agent's context for no more layout detail.
- Its own CSS size at density 1, named in the chip: chosen.

## Consequences

- Fit panel pictures stay as they are, with no screen size named.
