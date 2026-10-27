# Updating omp-agents

**Update dashboard**, from the bell's omp-agents notice, its toast, or the command menu, loads new commits into a dashboard that runs from a git checkout, from `bun start` or in `bun run desktop`.

- It fast-forwards the checkout's branch to its branch on origin, and runs `bun install --frozen-lockfile` when `bun.lock` changed.
- It never stashes, resets, or merges: a checkout on another branch than the server started on, with changes to tracked files, or with commits origin lacks stays as it was, and the notice or a toast says why.
  Untracked files do not block it.
- Then the server restarts on the same port, in the same terminal or desktop window, and the page reloads into the new build; a toast says so, and the menu says when there was nothing new.
  Sessions keep running through the restart, a running turn included, and show live again once the server is back.
- Changes to `desktop/` load only when the desktop app starts again.
- **What's new**, the sparkles button before the bell at the top right, lists the features of the build you run, newest first, grouped by day: each commit whose subject starts with `feat` or `Add`, except one that only adds tests, with its area and pull request.
  A blue dot on the button marks features newer than the newest one it showed on this machine; opening it clears the dot.
  **Not loaded yet**, at its top, lists the features on the branch's origin, as last fetched, that the running build lacks, with **Update dashboard**.
  A packaged app, or a server outside a git checkout, has no history to read and says why.
- Agents load new commits through `GET` and `PUT /api/dashboard/update` rather than by killing its processes, and the `PUT` restarts only when origin has new commits; the starter kit's `AGENTS.md` shows how, and [How omp-agents works](../architecture/updating-the-dashboard.md) describes the endpoint.
