---
status: deprecated
date: 2026-11-02
decision-makers: user, agent
---

# A Router is a Bot type that delegates to task sessions

In the context of bringing DeepSeek's Super-agent design, one always-on Router that hands work to background workers, into the dashboard, facing the choice between a standalone Atlas page, a global chat that replaces the Bots tab, and a new Bot type, we chose a Bot type, `router`, named **Atlas** by default, whose tools start, follow, and finish task sessions.
A Bot already gives the Router one conversation, a job, a memory, a right sidebar, routines with Slack and pull request triggers, and the Inbox's counts, so one place stays where you talk to agents, as the PR shepherd set the precedent.
Each task runs in its own session rather than in the Router's conversation, so the Router answers at once and parallel tasks never share a context.
A task records what it follows, such as a pull request or a Slack thread, and an event that matches goes straight to that task's session without a Router turn, the pass-through DeepSeek measured as the largest token saving.
Rules in code drop events that need nothing before any model runs, and a supervisor restarts a task that stops making progress, with its last error in hand.
We accept that, like routines, routing and the supervisor run only while the dashboard runs, and that the Router's tools only leave requests, as the other Bot tools do.
