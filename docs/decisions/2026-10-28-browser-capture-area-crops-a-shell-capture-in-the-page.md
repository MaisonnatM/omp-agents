---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# Browser's Capture area crops a shell capture in the page

In the context of the Browser's **Capture area**, a macOS-style drag that attaches a picture of part of the app to the session's composer, facing a sandboxed page that cannot capture its `<webview>` itself, we chose a crosshair layer the page draws over the `<webview>`, a `capturePage()` of the whole guest from the shell, and a crop in the page, over a layer injected into the guest and over the shell cropping a rectangle the page sends.
It keeps the app's own page untouched and the crop correct at any zoom and pixel density, accepting one capture of the whole guest per area.

## Options considered

- A layer in the page over the `<webview>`, the shell's `capturePage()` of the whole guest, and a crop in the page by the ratio of the picture's width to the layer's: no script in the app, and the ratio holds whatever the zoom or density; chosen.
- The same layer, with the shell capturing only the rectangle: a smaller picture, but `capturePage(rect)` takes the guest's own coordinates, which drift from the page's when either is zoomed.
- A layer injected into the guest by `desktop/preview-grab.ts`, as react-grab is: draws inside the app, but the app's styles and scripts can break it, and every message from the guest is one any script there can forge.

## Consequences

The bridge gains an optional `captureBrowser`, so an app built before it shows no **Capture area** button.
A capture attaches only to a mounted composer, since attachments live in its state, so the page says to open the conversation when none is mounted.

## Confirmation

The desktop smoke drags over the Browser and finds the cropped image, at the screen's density, in the composer's attachments.

## Revisit when

Attachments outlive their composer, so a capture can wait in a draft as picked text does.
