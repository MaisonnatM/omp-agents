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
  For workspaces, changes to different entries merge: a workspace each machine added arrives on both.
  A second sync with nothing changed changes nothing and makes no commit.
  Under the button, **Last sync** says when it ran, counts the files it received and sent, each count opening its list, and lists the files it left on this machine.
- A file changed differently here and on the remote since the last sync is a conflict: the sync changes nothing on either side and lists each such file.
  The first sync of a machine that already has a file the remote has too, with different text, is a conflict as well.
  **Compare** shows both versions; pick **This machine** or **Remote** for each file, then **Sync with these choices**.
- **What syncs** has a switch for each item, all on by default.
  The items are omp's `config.yml`, your `AGENTS.md` and `APPEND_SYSTEM.md`, and the `skills`, `rules`, `agents`, and `commands` directories in `~/.omp/agent`, and the dashboard's own:
  - the source control settings: automatic pulls, each repository's choice, and the cleanup after a merge;
  - your preferences: the theme, what transcripts hide, the sidebar tabs, the pinned skill, notifications, the merge method, the diff view, and the idle stop;
  - the workspaces Settings › Workspaces added and hid;
  - your routines, each with its name, Workspace, model, task, schedules, triggers, and the machine that runs it;
  - your projects, each with its name, goal, decisions, archive, and plan steps with their state, without its sessions or log.
  A routine one machine deleted goes on the other.
  Each routine runs on one machine only: one made or turned on here runs here, and on the other machines its row reads **Runs on** and this machine's name, with its switch off.
  Turning that switch on moves the routine there, its schedule counting from then, and it stops here at this machine's next sync; until then, both may run it.
  Two machines that both change where a routine runs before syncing get a conflict on the routines, so it never ends up running on both.
  A routine's runs stay on the machine that ran them.
  A project's sessions, a step's claim, and the project's messages stay on the machine that had them; a step or decision each machine added arrives on both.
  A project whose name another channel already holds here takes the next free name, such as `launch-2`, on every machine.
  An item you turn off stays as it is, both here and on the remote.
- **Never synced** lists what stays on each machine whatever the remote holds.
  That covers omp's `agent.db` and other databases, `mcp.json`, which can hold OAuth client secrets, `secrets.yml`, key files such as `.env` or `*.pem`, session files, lock files, and the dashboard's access token, interrupted sessions, and merges.
  Inside a synced directory, links, binary files, files over 1 MB, and files with text shaped like a token or a private key stay too, and so do the dashboard's lists while one of them holds such text; the sync names each one it left.
  Scheduled sends, pinned sessions, notices, and routines' runs do not sync, since they belong to this machine's sessions and runs.
- A path under your home directory is written as `~` on the remote: `/Users/ann/notes` in `AGENTS.md` arrives as `~/notes`, and a repository's pull choice or a workspace moves to the same path under the other machine's home.
- A change you make here while a sync runs is kept, and the next sync sends it.
