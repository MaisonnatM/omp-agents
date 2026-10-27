---
status: accepted
date: 2026-10-21
decision-makers: Maxence Maisonnat
---

# The dashboard wears T3 Code's theme tokens

`web/globals.css` takes T3 Code's light and dark values for the tokens the two apps share, its system font stack, and its two small text sizes, and `web/components/ui/button.tsx` adds T3's `outline`, `ghost-muted`, `glass`, `destructive-outline`, and `warning-outline` variants.
The pull request panel is being rebuilt to look like T3 Code's, and a panel drawn from another palette, font, and border weight never matches it, however close its layout gets.
The tokens change the whole app at once, so every page keeps one palette rather than the pull request page alone wearing T3's.
Fluid's tokens that T3 lacks stay, and the button keeps Fluid's two-step size ladder and press effect, which a surrounding size switches between.
T3's 24px `xs` and `icon-xs` join it only as sizes a caller names, since the pull request header's actions are 24px in T3 and a 28px compact button would not match them.
Primary buttons use `--primary` and `--primary-foreground` for their surface, press effect, and label, so the shared theme tokens apply throughout the app rather than leaving the primary action black.
See [Interface map](../code-layout.md#interface-map) and the [parity harness](../agent-smoke.md#parity-harness), which measures the panel against T3's.
