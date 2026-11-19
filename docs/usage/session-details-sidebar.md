# Session details sidebar

- The right sidebar shows the focused view's subagents and what its agents changed, its session's pull requests and artifacts, including the pull requests of its subagents, a Linear issue, and in the desktop app the app a live session runs.
  It follows a live session, one of its subagents, or a past session.
  It hides for a pull request's details, **Settings**, and the new-session page, and while two or more panes sit side by side; a maximized pane brings it back.
- It works as Capy's side panel: its header shows the tabs you opened, and **+** after them lists every tab the view can show, the one on screen checked, with its item count.
  The tabs are **Overview**, the subagent you opened from it, **Diffs**, which a subagent's view leaves out, **PRs**, **Browser**, which shows only in the [desktop app](desktop-app.md) for a live session or subagent, **Artifacts**, which shows only once the agent saved an artifact, and **Linear**.
  Pick one in the **+** menu to open it as a tab, or to show it when it is already open; **Overview** is always open.
  The menu opens on a **Search** field: typing keeps only the tabs, subagents, and **New terminal** whose name holds the text, Enter opens the first matching tab, and the arrow keys move down to the rows.
  Below the tabs, the menu lists a running session's subagents, each opening in the sidebar as **Overview**'s rows do, then **New terminal**, which opens the [terminal](terminal.md) panel on a new shell; a paired phone leaves **New terminal** out.
  Each other tab shows its count after its name, and its ×, on hover and always on the tab on screen, closes it; so does Delete on a focused tab, and closing the one on screen shows the tab before it.
  The left and right arrows move between the open tabs.
  ⇧⌘G shows **Overview** while the sidebar shows, and pressed again on **Overview** it reviews the session's changes from its first changed file.
  ⇧⌘L opens **Browser**, and opens the sidebar too when it is closed; the **+** menu lists both keys.
  The sidebar remembers the tabs you opened and the one you chose, for every view; a tab the view cannot show, such as **Browser** for a past session, stays open but hidden until it can.
  **Review visuals** opens and shows the **Browser** tab, and saving an artifact the **Artifacts** tab.
- **Overview** lists the view's **Subagents**, then the **Files**, **Images**, and **Sources** of [Changed files and images](changed-files-and-images.md), each under a filled header with its count that folds on a click; see [Conversations](conversations.md) for the **Subagents** section.
  A section shows once it has something to list, and the tab says **Nothing yet** once the session's lists have loaded and none has.
  A past session's view shows its files, images, and sources but no subagents.
- Clicking a subagent in **Overview** opens its conversation in a tab named after it, after **Overview**, while the session's own conversation stays in the pane.
  The tab streams the subagent's transcript and has its composer, which steers or messages the subagent as its own view's does; picking another subagent shows it in the same tab.
  Cmd-click (Ctrl-click on Linux and Windows) still opens the subagent in a split, and middle-click in the app window.
- **Diffs** shows what the session's checkout changed against its branch base: the branch and base, **All** or **Mine**, the files this session's own calls changed, the line counts, and a refresh button over a row per file.
  Click a row to read that file's diff, with long lines wrapped; **Previous** and **Next** step through the files, and the back arrow returns to the list.
- **PRs** shows the pull requests the session and its subagents submitted or worked on, as its header lists them, the session's own first; a subagent's view shows its session's.
  A pull request the session only read shows only when the session's own prompt names it, as `#7049` or `PR 7049`; see [Pull requests](pull-requests.md).
  The pull requests the session worked on, such as one it opened, pushed, or edited, come before those its prompt only links or names, so the one it opened shows before the one the prompt linked.
  The first one shows until you pick another from the header's **N/M** stack menu or from its **Also on this session** list, which says whether the session submitted or worked on each pull request.
  The pull request then shows as its details on the Pull requests page do: the same header, then the **Summary**, **Timeline**, and **Code** tabs; **Code** lists the changed files, and a click on one opens its diff in a dialog over the page.
  The header and the tab bar stay at the top of the sidebar, and only the tab's content scrolls below them, as on the page.
  The quick actions apply only when the pull request list of the sidebar's workspace includes the pull request.
  Opening the tab, or picking another pull request, reads it from GitHub, and so does each start and end of the view's turn, so its checks and reviews follow the agent's pushes; the server keeps its answer for 30 seconds.
- **Browser** shows the app the session runs and adds an element you pick in it to the session's composer; see [Browser](browser.md).
- **Artifacts** shows the pages, documents, and drawings the agent saved for you to look at, each version kept; see [Artifacts](artifacts.md).
- **Linear** shows a Linear issue: its id, which opens it in Linear, its status, when it last changed, its title, priority, assignee, project, and labels, then its description.
  It opens on the first issue the conversation links to, as `https://linear.app/<workspace>/issue/ENG-123`, and its count is the number of issues linked; with more than one, a menu beside the field picks another.
  The tab opens by itself, behind the tab on screen, when the session's conversation links an issue, so its chip with the count shows in the tab row; once you close it, it stays closed until the session links another issue or you open the session again.
  Type an id such as `ENG-123`, or paste an issue's link, in the field at the top and press Enter to show any other issue; it shows without joining the menu, and text that is neither says so under the field.
  The server reads the issue through the Linear MCP server omp uses, with omp's sign-in to it, so the tab needs Linear in [MCP servers](mcp-servers.md) and says so when omp has none.
- A tab with nothing to show says so.
