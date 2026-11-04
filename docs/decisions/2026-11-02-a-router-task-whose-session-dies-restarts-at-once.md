---
status: deprecated
date: 2026-11-02
decision-makers: user, agent
---

# A Router task whose session dies restarts at once

In the context of a Router task whose session process crashes or is killed mid-turn, facing the task moving to review as though it had finished, we chose to hand an exit that End session did not cause, while the task works, to the supervisor's restart at once, over waiting for the supervisor's dead-session check six minutes later and over leaving such a task in review.
The restart counts toward the same two restarts as a stuck task's, so a session that dies on every resume stops after two tries and its Router hears why.
The dashboard does not list that session among those stopped mid-turn, so **Continue all** never sends a second follow-up beside the supervisor's.
We accept that a session the user kills from a terminal, rather than through End session, also counts as died and restarts.
