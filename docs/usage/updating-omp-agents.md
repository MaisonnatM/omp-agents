# Updating omp-agents

**Update dashboard**, from the bell's omp-agents notice, its toast, or the command menu, loads new commits into a dashboard that runs from a git checkout, from `bun start` or in `bun run desktop`.

- It fast-forwards the checkout's branch to its branch on origin, and runs `bun install --frozen-lockfile` when `bun.lock` changed.
- Once the new build starts, it brings the omp starter kit's files in `~/.omp/agent` up to date when you never edited them since you installed the kit, so new omp sessions get the landed kit; a file you edited keeps your version.
  A file the kit no longer ships goes the same way: removed when you never edited it, kept when you did.
  It needs one run of `bun run omp-template` that records the install first.
- It never stashes or merges: a checkout on another branch than the server started on, with changes to tracked files, or with commits origin lacks stays as it was, and the notice or a toast says why.
  Untracked files do not block it.
- Then the server restarts on the same port, in the same terminal or desktop window, and the page reloads into the new build; a toast says so, and the menu says when there was nothing new.
  Sessions keep running through the restart, a running turn included, and show live again once the server is back.
- In the desktop app, when the new build does not start within a minute, the app puts the checkout back on the commit that ran before, reinstalls its packages when they changed, and starts that again.
  The bell's notice **omp-agents update undone** then says which commit did not start, how it ended, such as exited with code 1 or did not answer within 60 s, and which commit omp-agents went back to, and the command menu's **Update dashboard** says the same.
  **Update dashboard** refuses that commit, naming the last error it printed, and the automatic pull in Settings › Source control skips the checkout with **Skipped: update undone**, until its branch on origin has a newer commit; then the next update tries again.
  When the checkout cannot go back, such as when you changed a file since the update, the window says why, with **Retry**.
- When the server stops on its own after it started, the desktop app starts it again after 1, 2, 5, then 15 seconds, keeping the page, which reconnects by itself.
  The 5th stop within 5 minutes shows the error page with the server's last output and **Retry**.
  A server you run with `bun start` in a terminal does neither.
- Changes to `desktop/` load only when the desktop app starts again.
- **What's new**, the sparkles button at the top right, lists what changed in the build you run, in everyday words, newest day first: the lines of the repository's `CHANGELOG.md`, which every change to `main` adds to.
  A blue dot on the button marks more lines than it showed when it last opened on this machine; opening it clears the dot.
  **Not loaded yet**, at its top, lists the lines in the `CHANGELOG.md` of the branch's origin, as last fetched, that the running build lacks, with **Update dashboard**.
  A packaged app, or a server outside a git checkout, has no `CHANGELOG.md` to read and says why.
- Agents load new commits through `GET` and `PUT /api/dashboard/update` rather than by killing its processes, and the `PUT` restarts only when origin has new commits; the starter kit's `AGENTS.md` shows how, and [How omp-agents works](../architecture/updating-the-dashboard.md) describes the endpoint.
