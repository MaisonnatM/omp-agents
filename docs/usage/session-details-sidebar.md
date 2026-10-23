# Session details sidebar

- The right sidebar shows the focused session's pull requests and Linear issues, including those of its subagents, and while the session runs, the processes it started.
  It follows a live session, one of its subagents, or a past session.
  It hides for a pull request's details, the tickets, **Settings**, and the new-session page, and while two or more panes sit side by side; a maximized pane brings it back.
- Its tabs are **PRs**, **Tickets**, which shows only for a session with a Linear issue, and **Processes**, which shows only for a live session.
  Each tab shows its name and a badge with its item count.
  The sidebar remembers the tab you chose, for every view, and defaults to **PRs**.
  A saved choice of the former **Files** or **Media** tab falls back to **PRs**.
- A project's coordinator, which changes no code itself, gets other tabs instead: **Workers**, **Notes**, and **PRs**; see [Projects](projects.md).
  It remembers its own tab, **Workers** at first, apart from a session's.
- **PRs** shows the pull requests the session and its subagents submitted or worked on, as its header lists them, the session's own first; a subagent's view shows its session's.
  The first one shows until you pick another from the header's **N/M** stack menu, the same popover as the session header's pull request button, or from its **Also on this session** list, which says whether the session submitted or worked on each pull request.
  The pull request then shows as its details on the Pull requests page do: the same header, then the **Summary**, **Timeline**, and **Code** tabs; **Code** lists the changed files, and a click on one opens its diff in a dialog over the page.
  The header and the tab bar stay at the top of the sidebar, and only the tab's content scrolls below them, as on the page.
  The quick actions apply only when the pull request list of the sidebar's workspace includes the pull request.
  Opening the tab, or picking another pull request, reads it from GitHub, and so does each start and end of the view's turn, so its checks and reviews follow the agent's pushes; the server keeps its answer for 30 seconds.
- **Tickets** shows the Linear issues the session and its subagents worked on, as its header lists them, the session's own first.
  The first one shows until you click another identifier above it, or the issue's **Sub-issue of** link or one of its **Sub-issues**, which show it in place.
  The issue shows as on the tickets page, stacked in one column: its title, its status, priority, assignee, due date, labels, and project, which you can edit there, then its **Sub-issues**, its branch, its links, who opened it, **Open in Linear**, its description, and its comments.
  **Sub-issues** draws them as a pull request's **Stack** draws its pull requests, on a rail in a box, under how many are done of those not canceled: each row shows the state, identifier, title, and priority, and the rail ends at the issue's own identifier, as a stack's ends at its base branch.
  Opening the tab, picking another issue, and each start and end of the view's turn read it from Linear.
- **Processes** lists what the session runs besides omp, biggest memory first, read again every 5 seconds while the sidebar shows the session.
  A job is a process group the session started, such as a dev server or a watcher, named by its command line; a service is a daemon that omp's project broker runs for the session, named by the daemon's name and command.
  Each row shows its memory, how many processes it holds when more than one, **Shared with this project's sessions** for a broker daemon no session owns, such as omp's browser, and **Stops in N min** once the idle stop has a time for it.
  **Stop** ends it at once: a job gets SIGTERM, then SIGKILL after 3 seconds, and a service is stopped through its broker.
  The line under the list gives the memory of omp and its MCP servers, which end with the session and have no **Stop**.
  A process the session ran in a Docker container does not show, since Docker runs it outside the session's processes.
- The idle stop ends a job once its session has been idle, waiting on you or done with its turn, for the time **Stop idle processes** in [Settings](settings.md) names, 30 minutes by default, counted from when the session was last busy or from the job's start if that is later.
  A shared service stops once every live session of its project has been idle that long.
  Only the server that runs unattended work, the first one started, stops processes, so another server shows no **Stops in** time.
- When a session ends or its omp exits, the server stops the services it owned and the jobs it left running.
  A session started from the dashboard also has the rest of its processes ended when it ends, as before.
- A tab with nothing to show says so.
