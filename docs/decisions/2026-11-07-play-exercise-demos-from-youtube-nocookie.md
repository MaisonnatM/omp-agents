---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# Play exercise demos from youtube-nocookie on click

In the context of the Sport page's exercise demos, which are YouTube videos, facing a page whose Content Security Policy allowed no outside frame or image, we chose to show each demo's thumbnail through `GET /api/sport/thumb`, which fetches it from YouTube once and keeps it on disk, and to mount a `youtube-nocookie.com` player only on the play click, over embedding YouTube players up front and over linking out to YouTube, so `img-src` stays as it was and YouTube hears of a demo only when the user plays it, accepting a `frame-src` entry for `https://www.youtube-nocookie.com` and a thumbnail cache in the data directory.

The player loads `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1` with `referrerpolicy="strict-origin-when-cross-origin"`, which YouTube needs to play an embed.
`frame-src` keeps `'self'` for the Email page's sandboxed message frame.
