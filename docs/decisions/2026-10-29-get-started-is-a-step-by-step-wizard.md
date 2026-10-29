---
status: superseded
superseded-by: 2026-10-29-get-started-opens-in-a-dialog-and-a-bubble
date: 2026-10-29
decision-makers: Maxence Maisonnat
supersedes: 2026-10-29-get-started-is-a-page-and-a-vacant-home-checklist
---

# Get started is a step-by-step wizard

In the context of a first-time user facing six setup rows at once, where the checklist sent them to Settings for the one step they cannot skip, we chose a welcome screen and five steps, one per screen, over the single-page checklist and over a full-window modal, to set each thing up in place and show one decision at a time, accepting more screens to walk through and a remembered step on this computer.

## Context

The checklist showed every step with equal weight and linked out to Settings › Providers and Settings › Integrations, so the required sign-in happened on another page.
The user asked for a real multi-step onboarding; Figma Dev Mode's numbered step rail, Linear's welcome and skip, Braintrust's provider step, and Devin's suggested first sessions are the references.
What stays: it opens at `#get-started`, from the command menu, and on a vacant home while required setup is incomplete; it never covers a conversation, draft, or chosen page; completion is read live from each source.

## Options considered

- **Keep the checklist**: one glance shows everything, but it decides nothing for the user and sends the required sign-in elsewhere.
- **Full-window modal over the sidebar**: the most focused, but it hides the dashboard the user is setting up and needs its own layer outside `PageSwitch`.
- **Wizard in the main pane**: one step per screen with the step rail beside it, the sidebar still visible, and the existing `PageSwitch` mount kept.

## Consequences

The provider step signs in through the same provider list as Settings, and the terminal step writes `view` or `control` as the user picks, replacing either one.
The step on screen is stored on this computer as `omp-agents.get-started-step`, so a detour to Settings returns to the same step; dismissal stays as it was.
Every step can be skipped, and the rail jumps to any step.
The last step opens the new-session draft with a suggested prompt, so the session only starts when the user sends it.

## Revisit when

People skip the wizard rather than finish it, or the required steps change.
