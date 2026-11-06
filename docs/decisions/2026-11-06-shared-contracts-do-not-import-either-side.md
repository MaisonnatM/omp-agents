---
status: accepted
date: 2026-11-06
decision-makers: agent
---

# Shared contracts do not import either side

In the context of modules that both need one type, facing import cycles that make a change to either side load the other, we chose a small contract module that neither side's implementation imports the other through, over leaving the type in the larger module and over splitting every large file, so a change lands in the module that owns it, accepting a few extra files that hold only the shared type.
