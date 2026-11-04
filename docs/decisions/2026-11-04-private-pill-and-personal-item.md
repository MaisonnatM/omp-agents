---
status: accepted
date: 2026-11-04
decision-makers: Maxence, agent
---

# Private is a header pill, and Personal is a sidebar item

In the context of Private and Personal sessions, which Maxence found hard to tell apart from a normal draft, facing a lock toggle lost among the composer's chips and a Personal directory found only inside the directory picker, we chose the Private pill design: a **Private** pill in the New session header that, while on, fills dark, outlines the composer, and swaps the board for what ending deletes and what stays, a dark **Private** chip on running private rows and headers, and a **Personal** item under **New session** that opens a personal draft with its own board.
We chose it over mode chips in the composer, a mode switch, and a dark private canvas, accepting one more sidebar item.
We kept the sidebar's status groups rather than splitting it into Personal and Projects sections, since a split would repeat the pinned, idle, running, interrupted, and past groups twice; the existing Personal badge marks personal rows.
We kept **Personal** in the directory picker too, since moving a draft there and the move and Bot pickers rely on it.

## Options considered

- Private pill: one control, at the page level, and the page itself says what private means; chosen.
- Mode chips: Personal and Private as composer chips; cheap, but still easy to miss.
- Mode switch: a three-way switch; implies Personal and Private exclude each other, which they do not.
- Private canvas: a dark page; no light app does that, and it fights dark mode.

## Revisit when

Personal sessions outnumber project sessions in the sidebar, or a third session mode appears.
