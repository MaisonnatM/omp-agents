---
status: accepted
date: 2026-10-29
decision-makers: Maxence Maisonnat
supersedes: 2026-10-29-get-started-is-a-step-by-step-wizard
---

# Get started opens in a dialog and a bubble

In the context of a step-by-step setup that only appeared on a vacant home, so a user who opened a session or page first lost track of it, we chose a modal dialog that closes into a bottom-right bubble over the wizard in the main pane, to keep unfinished setup one click away from anywhere, accepting a modal over the dashboard on first run and one more stored key on this computer.

## Context

The user asked to put Get started in a dialog and then in a bottom-right bubble.
What stays: the welcome screen and the five steps, completion read live from each source, `#get-started` and the command menu, and dismissal and the step on screen stored on this computer only.

## Options considered

- **Wizard in the main pane**: the sidebar stays usable, but setup disappears as soon as the user opens anything else.
- **Dialog only**: focused, but closing it leaves no trace of unfinished setup.
- **Dialog that closes into a bubble**: the dialog opens once on a vacant first-run home, and the bubble keeps the progress and the way back on every page.

## Consequences

`GetStarted` mounts once in `web/app.tsx`; `PageSwitch` draws the ordinary home or panes under it at `#get-started`.
Closing the dialog stores `omp-agents.get-started-minimized`, so a vacant home shows the bubble instead of opening the dialog again.
The bubble shows while the required steps are incomplete and setup is not skipped; its X skips setup.
The dialog opens on its own only over a vacant home, never over a conversation, draft, or chosen page.

## Revisit when

People close the bubble without finishing setup, or the bubble hides controls at the bottom right.
