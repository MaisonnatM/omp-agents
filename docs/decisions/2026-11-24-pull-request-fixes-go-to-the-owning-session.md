---
status: accepted
date: 2026-11-24
decision-makers: user, agent
---

# Pull request fixes go to the owning session

In the context of the Pull requests page's **Your move** badges and heading buttons, facing a fix that started a new session for a pull request whose own session already held its branch, worktree, and history, and that a running owner's task claim refused, we chose to send each fix to the first session the row lists, over a new session per fix and over asking which session each time, so the session that knows the pull request does the fix, accepting that a row's first session may be one that only worked on the pull request when none opened it.

- The owner is the first of the row's sessions: running before ended, and within each, the one that opened the pull request before one that only worked on it; `fixOwner` in `web/pull-requests-model.ts` picks it, so the badge, the **no session** cell, and the **Confirm N? · X to sessions, Y new** count show the same choice the click makes.
- A running owner gets the prompt with `followUp` delivery, which runs at once while it is idle and queues behind a running turn, never interrupting it; an ended owner is resumed first.
- The page cannot know whether a resume will work, so the server decides: `sendToOwner` in `src/server/owner-delivery.ts` falls back to the new session the start asked for when the owner cannot resume, such as when its worktree is gone, or refuses the prompt.
- A review is no fix and always starts a new session, since it works on someone else's pull request in a session of its own.
- The ⋯ menu's quick actions and E route through the same callback, so every fix from the list follows the rule; the pull request's details and notices still start new sessions.
