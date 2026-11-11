---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# An HTML artifact runs scripts and reaches the network in an opaque origin

In the context of HTML artifacts, facing prototypes that need scripts and CDN libraries inside a page that keeps its sign-in token in `localStorage`, we chose to run an HTML artifact's scripts with network access in a sandbox without same-origin access, over scripts with no network and over no scripts.
We chose it so a prototype that loads Tailwind or React from a CDN clicks through as written while it cannot read the dashboard, its storage, or its API, accepting that an artifact can send what it holds to any site.

## Options considered

- **Scripts and network, opaque origin**: prototypes work as written; the page can reach any site.
- **Scripts, no network**: nothing leaves the page, but the agent must inline every library.
- **No scripts**: a static picture of a page; no clicking through a prototype.

## Revisit when

An artifact is found sending session data out, or agents start embedding secrets in artifacts.
