# Session details sidebar

- The right sidebar shows what the focused pane's agent changed, captured, and shipped: a live session, one of its subagents, or a past session, each from its own transcript file.
  It hides for a pull request's details, the tickets, **Settings**, and the new-session page, and while two or more panes sit side by side, which leaves no single pane to follow; a maximized pane brings it back.
- Tabs split it: **Files**, **Media**, **PRs**, and **Tickets**, which shows only for a session with a Linear issue.
  Each tab shows its name and, in a badge, how many items it holds, such as `3` changed files.
  When the sidebar is too narrow for every tab's icon, the tabs show their names alone; with **Tickets** among them, they show their icons alone until you widen the sidebar past 30rem, and hovering one names it.
  The sidebar remembers the tab you chose, for every view.
- A project's coordinator, which changes no code itself, gets other tabs instead: **Workers**, **Notes**, and **PRs**; see [Projects](projects.md).
  It remembers its own tab, **Workers** at first, apart from a session's.
- **Files** lists the files the agent's `edit` and `write` calls changed, in the order it first touched them.
  Each row shows whether the session created, edited, or deleted the file, how many times it changed it, how long ago the last change was, and the lines added and removed, which the list's heading totals.
  As in the session's changes, a count of zero is left out, so a file the agent only added to shows `+12` alone.
  A path inside the session's working directory shows relative to it.
  Click a file to open the [session's changes](session-changes.md) in a dialog over the page, at that file.
  A subagent has no changes of its own checkout, so on a subagent's Files tab a click opens the file's changes as omp recorded them instead, newest first: each with its kind, its time, its lines added and removed, and its diff with line numbers.
  That dialog follows the file while the agent keeps editing it, and Esc closes it.
  A write replaces the whole file and records no diff, so it shows how many lines it wrote instead.
  A write counts as creating the file when the session had not read or changed that path before, since omp does not record whether the file existed; a created file counts every line it wrote as added, and a later write over it counts none.
  A failed call, and a write to something other than a file, such as an `agent://` message, count for nothing.
  The search field above the list stays pinned to the top of the sidebar while the list scrolls; it keeps the files whose path holds every word typed, in any order and any case, and the heading then counts and totals those, as in `2 of 9 files changed`; Esc clears it.
  Opening another session clears the search.
- Subagents are not listed here; open one from its link in the transcript, under the call that spawned it.
- **Media** shows the images that the agent's tools returned and those of its subagents at any depth, newest first: browser screenshots from `eval`, and image files that `read` opened.
  It also shows the image files the session wrote that a tool call or its result named, such as the `page.png` a script saved; a named file counts as written when it changed after the session started, so paths in source code and older files stay out.
  Each file shows once, at the first time a tool named or returned it.
  On a session that is every image of the session; on a subagent it is that subagent's and its own subagents'.
  Images you attached to your own prompts are left out, since the transcript shows them.
  Each thumbnail names the agent whose tool returned it and how long ago; its tooltip adds the file's path for an image on this computer.
  Click one to see it large, with the tool, its file's name, and what the call said it did; the arrows, or the Left and Right keys, step to newer and older images.
  **Open agent** opens the live agent that took it, unless the pane already shows that agent, and the external-link button opens the image in a new tab.
  New images show up while the agents run.
  Hover or focus a thumbnail to show its checkbox; once one image is selected, every checkbox shows and a click on a thumbnail selects it instead of opening it.
  The bar above the images counts the selection and sends it, in the order you selected it.
  **Add to PR description** lists the session's pull requests by number and title, and appends the images to the one you pick with `gh pr edit --attach`; it takes PNG, JPEG, GIF, WebP, and SVG images of up to 10 MB, 50 at a time.
  An image with a file on this computer goes as that file, under its name and with its name as alt text; any other goes as shown, with the call's summary as alt text.
  **Attach to Linear issue** lists the session's issues, and attaches each image to the one you pick, as the new-issue dialog attaches files; the images Linear refused stay selected.
  Either button is disabled, with a tooltip saying why, when the session has no pull request or no issue; **Clear** empties the selection.
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
- A tab with nothing to show says so.
