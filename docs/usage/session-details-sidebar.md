# Session details sidebar

- The right sidebar shows the focused view's subagents and what its agents changed, its session's pull requests, Linear issues, and artifacts, including the pull requests and issues of its subagents, and in the desktop app the app a live session runs.
  It follows a live session, one of its subagents, or a past session.
  It hides for a pull request's details, the tickets, **Settings**, and the new-session page, and while two or more panes sit side by side; a maximized pane brings it back.
- It works as Capy's side panel: its header shows the tabs you opened, and **+** after them lists every tab the view can show, the one on screen checked, with its item count.
  The tabs are **Overview**, **PRs**, **Tickets**, which shows only for a session with a Linear issue, **Browser**, which shows only in the [desktop app](desktop-app.md) for a live session or subagent, and **Artifacts**, which shows only once the agent saved an artifact.
  Pick one in the **+** menu to open it as a tab, or to show it when it is already open; **Overview** is always open.
  Below the tabs, the menu lists a running session's subagents, each opening its view, then **New terminal**, which opens the terminal panel on a new shell; a paired phone leaves **New terminal** out.
  Each other tab shows its count after its name, and its ×, on hover and always on the tab on screen, closes it; so does Delete on a focused tab, and closing the one on screen shows the tab before it.
  The left and right arrows move between the open tabs.
  ⇧⌘G shows **Overview** and ⇧⌘L opens **Browser** while the sidebar shows, and the **+** menu lists both keys.
  The sidebar remembers the tabs you opened and the one you chose, for every view; a tab the view cannot show, such as **Browser** for a past session, stays open but hidden until it can.
  **Review visuals** opens and shows the **Browser** tab, and saving an artifact the **Artifacts** tab.
  What a live session runs besides omp shows in the status bar's CPU card; see [Sessions sidebar](sessions-sidebar.md).
- **Overview** lists the view's **Subagents**, then the **Files**, **Images**, and **Sources** of [Changed files and images](changed-files-and-images.md), each under a filled header with its count that folds on a click; see [Conversations](conversations.md) for the **Subagents** section.
  A section shows once it has something to list, and the tab says **Nothing yet** once the session's lists have loaded and none has.
  A past session's view shows its files, images, and sources but no subagents.
- **PRs** shows the pull requests the session and its subagents submitted or worked on, as its header lists them, the session's own first; a subagent's view shows its session's.
  A pull request the session only read shows only when the session's own prompt names it, as `#7049` or `PR 7049`; see [Pull requests](pull-requests.md).
  The pull requests the session worked on, such as one it opened, pushed, or edited, come before those its prompt only links or names, so the one it opened shows before the one the prompt linked.
  The first one shows until you pick another from the header's **N/M** stack menu, the same popover as the session header's pull request button, or from its **Also on this session** list, which says whether the session submitted or worked on each pull request.
  The pull request then shows as its details on the Pull requests page do: the same header, then the **Summary**, **Timeline**, and **Code** tabs; **Code** lists the changed files, and a click on one opens its diff in a dialog over the page.
  The header and the tab bar stay at the top of the sidebar, and only the tab's content scrolls below them, as on the page.
  The quick actions apply only when the pull request list of the sidebar's workspace includes the pull request.
  Opening the tab, or picking another pull request, reads it from GitHub, and so does each start and end of the view's turn, so its checks and reviews follow the agent's pushes; the server keeps its answer for 30 seconds.
- **Browser** shows the app the session runs and adds an element you pick in it to the session's composer; see [Browser](browser.md).
- **Artifacts** shows the pages, documents, and drawings the agent saved for you to look at, each version kept; see [Artifacts](artifacts.md).
- **Tickets** shows the Linear issues the session and its subagents worked on, as its header lists them, the session's own first.
  An issue the session only read, or that its prompt or its branch names, shows once two of those agree; see [Pull requests](pull-requests.md).
  The first one shows until you click another identifier above it, or the issue's **Sub-issue of** link or one of its **Sub-issues**, which show it in place.
  The issue shows as on the tickets page: its header with the team, the identifier linking to Linear, the title, who opened it, and its branch, then its status, priority, assignee, due date, labels, and project, which you can edit there, then its **Description**, **Sub-issues**, **Links**, and **Comments** as sections that fold.
  **Sub-issues** draws them as a pull request's **Stack** draws its pull requests, on a rail in a box, under how many are done of those not canceled: each row shows the state, identifier, title, and priority, and the rail ends at the issue's own identifier, as a stack's ends at its base branch.
  Opening the tab, picking another issue, and each start and end of the view's turn read it from Linear.
- A tab with nothing to show says so.
