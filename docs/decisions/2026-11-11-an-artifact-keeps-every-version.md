---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# An artifact keeps every version

In the context of artifacts the agent changes over several turns, facing a tweak that makes things worse, we chose to keep every version the agent saved with a switcher between them, as Claude does, over keeping only the latest.
We chose it so the user can compare before and after a change and go back without asking the agent to undo it, accepting a stored copy per version.

## Revisit when

Version copies take noticeable disk in Settings › Storage, or users never switch versions.
