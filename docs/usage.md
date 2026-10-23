# Using omp-agents

The full reference for the dashboard's interface, one file per feature in `docs/usage/`.
Read this list, then only the file for the feature you need.
For installation, see the [README](../README.md); for a first session and each integration's setup, see [Getting started](getting-started.md).
For which file draws each part of the screen, see the [Interface map](code-layout.md#interface-map).

- [Sessions sidebar](usage/sessions-sidebar.md)
- [Terminal](usage/terminal.md)
- [Session details sidebar](usage/session-details-sidebar.md)
- [Changed files and images](usage/changed-files-and-images.md)
- [Session changes](usage/session-changes.md)
- [Panes, splits, and links](usage/panes-splits-and-links.md)
- [Conversations](usage/conversations.md)
- [Ask about this](usage/ask-about-this.md)
- [Composer](usage/composer.md)
- [Send later](usage/send-later.md)
  - [Continue after a usage limit or a connection error](usage/send-later.md#continue-after-a-usage-limit-or-a-connection-error)
- [Questions](usage/questions.md)
- [Starting, ending, resuming, and forking](usage/starting-ending-resuming-and-forking.md)
- [Replay from here](usage/replay-from-here.md)
- [Pull requests](usage/pull-requests.md)
- [Pull request details](usage/pull-request-details.md)
- [Linear tickets](usage/linear-tickets.md)
- [Providers](usage/providers.md)
- [Integrations](usage/integrations.md)
- [MCP servers](usage/mcp-servers.md)
- [Todo list](usage/todo-list.md)
  - [Todos from agents](usage/todo-list.md#todos-from-agents)
- [Calendar](usage/calendar.md)
- [Inbox](usage/inbox.md)
- [Routines](usage/routines.md)
- [Projects](usage/projects.md)
- [Settings](usage/settings.md)
- [Settings sync](usage/settings-sync.md)
- [Notifications](usage/notifications.md)
  - [Session notifications](usage/notifications.md#session-notifications)
- [Updating omp-agents](usage/updating-omp-agents.md)
- [Keyboard shortcuts](usage/keyboard-shortcuts.md)
- [Desktop app](usage/desktop-app.md)
- [Limitations](usage/limitations.md)

A filled button marks the main action of its surface: Send, Finish, Resume on a past session, Run now on a routine, and **Work on it** on an open todo.
Suggested prompts, other quick actions, forking, and menu items stay quiet, so they never compete with it.
Actions that wait for the server show a spinner or a progress label and block repeated activation until the work finishes.
Starting a session, stopping a turn, switching model settings, resending a prompt, canceling a subagent, and running a routine use this state.
Refresh controls and workspace saves do too.
An action that fails shows its error, and its control becomes available again.
