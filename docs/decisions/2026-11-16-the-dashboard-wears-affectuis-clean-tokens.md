---
status: accepted
date: 2026-11-16
decision-makers: Maxence Maisonnat
---

# The dashboard wears affectUI's Clean tokens

In the context of porting affectUI's components into the dashboard, facing ported parts drawn in affectUI's near-black, Inter, 7 px look beside a page drawn in a blue primary and the system font, we chose to point every existing color, radius, shadow, and font token at affectUI's Clean light and dark values, over porting the components with their own colors and over renaming the app's tokens to affectUI's.
The app and the ported parts now read as one design, and no component changed to get there.
We accept a near-black primary where the blue one was, a muted text lighter than before, and 65 KB of font inlined into the stylesheet.

## Context

The tokens were Capy's surfaces, T3 Code's palette, and Fluid's surface and shadow ladders, recorded in [the T3 tokens record](2026-10-21-the-dashboard-wears-t3-codes-theme-tokens.md), which the inset sidebar record has since superseded.
affectUI keeps its tokens in `design-system/affectui-tokens.json`, which its generator writes as `--aui-*` variables, with a Clean and a Classic look in light and dark.
The ported components already use the app's token classes, such as `text-muted-foreground` and `bg-card`, so the tokens behind those classes decide whether they look like affectUI.

## Options considered

- Leave the tokens and let each ported component carry affectUI's colors: no change to the rest, but two palettes on one page.
- Rename the app's tokens to affectUI's names: one vocabulary, but every component in the app changes, while other ports are in flight.
- Copy the `--aui-*` values into `web/affectui-tokens.css` and point the app's tokens at them: chosen, one file to refresh and no component edits.
- Static Inter 400 to 700 from `@fontsource/inter`, as affectui-app loads it: rejected, because Bun's build inlined all seven subsets in woff2 and woff, 1.2 MB of a 1.49 MB stylesheet, and the static cuts ignore the `wght` 450 and 550 that `web/lib/font-weight.ts` sets.

## Consequences

- `--primary` is affectUI's near-black in light and near-white in dark, so the Resume button, switches, and the dithered grid lose the blue.
- `--muted-foreground` is black at 45%, which composites to `#8c8c8c` on white, about 3.4:1, where `#6b6b70` was about 5.3:1.
- `--sidebar`, `--muted`, `--secondary`, `--accent`, `--sidebar-accent`, and the dark `--surface-3` to `--surface-8` are affectUI's surface under its subtle wash, written as opaque hex, because sticky headers sit on `bg-muted` and a translucent fill would show what scrolls under them.
- In dark, the sidebar is lighter than the page panels, as affectUI's trays sit lighter than its cards.
- A status's base token, `--destructive`, `--warning`, `--success`, is affectUI's palette hue, and its `-foreground` is affectUI's text grade, so `bg-destructive/10 text-destructive-foreground` matches affectUI's soft badges.
- `--shadow-1` to `--shadow-3` are affectUI's card shadow and `--shadow-4` to `--shadow-8` its popover shadow.
- Radii are 5, 7, and 10 px for `sm`, `md`, and `lg`, and `panel` is 10 px.
- Only the Latin subset of Inter Variable ships; other scripts fall back to the system font.
- Hard-coded Tailwind palette classes and hex values in components, and the syntax highlighting colors, keep their own colors.

## Confirmation

Screenshots of a transcript, Pull requests, Settings › Preferences, and Todo, in light, and of a transcript and Preferences in dark, taken before and after at 1920 by 1080, show the near-black primary, Inter, and visible borders in both themes.
The built stylesheet carries one `@font-face` for Inter of 64,624 bytes in a 355,975-byte stylesheet.

## Revisit when

- affectUI's token JSON changes its Clean values, which means copying them into `web/affectui-tokens.css` again.
- A reader needs a script outside Latin in Inter.
- The muted text's contrast draws a complaint, or affectUI raises its own.
