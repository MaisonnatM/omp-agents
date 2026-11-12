---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Browser offers three screen sizes

In the context of testing a session's app at other widths in the Browser, facing a choice between named devices, a custom size, and a few classes, we chose three classes, Mobile as an iPhone at 390×844, Tablet as an iPad at 768×1024, and Desktop at 1440×900, plus **Fit panel**, today's Browser and the default, over a list of named devices and over a custom width and height, so a check takes one pick, accepting that a layout that breaks only on a small phone or an Android user agent goes unseen.

## Context

The Browser is as wide as the sidebar, up to 960 pixels, or the window when maximized.
Tailwind's breakpoints sit at 640, 768, 1024, 1280, and 1536 pixels.

## Options considered

- Named devices, such as iPhone SE, Pixel 8, iPad mini, and iPad Pro: more coverage, a longer menu to read on each switch.
- Named devices plus a custom size: the most coverage, two inputs in a menu.
- Three classes: chosen.
- Mobile as an Android phone with Chrome's user agent: turned down for the iPhone, the phone the user tests on.

## Consequences

- Tablet sits on Tailwind's `md` breakpoint and Desktop above `xl`, so each class lands on a different layout of a Tailwind app.
- Mobile and Tablet rotate between portrait and landscape; Desktop does not.
- Desktop keeps the window's pixel density; Mobile emulates 3 and Tablet 2.
- A size between the classes, such as 375 or 1280 pixels wide, needs Fit panel and a sidebar dragged to that width.

## Revisit when

The user asks for a size the three miss, or the apps tested here target Android.
