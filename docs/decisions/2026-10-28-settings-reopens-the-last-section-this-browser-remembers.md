---
status: accepted
date: 2026-10-28
decision-makers: agent
---

# Settings reopens the last section this browser remembers

In the context of the header's Settings button and `G ,`, facing a page that always reopened on Analytics whichever section you used last, we chose to keep the last open section in this window's localStorage under `omp-agents.settings-section`, over a portable preference the server keeps and syncs, and over remembering it only in memory until the window reloads.
The section is where you were in this window, not a choice that should follow you to another machine, and localStorage survives a reload without a server round trip.
We accept that two machines, or a cleared localStorage, reopen on different sections, and that a hash naming a section still wins, so `#settings` alone keeps opening Analytics.
`useSettingsRoute` in `web/use-sidebar-tab.ts` stores it, and `settingsSection` in `web/routing.ts` decodes both the hash and the stored value, so a section that no longer exists falls back to Analytics.
