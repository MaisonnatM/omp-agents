---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# The page builds its primitives on UI SDK

The page's dialogs, menus, selects, popovers, hover cards, tooltips, tabs, radios, switches, toasts, collapsibles, scroll areas, and command lists use [UI SDK](https://ui-sdk.dev/) (`@ui-sdk/react`), in place of Radix UI, Base UI, and cmdk.
One library gives every popup the same layering, so Esc closes only the topmost one and focus returns to what had it without `useReturnFocus`.
Its parts mark state with `data-open`, `data-selected`, `data-highlighted`, and the other attributes its docs list, so classes read those instead of `data-state`.
`ui/button.tsx` renders as another element through `render`, not `asChild`, and keeps the browser's default `type` rather than UI SDK's `Button`, so form submits still work.
The transcript keeps shadcn's `message-scroller`, since UI SDK's scroll area has no scroll-to-message or provider-level scroll-to-end.
The pull request detail tabs keep their tab semantics as [Pull request detail tabs keep tab semantics in T3's segmented control](2026-10-22-pull-request-detail-tabs-keep-tab-semantics-in-t3s-segmented-control.md) says, now on UI SDK's tabs.
See [Front-end components](../architecture/front-end-components.md).
