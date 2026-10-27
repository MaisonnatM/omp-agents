---
status: accepted
date: 2026-10-21
decision-makers: Maxence Maisonnat
---

# Settings sync syncs a registry of portable items through a Git remote

Settings sync pushes only the items `SYNC_ITEMS` names: omp's user config, instruction files, skills, rules, agents, and commands, and the dashboard's source control settings, notes, todos, preferences, workspaces, and hidden calendars.
Credentials, databases, sessions, and the dashboard's machine files never sync, whatever the remote holds, and neither do routines, scheduled sends, pins, notices, or Google sign-ins, which name one machine's sessions, runs, and accounts.
Todos sync although their session links open only on the machine that ran the session, since the list is the user's own and a link to a session elsewhere only fails to open.
A list both machines changed merges entry by entry by id, so two machines that each add a note or a todo keep both, rather than one whole file conflicting with the other.
A Git remote of the user's own carries them because it needs no service of ours, keeps every version, and signs in with the machine's existing git credentials.
See [Settings sync](../architecture/settings-sync.md).
