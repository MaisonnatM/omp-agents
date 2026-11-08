---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# Make a target either a metric value or a grade

In the context of Sport targets such as a 119 kg finger max or 8a in bouldering, facing a schema whose target had a nullable metric, value, and grade side by side, we chose a union on `kind`, a metric with its value or a climb kind with its grade, over nullable fields, so a target with both or neither cannot be built and the parser refuses one, accepting a `kind` field in the file.
