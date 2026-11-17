---
status: accepted
date: 2026-11-17
decision-makers: Maxence Maisonnat
---

# An HTML artifact's inline images open in the dashboard's image viewer

In the context of the Artifacts tab, facing HTML pages full of screenshots too small to read in the sidebar, we chose to have the route append a click bridge to the framed copy only, which posts the page's inline images to the dashboard's full-window `ImageViewer`, over a lightbox drawn inside the frame and over leaving images unclickable.
We chose it so an artifact's images zoom and step like every other image in the dashboard, while the saved bytes reach **Download** and **Open in browser** unchanged, accepting that only `data:image/` sources open, since the dashboard never loads an address an artifact picks.

## Options considered

- **Bridge in the framed copy, dashboard viewer**: one viewer for every image, full window, with zoom and arrow keys; images linked by URL stay unclickable.
- **Lightbox inside the frame**: no message crosses the sandbox, but a second viewer confined to the sidebar's width.
- **Unclickable images**: no change; screenshots stay too small to read.

## Revisit when

Agents start saving HTML artifacts whose images load from URLs, or a page's own click handlers fight the bridge.
