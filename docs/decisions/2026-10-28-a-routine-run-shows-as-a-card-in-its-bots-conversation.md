---
status: accepted
date: 2026-10-28
decision-makers: Maxence
---

# A routine run shows as a card in its Bot's conversation

In the context of a Bot's routines, facing runs whose messages read in the conversation as if the user had typed them, we chose a run card in the conversation, drawn like Arc's Tool call row with the routine's name, trigger logos, status, folded output and a link to the routine, over a floating status pill on the Bot page and over a widget in omp's terminal interface.
Each run reads where its reply does, in order with the rest of the conversation.
We accept that a run shows nothing until its message reaches the conversation, so a command routine has no card while its command runs.
The way the card knows its run is in [A routine message carries a trailing stamp line](2026-10-28-a-routine-message-carries-a-trailing-stamp-line.md).
