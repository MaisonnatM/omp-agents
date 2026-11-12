---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Only top-level sessions save artifacts

In the context of the `artifact` tool, facing subagents that build prototypes for their parent, we chose to give the tool to top-level sessions only, so a parent saves a file its subagent wrote, over letting subagents save artifacts that show in their parent's tab.
We chose it to keep one artifact list per session that its own agent curates, as the `arena` tool and [Subagents drop the user session tools](2026-11-08-subagents-drop-the-user-session-tools.md) already do, accepting one more call from the parent after a subagent's prototype.

## Revisit when

Parents routinely save every file their subagents write, which the subagents could save themselves.
