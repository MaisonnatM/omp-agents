---
status: superseded
superseded-by: 2026-11-09-split-the-dashboard-into-a-personal-and-a-work-space
date: 2026-11-04
decision-makers: Maxence, agent
---

# Private is a header pill, and Personal is a sidebar item

In the context of Private and Personal sessions, which Maxence found hard to tell apart from a normal draft, facing a lock toggle lost among the composer's chips and a Personal directory found only inside the directory picker, we chose the Private pill design: a **Private** pill in the New session header that, while on, fills dark, outlines the composer, and swaps the board for what ending deletes and what stays, a dark **Private** chip on running private rows and headers, and a **Personal** item under **New session** that opens a personal draft with its own board.
We chose it over mode chips in the composer, a mode switch, and a dark private canvas, accepting one more sidebar item.
We kept the sidebar's status groups rather than splitting it into Personal and Projects sections, since a split would repeat the pinned, idle, running, interrupted, and past groups twice; the existing Personal badge marks personal rows.
We first kept **Personal** in the directory picker; later the same day Maxence had it removed, so the sidebar's **Personal** item and Cmd+Shift+P are the only ways into a personal session, and a project session can no longer move there.

## Options considered

- Private pill: one control, at the page level, and the page itself says what private means; chosen.
- Mode chips: Personal and Private as composer chips; cheap, but still easy to miss.
- Mode switch: a three-way switch; implies Personal and Private exclude each other, which they do not.
- Private canvas: a dark page; no light app does that, and it fights dark mode.

## Revisit when

Personal sessions outnumber project sessions in the sidebar, or a third session mode appears.
