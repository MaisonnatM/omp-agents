# Get started

**Get started** walks you through setup one step per screen, in a dialog over the dashboard.
It opens by itself on an empty home when you have not connected a model provider and started a session yet.
It never opens by itself over an open conversation, a new-session draft, or a page you chose.
A computer with a connected provider and any live or past session goes straight to the ordinary home.
Open it any time with Cmd+K (Ctrl+K), **Get started**, or the `#get-started` link.

Close the dialog with its X or Esc and it shrinks into a bubble at the bottom right, showing how many of the two required steps are done.
Click the bubble to reopen the dialog on the same step.
The bubble stays on every page until both required steps are done or you skip setup; its X skips setup.

## Moving through it

It starts with a welcome screen that lists the five steps; **Get started** opens the first step not done yet.
The list on the left shows each step's number, or a check once it is done, and jumps to any step.
**Back** returns to the previous step, or to the welcome screen from the first one.
A step that is done offers **Next** with the following step's name; one that is not offers **Skip for now**.
Leaving for Settings or a session and coming back returns to the same step on this computer.

## The steps

1. **Model provider** is required.
   The step lists every provider omp can sign in to, as **Settings › Providers** does, and signs in right there.
   A provider you already signed in to with `/login` in omp's terminal, or whose key is in your environment, counts too.
2. **Terminal sessions** is recommended.
   Pick **Control** to watch terminal sessions here and send them messages, or **Read-only** to only watch them.
   Your pick sets omp's global `collab.autoStart`, replacing the other of the two; turning it off stays in omp's own settings.
   Already-running terminal sessions need a restart, `/new`, or `/collab` before they appear.
3. **Starter kit** is optional and runs the same non-forced installer as **Install omp Starter Kit…** in the desktop menu.
   Your customized files and settings stay.
   Completion includes files, settings, the marketplace, and plugins, not merely the presence of one extension.
   The step shows installation progress and output; new sessions load what was installed.
4. **GitHub and tools** is optional and done once either GitHub or an integration is connected.
   GitHub is checked independently of Graphite: **Install GitHub CLI** opens [its download page](https://cli.github.com) if `gh` is missing, then copy `gh auth login` and run it in a terminal.
   **Open Integrations** goes to **Settings › Integrations**, which counts connected services, not accounts: two Gmail accounts count as one service.
5. **First session** is required.
   Each suggested task opens the new-session draft with its prompt; **New session** opens a blank one.
   Pick a workspace and send the prompt: leaving an unsent draft does not complete this step.
   Any live or past session, in any workspace, counts.

## Checks and dismissal

Checks come from the actual setup, never from a saved tick or a click.
A failed check says why on its step without hiding the others or marking it done.
Checks update while setup is visible and when you return to the window; **Check again** on the tools step reads them immediately.

**Skip setup** hides the bubble and automatic setup on this origin/computer, not on your other computers or through Settings sync.
**Finish setup** on the last step does the same once you have a session.
The ordinary empty home offers **New session** and **Get started**, and still shows registry errors.
Explicitly opening **Get started** works even after dismissal or after both required steps are done.
