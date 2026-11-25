---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Wake the claimer on a Board reply

In the context of Board threads, facing a reply that should reach a session that may have stopped, we chose to send the reply as a follow-up to the session holding the claim, or to the Board thread's author when nobody holds one, resuming it when it stopped, over waking every session in the Board thread or mentions.
We gain one obvious recipient per reply, accepting that a session that only replied hears nothing.

## Decision

- The replier is never woken, and a done Board task wakes nobody.
- Waking uses `reach(sessionId)` and a `followUp` prompt with `DASHBOARD_PROMPT_PREFIX`, as pull request watches do, and the Board thread notes when a reply woke a stopped session.
