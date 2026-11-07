---
status: accepted
date: 2026-11-07
decision-makers: agent
---

# Mark hangboard exercises with a hang flag

In the context of a finger pain flag that must drop the fingerboard for 7 days, facing a plan schema with no way to tell a hang from any other exercise, we chose a boolean `hang` on each exercise, false by default, over matching exercise keys or names and over a free list of tags, so `weekPlan` removes hangs from the day after the flag to 7 days after, accepting one more field the plan editor must set.
