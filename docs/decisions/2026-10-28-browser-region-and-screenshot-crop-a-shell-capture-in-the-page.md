---
status: accepted
date: 2026-10-28
decision-makers: Maxence Maisonnat
---

# Browser's Region and Screenshot crop a shell capture in the page

In the context of the Browser's **Region**, **Draw**, and **Erase** pick modes, copied from T3 Code, whose boxes and lines attach as one picture of the marked part of the app with **Attach**, and its **Screenshot**, facing a sandboxed page that cannot capture its `<webview>` itself, we chose a layer the page draws over the `<webview>`, a `capturePage()` of the whole guest from the shell, and the marks drawn on it and cropped in the page, over a layer injected into the guest, as T3 Code has, and over the shell cropping a rectangle the page sends.
It keeps the app's own page untouched and the marks and crop correct at any zoom and pixel density, accepting one capture of the whole guest per picture.

## Options considered

- A layer in the page over the `<webview>`, the shell's `capturePage()` of the whole guest, and the marks drawn and cropped on an `OffscreenCanvas` in the page by the ratio of the picture's width to the layer's: no script in the app, and the ratio holds whatever the zoom or density; chosen.
- The same layer, with the shell capturing only the rectangle: a smaller picture, but `capturePage(rect)` takes the guest's own coordinates, which drift from the page's when either is zoomed.
- A layer injected into the guest by `desktop/preview-pick.ts`, as T3 Code draws its marks: the capture holds the marks as drawn, but the app's styles and scripts can break the layer, and every message from the guest is one any script there can forge.

## Consequences

The bridge gains an optional `captureBrowser`, so an app built before it shows no **Screenshot** or **Pick in the app** button.
The marks live in the page, so the guest's scroll moves under them; they mark the page as it showed when drawn.
**Select** outlines its elements in the app instead, since only there can it find them (see [Browser's Select runs in the app with react-grab's primitives](2026-10-28-browser-select-runs-in-the-app-with-react-grab-primitives.md)), so the capture shows those outlines and the crop covers them with the marks.
A picture attaches only to a mounted composer, since attachments live in its state, so the page says to open the conversation when none is mounted, and **Attach** then appends no chip and keeps picking, as it does when the capture fails.

## Confirmation

The desktop smoke draws a box and a line over the Browser, erases a second box, and finds the cropped image, at the screen's density with the marks on it, in the composer's attachments.

## Revisit when

Attachments outlive their composer, so a capture can wait in a draft as picked text does.
