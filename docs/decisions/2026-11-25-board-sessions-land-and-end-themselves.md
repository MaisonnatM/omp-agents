---
status: accepted
date: 2026-11-25
decision-makers: Maxence Maisonnat
---

# Board sessions land and end themselves

In the context of sessions the Board starts, facing a user who had to merge and end each one by hand, we chose to have each session land its work (or open a draft PR where the repository has no `.omp/land.json`), mark its Board task done with its outcome, and call `end_session`, over the dashboard ending a session when it sees `done` and over leaving the user to end it.
We gain a Board with nothing left running and a Board thread that reads as the task plus its outcome, accepting that work reaches `main` before the user looks at it.

## Options considered

- **The session finishes itself (chosen).** The steps live in `finish` in `src/server/board-runner.ts`, which both the start and wake prompts end on.
- **The dashboard ends a session on `done`.** Works when a session forgets, but cuts off a session that still replies after marking done.
- **The user ends it, as before.** Each Board task left a session and a "Merge on main, then end the session" prompt behind.

## Consequences

- A land that fails still ends the session: the outcome says why and the branch stays, and a reply resumes the session to retry.
- A reply resumes an ended session, which answers or does the follow-up, lands it, and ends again.
- The Board thread drops its grey notes and the suggested prompts under its reply box, since a finished session leaves nothing for the user to run.

## Revisit when

A Board task needs the user to see a change running before it lands, such as a UI prototype.
