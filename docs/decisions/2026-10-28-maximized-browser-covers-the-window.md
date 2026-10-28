---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Maximized Browser covers the window

In the context of the Browser tab in the right sidebar, facing a request to show the app at the window's size, we chose a fixed layer over the page below the title bar over the Fullscreen API and over growing the sidebar in the layout, so the `<webview>` stays mounted and the title bar stays usable, accepting a second way to enlarge a panel beside the pane grid's in-flow maximize and code that makes the covered page inert.

## Context

In Electron, `requestFullscreen` takes the whole window into macOS full screen, which the user did not want.
A maximized pane in `web/components/pane.tsx` spans the pane grid in the layout, but the Browser lives in the details sidebar, outside that grid.
Moving the `<webview>` to another parent reloads the app and loses its state.

## Options considered

- Fullscreen API: enters macOS full screen and hides the title bar.
- Grow the details sidebar to the window's width: the sidebar's width is a resizable setting, and the left sidebar and panes would need hiding by hand.
- A `fixed` layer below the title bar, `z-30`, with the covered page `inert`: chosen.

## Consequences

- Menus, dialogs, and toasts, at `z-40` and above, still draw over the maximized Browser.
- `inertAround` in `web/components/browser-panel.tsx` makes the covered page inert, leaving the title bar and fixed layers alone.
- `top-9` repeats `DesktopTitleBar`'s `h-9`; a comment on each names the other.

## Confirmation

A desktop smoke run checked the Browser's box at the window below the title bar, the covered elements inert and the title bar not, the server menu usable while maximized, and Escape restoring from the toolbar and from inside the app.

## Revisit when

The Browser moves into the pane grid, or the title bar changes height.
