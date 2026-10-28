---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Preview embeds the session's app in a webview

In the context of the right sidebar's **Preview** tab, facing a session's dev server on its own loopback origin that must render beside the conversation and send react-grab picks to the composer, we chose an Electron `<webview>` in the page over an `<iframe>` and over a `WebContentsView` the main process places, to get a real top-level page that the dashboard's own menus and layout treat as one element, accepting a desktop-only feature and Electron's `webviewTag`, which the main process must lock down itself.

## Context

The dashboard serves `default-src 'self'`, and a dev server may send `X-Frame-Options` or `frame-ancestors`.
Its cookies are `SameSite`, and `localhost` and `127.0.0.1` are different sites, so a framed app signs in differently than in a browser tab.
The pick has to reach the page that owns the composer, and the guest must never get Node or the dashboard's token.

## Options considered

- `<iframe>`: works in a browser tab too, but needs the dashboard's CSP opened to every loopback port, breaks on apps that refuse framing, and runs the app as a third-party frame with its cookies cut off.
- `WebContentsView` from the main process: a real top-level page, but its bounds must follow the sidebar through IPC on every resize, tab switch, and scroll, and the dashboard's menus, toasts, and dialogs cannot draw over it.
- `<webview>`: a real top-level page in its own partition that lays out as an element of the sidebar's tab; its preload hands picks to the page with `sendToHost`: chosen.

## Consequences

- `desktop/main.ts` forces the guest's preload, sandbox, context isolation, and partition in `will-attach-webview`, refuses non-loopback addresses, and opens anything else in the browser.
- A browser tab gets no Preview, since only the desktop bridge reports `preview`.
- A drag of the sidebar's edge turns off pointer events on the Preview, since the guest otherwise takes the pointer from the handle.
- The tab stays mounted behind another tab once shown, so switching tabs does not reload the app.

## Confirmation

A desktop smoke run through CDP loaded a session's Vite server in the Preview tab, checked the guest's partition, sandbox, and context isolation in the main process, appended picks from `copyElement` and from **Comment** to the composer, kept the guest's page across a switch to **PRs** and back, and resized the sidebar by dragging its edge into the Preview.

## Revisit when

Electron deprecates `webviewTag`, or the dashboard needs the Preview in a browser tab.
