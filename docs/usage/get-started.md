# Get started

The **Get started** checklist opens on an empty home when you have not connected a model provider and started a session yet.
It never replaces an open conversation, a new-session draft, or a page you chose.
A computer with a connected provider and any live or past session goes straight to the ordinary home.
Open it any time with Cmd+K (Ctrl+K), **Get started**, or the `#get-started` link.

## Your first session

These two steps are required; nothing else blocks starting work.

1. **Sign in to a model provider** opens **Settings › Providers**, using the same sign-in as omp.
   A provider you already signed in to with `/login` in omp's terminal counts too.
2. **Start your first session** opens the existing new-session draft.
   Pick a workspace and send a prompt; leaving an unsent draft does not complete this step.
   Any live or past session, in any workspace, counts.

## Make it yours

- **Show terminal sessions** is recommended.
  **Turn on** sets only omp's global `collab.autoStart` to `control`.
  An existing `view` choice is already complete and stays read-only.
  Already-running terminal sessions need a restart, `/new`, or `/collab` before they appear.
- **Connect GitHub** is optional and checks GitHub independently of Graphite.
  Install [gh](https://cli.github.com) if needed, then copy `gh auth login` and run it in a terminal.
- **Install the starter kit** is optional and runs the same non-forced installer as **Install omp Starter Kit…** in the desktop menu.
  Your customized files and settings stay.
  Completion includes files, settings, the marketplace, and plugins, not merely the presence of one extension.
  The page shows installation progress and output; new sessions load what was installed.
- **Connect integrations** opens **Settings › Integrations**.
  It counts connected services, not accounts: two Gmail accounts count as one service.
  A stored sign-in counts as connected just as it does in Settings, even when that service needs attention.

## Checks and dismissal

Checkmarks come from the actual setup, never from a saved tick or a click on a row.
A failed check says **Check unavailable** without hiding the other steps or marking it complete.
Checks update while the checklist is visible and when you return to the window; **Check again** reads them immediately.
Sessions update through the dashboard's existing connection.

**Dismiss** hides automatic setup on this origin/computer, not on your other computers or through Settings sync.
The ordinary empty home offers **New session** and **Get started**, and still shows registry errors.
Explicitly opening **Get started** works even after dismissal or after both required steps are done.
