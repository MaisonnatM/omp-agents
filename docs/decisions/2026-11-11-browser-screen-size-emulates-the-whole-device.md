---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Browser screen size emulates the whole device

In the context of the Browser's screen sizes, facing apps that change with more than the window's width, we chose to emulate the whole device, its size, touch pointer, user agent, and pixel density, as Chrome's device mode does, over giving the `<webview>` the size alone, so a Mobile page shows what a phone shows, accepting emulation driven from the desktop shell's main process rather than from the page.

## Context

The Browser is a `<webview>` whose guest the desktop shell owns in `desktop/browser-guests.ts`.
CSS media queries such as `(hover: hover)` and `(pointer: coarse)`, which Tailwind's `hover:` variant depends on, follow the pointer, not the width, and some apps read `navigator.userAgent`.
The page can size the `<webview>` element, but only the guest's `webContents` can change its pointer, user agent, and pixel density.

## Options considered

- Size only: the page sets the element's width and height; a Mobile page keeps a mouse and a desktop user agent, so hover menus and user-agent checks show the desktop app.
- The whole device: chosen.

## Consequences

- Hover-only menus, touch layouts, and user-agent checks behave as on the device.
- The shell gains a channel that sets a guest's emulation, beside `BROWSER_PORTS_CHANNEL`.
- Picking keeps the mouse, so Select can outline the element under the pointer while touch is emulated.
- A user agent change applies to the next request and to `navigator.userAgent` read after it; an app that read it at start sees the new one after a reload.

## Confirmation

A desktop smoke run on Mobile reads `navigator.userAgent`, `matchMedia("(pointer: coarse)")`, `devicePixelRatio`, and `innerWidth` in the guest.

## Revisit when

Electron drops or changes `<webview>` device emulation, or the Browser stops being a `<webview>`.
