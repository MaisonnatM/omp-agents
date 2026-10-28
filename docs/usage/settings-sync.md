# Settings sync

- **Sync** is a section of [Settings](settings.md), at `#settings/sync`, that keeps the portable part of your setup the same on every machine through a Git remote that only you can read, such as a private GitHub repository.
  Each machine's dashboard pushes to and fetches from the same branch.
- **Remote** takes the remote's address and a branch, `main` by default; **Save** keeps both in `settings-sync.json` beside the access token.
  Sync uses this machine's git credentials, its SSH keys or credential helper, and never asks for a password, so a remote that needs one fails with git's message.
  An address with a password in it is refused.
  With no remote saved and `gh` signed in, **Create private repository on GitHub** creates a private repository named in the field beside it, `omp-settings` by default, and saves its address as the remote; a private repository of yours with that name is reused, and a public one or another account's is refused.
  When a sync fails because the saved GitHub remote does not exist, **Create <owner>/<name> on GitHub** under the failure creates it the same way.
- **Sync** fetches the branch, compares each file with the last version this machine synced, and then sends what changed here and writes what changed on the remote.
  A file that changed on one side only takes that side's version, and a file both sides changed the same way stays as it is.
  For the source control settings, changes to different repositories, or to different settings, merge.
  For notes, todos, workspaces, and hidden calendars, changes to different entries merge: a note or todo each machine added arrives on both, and one machine's new todo lands after the todo it followed there.
  A todo one machine deleted and the other edited, or a todo list reordered differently on both, is a conflict.
  A second sync with nothing changed changes nothing and makes no commit.
  Under the button, **Last sync** says when it ran, counts the files it received and sent, each count opening its list, and lists the files it left on this machine.
- A file changed differently here and on the remote since the last sync is a conflict: the sync changes nothing on either side and lists each such file.
  The first sync of a machine that already has a file the remote has too, with different text, is a conflict as well.
  **Compare** shows both versions; pick **This machine** or **Remote** for each file, then **Sync with these choices**.
- **What syncs** has a switch for each item, all on by default.
  The items are omp's `config.yml`, your `AGENTS.md` and `APPEND_SYSTEM.md`, and the `skills`, `rules`, `agents`, and `commands` directories in `~/.omp/agent`, and the dashboard's own:
  - the source control settings: automatic pulls, each repository's choice, and the cleanup after a merge;
  - your notes;
  - your todos, with their categories and archive;
  - your preferences: the theme, what transcripts hide, the sidebar tabs, the pinned skill, notifications, the merge method, the diff view, calendar routines, and the idle stop;
  - the workspaces Settings › Workspaces added and hid;
  - the Google calendars the Calendar page hides.
  An item you turn off stays as it is, both here and on the remote.
- **Never synced** lists what stays on each machine whatever the remote holds.
  That covers omp's `agent.db` and other databases, `mcp.json`, which can hold OAuth client secrets, `secrets.yml`, key files such as `.env` or `*.pem`, session files, lock files, and the dashboard's access token, interrupted sessions, and merges.
  Inside a synced directory, links, binary files, files over 1 MB, and files with text shaped like a token or a private key stay too, and so do your notes, todos, or other lists while one of them holds such text; the sync names each one it left.
  Routines, scheduled sends, pinned sessions, notices, Google sign-ins, and calendar events kept on this computer do not sync, since they belong to this machine's sessions, runs, and accounts, and a routine on two machines would run twice.
  A synced todo keeps its session links, but they open only on the machine that ran the session.
- A path under your home directory is written as `~` on the remote: `/Users/ann/notes` in `AGENTS.md` arrives as `~/notes`, and a repository's pull choice or a workspace moves to the same path under the other machine's home.
- A change you make here while a sync runs is kept, and the next sync sends it.
