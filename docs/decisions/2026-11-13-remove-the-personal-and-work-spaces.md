---
status: accepted
date: 2026-11-13
decision-makers: Maxence
supersedes:
  - 2026-11-09-a-bots-address-opens-it-in-either-space
  - 2026-11-09-a-google-account-belongs-to-one-space
  - 2026-11-09-a-personal-session-is-any-session-in-the-personal-space
  - 2026-11-09-a-workspaces-space-syncs-with-the-workspace-list
  - 2026-11-09-an-agent-files-a-note-or-event-in-its-sessions-space
  - 2026-11-09-an-unassigned-workspace-belongs-to-work
  - 2026-11-09-call-each-side-of-the-dashboard-a-space
  - 2026-11-09-cmd-shift-p-switches-between-the-spaces
  - 2026-11-09-items-saved-before-the-split-start-in-work
  - 2026-11-09-spaces-filter-one-dashboard-instead-of-separate-setups
  - 2026-11-09-split-the-dashboard-into-a-personal-and-a-work-space
  - 2026-11-09-sport-shows-only-in-personal-and-tickets-only-in-work
  - 2026-11-09-the-dashboard-has-exactly-two-spaces
  - 2026-11-09-the-other-spaces-sessions-still-notify-with-a-count
  - 2026-11-09-the-space-switch-replaces-the-personal-item
  - 2026-11-09-the-space-switch-scopes-every-page
  - 2026-11-09-this-computer-remembers-the-last-space
---

# Remove the Personal and Work spaces

In the context of a dashboard split into a Personal and a Work space, facing a fact on every workspace, account, note, event, and session that Maxence no longer wants to keep right, we chose one space with no personal sessions, personal memory, or personal `remember` tool, over keeping the two spaces and over keeping personal sessions without the switch.
This removes the switch, the space pickers, and the code that asked each item's space, accepting that a personal fact a session once remembered is no longer read by any session.

## Context

The spaces scoped every page, the roster, the accounts, and the agents' notes and events, and the personal extension gave sessions in the Personal space a memory and the `sport` tool.
Maxence asked to remove the feature entirely, keep Sport, and move the keyboard shortcuts, which the switch's menu opened, to their own Settings tab.

## Consequences

- Every page shows every workspace, account, note, and event; the sidebar's **Workspaces** label still filters by workspace.
- Every dashboard session loads the Sport extension, so any session can read and log the training plan.
- Bots keep their own memory and `remember` tool.
- A file an older version wrote drops its `personal` lists and `space` fields when it loads.
- `personal-memory.md` and the personal directory stay on disk, unread.
- Keyboard shortcuts live in Settings › Keyboard, which `?` and the sidebar foot's **Keyboard shortcuts** link open.
