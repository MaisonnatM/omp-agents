---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# A Router's events pass a screen in the routine runner

In the context of waking a Router with Slack and pull request events, facing the choice between a separate event loop for Routers, routing each run's events as the runner sends it, and a screen the runner asks before it claims a run, we chose the screen, `RouterEvents` as the runner's `screen`, over its routine `<bot id>-events`, to reuse the triggers, the one-run-per-check batching, and the run card, and so a check whose events all drop or pass through claims no run that would have nothing to send.
The dropped count rides on the Router's next run's prompt rather than on a new run field or new interface, since the run card already shows the prompt.
We accept that an event a task follows reaches its session as the check fires, even in a dark wake, and that the dropped count lives in memory, so a restart forgets it.
