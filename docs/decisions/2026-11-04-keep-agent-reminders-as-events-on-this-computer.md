---
status: accepted
date: 2026-11-04
decision-makers: agent
---

# Keep agent reminders as events on this computer

In the context of agents that need you to check a result later, facing a reminder that must reach you at a set time and lead back to its session, we chose to keep it as an event on **This computer** in `events.json`, with the `sessionId` of the session that added it, over a separate reminders file and over Google Calendar.
It reuses the Calendar page, the bell's event notice 10 minutes before the start, and the event triggers of routines, and it needs no Google sign-in, accepting that a reminder looks like an event you added except for where it links.
Agents change it only through `event-inbox/`, as with `notes.json`, and a session may remove only an event it added, which `EventInbox` checks again when it applies the change.
