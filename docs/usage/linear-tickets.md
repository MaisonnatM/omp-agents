# Linear tickets

- The **Tickets** tab, or a `#tickets` address, opens the Linear issues assigned to you, as Linear's **My issues › Assigned** lists them.
  The sidebar then lists the workflow states with their issue counts; click one to scroll the page to it and move focus there, and a folded state unfolds.
- The page groups the issues by workflow state.
  **In Review** comes first, in the sidebar and on the page, with a green circle-dot icon.
  The other states follow Linear's order: triage, started (such as **In Progress**), unstarted (**Todo**), backlog, completed, and canceled.
  Duplicates count as canceled.
  Completed and canceled issues show only when they changed in the last seven days, like the recent merges on the Pull requests page.
  Within a state, issues sort by priority, urgent first and no priority last, then by the latest update.
- A sub-issue whose parent is also listed shows indented under its parent's row, in the parent's state, whatever its own state; a sub-issue of a sub-issue nests under the topmost listed one.
  Sub-issues under a row sort by state, then by identifier number, and a state's count includes them.
  A sub-issue whose parent is not listed, such as one assigned to someone else, is a row of its own with the parent's identifier as a chip.
- The list spans the page's width, like Linear's, and each state's heading stays at the top of the page while its issues scroll under it.
- A row shows the priority, the identifier, the state, and the title, then the due date when there is one, the labels, and the project as chips, then the day Linear opened the issue and the day it last changed.
  A day this year reads `Oct 6`, an earlier one `Mar 2025`; hover a day for its full time.
  On a narrow page the chips that do not fit drop out first, from the project back, then the opening day, so the title keeps its room.
  Each label's dot has the color Linear gives that label.
  Hover an icon to read what it means.
  Click a state's heading to fold it; the browser's localStorage keeps folded ones folded across reloads.
- Click a row to replace the tickets list with the issue's details in the main content.
  The page header then names the issue: its identifier, with its title under it, after a back arrow.
  The back arrow, **Back to tickets**, stays in the header while the details scroll, and returns to the list with its folded states preserved.
  The detail view lays the issue out as Linear does: the title, the description, the sub-issues, and the comment threads in a wide column, and beside it the quick actions, the state, the priority, the assignee, the due date, the labels as chips, the project, Linear's branch name for it, the links Linear keeps for it (a pull request with its own icon), who opened the issue and when, and a link to the issue on Linear.
  A sub-issue names its parent above its title, **Sub-issue of** with the parent's state, identifier, and title, as a link to the parent's details.
  An issue with sub-issues lists them under its description, all of them whoever they are assigned to, with how many are done of those not canceled and a bar for it; each row shows the state, identifier, title, assignee when it is not the issue's own, and priority, links to the sub-issue's details, and dims once closed, struck through when canceled.
  On a page narrower than the side column needs, the side column stacks between the title and the description.
  Each opening reads the issue again through Linear's `get_issue`, `list_comments`, and `list_issues` tools.
  Linear's issue mentions in the text become links.
  Its images show in place, its screen recordings play in a video player, and another embedded file becomes a link to download it.
  The dashboard's server fetches each of these files from Linear, so a video still plays and seeks after Linear's five-minute link to it expires.
- Once Linear has answered, each field in the side column is a button that changes the issue in Linear: the state, the priority, the assignee, the project, and the labels open a list to search and pick from, and the due date opens a date field with **Set** and **Clear**.
  Labels toggle, and their list stays open for several.
  A change shows at once and saves in turn after the ones before it.
  The tickets list reads Linear again after each save, so an issue you assign to someone else leaves it.
  When Linear refuses a change, the detail view undoes it, keeps the changes made after it, and says why.
  The lists come from the issue's team in Linear, read when you first open one, and the server keeps them for five minutes.
- `#tickets/<identifier>`, such as `#tickets/ENG-2368`, opens that issue's details directly, even when the tickets list does not include it or cannot load.
  The header's back arrow opens the list from a direct link too.
- **New ticket**, before **Refresh** in the page header, C outside text fields on any page but the Todo page, where C adds a todo, or **Create ticket** in the command menu opens the new-issue dialog over the page you are on, laid out like Linear's.
  Its header names the team by its key, such as ENG, in a pill that picks another team; the team starts as the last one an issue was created in, from here or from a todo, else Linear's first.
  Below come the title, a markdown description, and a pill for each field: the status, which starts as the team's first backlog state, the priority, the assignee, which starts as you, the project, and the labels, each a searchable list as in an issue's side column, and **…** for a due date.
  The lists come from the team in Linear, and another team clears the status, labels, and project picked for the last one.
  The paperclip adds files of up to 25 MB each, which Linear attaches once the issue exists; the expand button makes the dialog taller and wider.
  Enter in the title moves to the description, and **Create issue** or Cmd+Enter (Ctrl+Enter off macOS) creates the issue in Linear.
  The dialog then closes and the issue's details open, and the tickets list reads Linear again.
  With **Create more** on, the dialog instead clears the title, description, and files, keeps the fields, and names the issue it opened, for the next one.
  When Linear refuses the issue, the dialog says why and keeps what you wrote; when it refuses a file, the issue stays created, and the dialog clears and names the issue and each file it did not attach.
  Esc or the close button discards the draft, except while the issue is being created.
  C and **Create ticket** show only while Linear is connected.
- A lightning button, which shows on a row in place of the day it last changed while you hover or focus the row, and buttons in the issue's details, start a new dashboard session in the background, with a prompt that names the issue.
  The page stays on screen, and the session shows at once as a chip with its status dot on the issue's row and after the buttons in its details; click the chip to open the session (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  A row and the details show a chip for every running session that works on the issue, whether a quick action started it or it read or changed the issue with omp's Linear tools, so they say whether an agent still works on it, after a reload too.
  A row shows two chips at most.
  The session also shows in the sessions sidebar.
  A Linear issue names no repository, so the session starts where a new session would: in the sidebar's workspace, or under **All workspaces** in the open session's workspace, else the newest session's.
  **Work on it**, on any open issue, implements the issue in a git worktree on Linear's branch for it, continuing a branch or pull request that exists already, then commits and reports without pushing.
  **Plan it**, on an issue that has not started yet (triage, backlog, or unstarted), reads the issue and the code and reports a plan without changing anything.
  A completed or canceled issue has none.
  The button waits while the session starts.
  When the start fails, a note above the issue's details or at the top of the list gives the reason, even when the issue itself cannot load, until you dismiss it.
  The Pull requests page and the tickets page share that note: either page shows the last failed quick action, whether it ran on a pull request, an issue, or a todo, and names a todo by its title.
- The list of tickets is not tied to the sidebar's workspace.
  The page reads Linear when it opens and every minute after, and shows the last read at once on a reopen, even after a reload.
  A saved tickets list without each issue's opening date is discarded, and the page reads Linear again.
  The server keeps Linear's answer for 30 seconds, and **Refresh** asks again at once.
- The dashboard reads Linear through omp's Linear MCP server and its sign-in, so there is no key to set.
  Until omp is signed in to that server, the sidebar has no **Tickets** tab, which then takes no number, so the tabs after it move up one, and a `#tickets` address shows Linear's integration row instead of the issues.
- To connect, open **Settings › Integrations** and choose **Connect** on Linear's row; see [Integrations](integrations.md).
  A new browser tab opens Linear's sign-in page; approve omp there, and the **Tickets** tab appears within a few seconds.
  When Linear later refuses the sign-in, the **Tickets** tab stays and its page shows Linear's row with **Reconnect**; the Todo page's **Create Linear ticket** and the Calendar's tickets hide until it works again.
