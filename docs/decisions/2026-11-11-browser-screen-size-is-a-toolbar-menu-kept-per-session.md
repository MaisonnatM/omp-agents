---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Browser screen size is a toolbar menu kept per session

In the context of the Browser's toolbar, facing a control the user switches often, we chose a toolbar button that opens the screen size menu and shows the size in use, kept per session for 30 days as the address is, over an entry in the **⋯** menu and over one size for every session, so a switch takes two clicks and a session reopens as it was tested, accepting one more button in a sidebar toolbar that already wraps its address field below a 24rem width.

## Options considered

- An entry in the **⋯** menu: the toolbar keeps its room, and each switch takes a menu inside a menu.
- One size for all sessions: a Mobile check in one session would follow into the next.
- Nothing kept: each Browser starts on Fit panel.
- A toolbar button kept per session: chosen.

## Consequences

- Review tabs follow the session's screen size, and so does the rotation.
- Fit panel needs no saved entry; the stored value names the other sizes only.
