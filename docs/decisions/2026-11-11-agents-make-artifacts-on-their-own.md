---
status: accepted
date: 2026-11-11
decision-makers: Maxence Maisonnat
---

# Agents make artifacts on their own

In the context of the `artifact` tool, facing users who will not remember to ask for one, we chose to have agents save an artifact on their own for a page, an SVG, or a document the user will keep or reuse, as well as whenever the user asks, over making one only on request.
We chose Claude's behavior so artifacts show up where they help without a habit to learn, accepting that the starter kit's prompt line must keep agents from turning short answers into artifacts.

## Revisit when

Sessions fill with artifacts the user never opens, or agents skip ones the user expected.
