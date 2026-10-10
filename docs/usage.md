# Using omp-agents

The full reference for the dashboard's interface.
For installation, see the [README](../README.md).

A filled button marks the main action of its surface: Send, Finish, Resume on a past session, Run now on a routine, and **Work on it** on an open todo.
Suggested prompts, other quick actions, forking, and menu items stay quiet, so they never compete with it.
Actions that wait for the server show a spinner or a progress label and block repeated activation until the work finishes.
Starting a session, stopping a turn, switching model settings, resending a prompt, canceling a subagent, and running a routine use this state.
Refresh controls and workspace saves do too.
An action that fails shows its error, and its control becomes available again.

- [Sessions sidebar](#sessions-sidebar)
- [Session details sidebar](#session-details-sidebar)
- [Panes, splits, and links](#panes-splits-and-links)
- [Conversations](#conversations)
- [Composer](#composer)
- [Questions](#questions)
- [Starting, ending, resuming, and forking](#starting-ending-resuming-and-forking)
- [Pull requests](#pull-requests)
- [Integrations](#integrations)
- [Todo list](#todo-list)
- [Calendar](#calendar)
- [Routines](#routines)
- [Settings](#settings)
- [Notifications](#notifications)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Desktop app](#desktop-app)
- [Limitations](#limitations)

## Sessions sidebar

- The content header and both sidebar header rows are 48 px tall at the default font size, each with a hairline under it.
- The dot before each session shows its state.
  Green means a turn is running, blue means the agent is idle after finishing a turn, and amber means a question waits for an answer.
- Under **All workspaces**, a session row with a title starts with a badge that names its workspace, the last segment of its working directory.
  With one workspace picked, the rows show no badge.
  A row without a title shows the workspace's name as its label, with no badge.
- The workspace picker in the sidebar header shows only the running, idle, interrupted, and past sessions from one working directory.
  It lists the directories that a live or saved session ran in, live sessions' directories first, then the ones added in **Settings › Workspaces**, except temporary directories and hidden workspaces.
  The session counts then count that directory's sessions only, such as `2 running` and `9 past`.
  Picking a workspace also opens its most recently started running session in the focused pane, unless that pane already shows a session from the workspace or a page such as a pull request, Settings, or the new-session draft covers the panes.
  Choose **All workspaces** to list every session again.
  The choice is saved in the browser's localStorage.
  If no session from the saved directory is left, the sidebar lists every session.
- **New session** at the top of the **Sessions** tab opens the new-session draft, in the selected workspace when there is one, and stays highlighted while the draft is open.
- The search field under it narrows every group to the sessions whose title or working directory holds every word typed, in any order and any case, within the selected workspace.
  A group left without a match hides, and `No sessions match` shows when none is left; Esc clears the field.
  Cmd+K opens the command menu, which searches every workspace instead.
- Sessions in `/tmp` or `/private/tmp`, including their subdirectories, are hidden from the workspace pickers, session lists and counts, and session search.
  Starting or opening one does not replace the saved workspace.
  Their saved transcripts remain available through a direct session link.
- A workspace hidden in **Settings › Workspaces** is left out the same way, but only its own directory: sessions in a directory inside it stay listed.
- **Pin** in a row's menu moves the session to the **Pinned** group at the top of the list, and **Unpin** moves it back.
  The group lists pinned running sessions first, then pinned past ones, interrupted ones first, and shows only while it has a row.
  A pinned session stays pinned when it ends, is resumed, or is interrupted, and an interrupted one says `interrupted` after its title.
  The selected workspace applies to the group too.
  The server keeps the pins in `pins.json` beside its access token, by session id, so every browser tab and the desktop app show the same ones.
  Pins that a browser kept before then move to the server the first time its page connects.
- Each project lists its coordinator and workers in a group of its own at the top of the list, above **Pinned**, even when they run in `/tmp`; see [Projects](#projects).
- A live session whose turn ended, the blue dot, leaves **Running** for the **Idle** group above it, and moves back when its next turn starts.
  A session waiting on a question stays under **Running**, and a pinned session stays under **Pinned** whatever its state.
  The group shows only while it has a row.
- Click the **Pinned**, **Idle**, **Running**, **Interrupted**, or **Past** group label to collapse or expand its rows.
  The browser's localStorage keeps each group's choice across tabs, workspaces, navigation, and reloads, even while the group has no rows.
- The past sessions list every saved session that has no live host, newest first, with its title (else its first prompt) and how long ago it last changed; hover a row to see its working directory.
  Select one to read its transcript.
  The page cannot write to it until you resume it.
  A session that runs without publishing itself to the registry also appears in this list, and its transcript keeps updating while it runs.
  The group lists the 100 newest at first, and **Show 100 more** at its end adds the next ones.
- The interrupted sessions, between the running and the past ones, list the sessions that the dashboard started and that stopped without **End session**: because the dashboard server stopped or crashed, which stops every session it started, or because omp exited on its own.
  The group shows only while it has a row.
  Its **Resume all** button resumes every session it lists, under the selected workspace, as **Resume** does for one; a pane that shows one of them then shows it live.
  A session that was working when it stopped, or waiting on a question, also gets the prompt `continue`, so it picks its turn back up; an idle one waits for your next message.
  When some fail to start, a note under the group label names how many and the first reason, until **Dismiss**.
  **Move to past** in a row's menu moves it to the past sessions.
  A session that you end, resume, or move leaves the group.
  The server keeps the list in `interrupted.json` beside its access token, so it survives a restart.
  Sessions started in a terminal keep running when the dashboard stops, so they never show here.
- The sidebar list fades at its edges only after you scroll it: the top fades once rows pass under the header, and the bottom fades while more rows sit below.
- Drag a sidebar's inner edge to resize it: the right edge of the sessions sidebar, or the left edge of the session details sidebar.
  With the edge focused, the arrow keys move it in steps (hold Shift for bigger steps), and Home and End jump to the narrowest and widest sizes.
  Double-click the edge to reset the width.
  The button at the outer corner of the sessions sidebar's header hides it and leaves a narrow strip whose button shows it again.
  The session details sidebar's button stays at the end of the top-right pane's header, whether the sidebar is shown or hidden, and leaves with the sidebar while panes sit side by side.
  Cmd+B (Ctrl+B on Linux and Windows) toggles the sessions sidebar, and Cmd+Alt+B the session details sidebar.
  Each sidebar's width, and whether it is hidden, is saved in the browser's localStorage.
- The left sidebar's session rows leave out the full working directory and the model; hover the workspace in the pane header to see the directory, and the composer shows the model.
- A strip along the bottom of the window, under both sidebars, shows how much quota is left on each plan that `omp usage` reports, the plans side by side: each plan's provider logo, from [svgl](https://svgl.app), then each window, for example `5h 66%  7d 68%` for Anthropic.
  Hover the logo to see the plan's name and account.
  A provider without a logo shows the plan's name instead.
  A window is named by its length plus its model tier (`7d fable`).
  Two limits that would share a name, like Cursor's monthly limits, show omp's label instead.
  Amber means less than 20% is left, and red means none.
  Hover or focus a window to see omp's full limit name and when it resets.
  The server runs `omp usage --json` at startup and every minute after that.
- The strip's right side shows the machine's CPU, the percent of every core's time spent busy since the last read, the memory available, which macOS reads as `memory_pressure`'s free percentage of the physical memory, and the disk space free on the volume that holds your home directory; hover any of them for its full reading.
  The strip reads them again every five seconds while the page is visible.
- **Terminal**, at the start of the strip's right side, shows or hides the [terminal](#terminal).

## Terminal

- The terminal is a panel under the panes, between the two sidebars, with a tab for each shell.
  **Terminal** in the bottom strip, Ctrl+\` on every platform, or **Toggle terminal** in the command menu shows or hides it.
  Ctrl+\` works from inside the terminal too, and on macOS so does every Cmd shortcut, since a shell reads no Cmd key; on Linux and Windows every other Ctrl key goes to the shell.
- Each tab runs your login shell (`$SHELL -l`) on the dashboard server, in the focused session's worktree, else its directory, else the sidebar's workspace, else your home directory.
  The tab is named by that directory; hover it for the full path.
  `+` opens another tab in the same place, and the shell gets neither the server's `PORT` nor `OMP_AGENTS_PARENT`, so a dev server it starts does not reach for the dashboard's port.
  A new tab shows **Starting shell…** until the server opens its shell.
  The server refuses a new shell in a directory that no longer exists, such as a removed worktree, and while 16 shells already run; that tab reads that the server hung up on it.
- A shell keeps running while the panel is hidden and across a page reload: the reloaded page reopens a tab for each shell with its last megabyte of output.
  It ends when you type `exit`, when the tab's × hangs up on it, or when the server stops; the last tab closing hides the panel.
  The close button spins until the tab closes.
  A tab whose server stopped reads **(disconnected)** until you close it.
- Drag the panel's top edge, or focus it and press ↑ or ↓, to change its height; double-click the edge to reset it.
  Its height, and whether it shows, is saved in the browser's localStorage.

## Session details sidebar

- The right sidebar shows the focused pane's conversation at a glance, and what its agent changed, captured, and shipped: a live session, one of its subagents, or a past session, each from its own transcript file.
  It hides for a pull request's details, the tickets, **Settings**, and the new-session page, and while two or more panes sit side by side, which leaves no single pane to follow; a maximized pane brings it back.
- Tabs split it: **Outline**, **Files**, **Media**, and **PRs**.
  Each tab shows its name and, in a badge, how many items it holds, such as `3` changed files.
  When the sidebar is too narrow for every tab's icon, the tabs show their names alone.
  The sidebar remembers the tab you chose, for every view.
- **Outline** shows the conversation's turns in order, each weighted by how much it matters.
  Your first prompt opens the list whole, under **Request**, rendered as the transcript renders it, with its skill's chip first.
  The turns after it hang from a rail of icons: a person for your prompt, a bot for the reply a turn ended on.
  A prompt shows in bold on up to three lines, and a reply muted on up to three lines; hover either to read the whole message.
  A bold label that opens a reply, such as **Résumé**, is left out, so the line starts with what the reply says.
  A prompt led by `go`, or of approval words alone such as `yes`, `lgtm`, or `fix all then push`, reads as one line, **Approved**, with its words after it, such as `Approved · go all don't commit`.
  The reply such an approval follows is the agent's plan: it shows under **Plan**, rendered whole up to about twelve lines, and **Show more** opens the rest.
  A prompt of `continue` alone reads as **Continued**, and the reply before it stays a reply, since it reports work in progress rather than a plan.
  `ok` with more words, and `push` or `ship it` alone, read as prompts.
  A line under a reply counts the turn's tool calls and, in red, those that failed, such as `14 tools · 2 failed`.
  A later prompt that invoked a skill shows the skill's name in an outlined chip first, a prompt of files alone reads as their names, and a prompt of images alone reads as how many it holds, such as `2 images`.
  The turn still running shows **Working…** where its reply will go.
  Click a prompt, a reply, **Request**, or **Plan** to scroll the pane's transcript to that message; the page stays where it is.
  The turn you are reading carries a shaded background, and moves as you scroll the transcript; the outline scrolls to keep it in view.
  After you click a turn it stays marked until you scroll the transcript yourself, since the last turns may never reach the top of the transcript.
  The list follows the conversation as it goes.
- **Files** lists the files the agent's `edit` and `write` calls changed, in the order it first touched them.
  Each row shows whether the session created, edited, or deleted the file, how many times it changed it, how long ago the last change was, and the lines added and removed, which the list's heading totals.
  As on the changes page, a count of zero is left out, so a file the agent only added to shows `+12` alone.
  A path inside the session's working directory shows relative to it.
  Click a file to open its changes in a dialog over the page, newest first: each with its kind, its time, its lines added and removed, and its diff as omp recorded it with line numbers.
  The dialog follows the file while the agent keeps editing it, and Esc closes it.
  A write replaces the whole file and records no diff, so it shows how many lines it wrote instead.
  A write counts as creating the file when the session had not read or changed that path before, since omp does not record whether the file existed; a created file counts every line it wrote as added, and a later write over it counts none.
  A failed call, and a write to something other than a file, such as an `agent://` message, count for nothing.
  **Open the session's changes**, under the list, opens the session's [changes page](#session-changes); a subagent's Files tab has no such link.
  The search field above the list keeps the files whose path holds every word typed, in any order and any case, and the heading then counts and totals those, as in `2 of 9 files changed`; Esc clears it.
  Opening another session clears the search.
- Subagents are not listed here; open one from its link in the transcript, under the call that spawned it.
- **Media** shows the images that the agent's tools returned and those of its subagents at any depth, newest first: browser screenshots from `eval`, and image files that `read` opened.
  On a session that is every image of the session; on a subagent it is that subagent's and its own subagents'.
  Images you attached to your own prompts are left out, since the transcript shows them.
  Each thumbnail names the agent whose tool returned it and how long ago.
  Click one to see it large, with the tool and what the call said it did; the arrows, or the Left and Right keys, step to newer and older images.
  **Open agent** opens the live agent that took it, unless the pane already shows that agent, and the external-link button opens the image in a new tab.
  New images show up while the agents run.
- **PRs** shows the pull requests the session and its subagents submitted or worked on, as its header lists them, the session's own first; a subagent's view shows its session's.
  The first one shows until you pick another: click another pull request of its **Stack**, or of **Other pull requests of the session** under it, to show it in place.
  **Other pull requests of the session** lists the session's pull requests that the stack does not show, each with whether the session submitted or worked on it.
  The pull request then shows as its details on the Pull requests page do: the same header, then the **Summary**, **Timeline**, and **Code** tabs; **Code** lists the changed files, and a click on one opens its diff in a dialog over the page.
  The header and the tab bar stay pinned to the top of the sidebar while the details scroll, with no fade over them.
  The quick actions apply only when the pull request list of the sidebar's workspace includes the pull request.
  Opening the tab, or picking another pull request, reads it from GitHub, and so does each start and end of the view's turn, so its checks and reviews follow the agent's pushes; the server keeps its answer for 30 seconds.
- A tab with nothing to show says so, and **Outline** says when the conversation is still loading.

## Session changes

- **Open the session's changes** in the sidebar's **Files** tab or a `#changes/<session id>` address shows the files the session changed as an editor does, in place of the panes.
  The sidebar stays on **Sessions**, and the arrow before the title goes back to the session.
- The page lists two sets of files at once.
  One is what the session's git checkout changed: its worktree, else its directory, against the commit its branch forked from the remote's default branch, else against `HEAD`, else against nothing before the first commit, with uncommitted and untracked files included.
  The other is what the session's own `edit` and `write` calls changed, from its transcript, including files outside the checkout and files changed back to how they were.
  The header names the branch and the base it compares against, and totals the files and the lines added and removed.
- **All changes** shows both sets, and **This session** keeps only the files the session's own calls changed; edits that a subagent or a shell command made count only under **All changes**.
- The explorer on the left shows the files as folders, a folder holding only one folder joined with it, such as `web/components/changes`.
  Click a folder to close or open it.
  Each file shows its lines added and removed, a blue dot when the session's own calls changed it, and a letter for what git says happened: **A** added, **U** untracked, **M** modified, **D** deleted, and **S** for a file only the session's calls name, outside the checkout or no different from the base.
  A file outside the checkout shows under a `~` or `/` folder.
  ↓ and ↑ open the next and previous file in the explorer's order, outside text fields, and open the folders above it.
- The editor shows the open file, its path above it, with **Diff** and **File** to choose how; the choice is remembered.
  **Diff**, the default, shows the changes with both line numbers, removed lines red and added lines green, and three unchanged lines around each change; click **Show N unchanged lines** to unfold a run.
  **File** shows the whole file as it is now: a green bar beside added lines, a blue bar beside lines that replaced others, and a red notch where lines were removed.
  Click anywhere on a bar, or on a notch, to show the removed lines above the change, struck through.
  The strip on the right maps every change in the file, lines removed at its end at the bottom; click a mark to scroll to it.
- Both views color the code by its language.
  A binary file, a file over 1 MB, and a file git cannot compare show why instead.
  A file only the session's calls name shows whole, with nothing marked, since there is no base to compare it with.
- The page reads the changes again each time the session's own calls change a file, and when a turn starts or ends, since a shell command or a subagent changes files without telling the dashboard; the round arrow in the header reads them again now.
  A link names the open file by its path, so a reload returns to it.

## Panes, splits, and links

- Select a row to open it.
  The selection is in the URL hash, so a reload or a bookmark returns to it.
  A past session's hash is `#past/<session id>`.
  A live session's hash names its host, so it stops working when the host ends.
  `#session/<session id>` names the session itself: it opens the live session when a host runs it, else its saved transcript.
- Cmd-click a row (Ctrl-click on Linux and Windows), or choose **Open in split** from its menu, to open it in another pane.
  Up to four conversations share the page: one fills it, two sit side by side, and three or four form a 2x2 grid.
  Each pane scrolls on its own, and its composer sends to its own session or subagent.
  A plain click replaces the focused pane.
  Click or tab into a pane to focus it.
  A new session or a fork opens in the focused pane.
  With four panes open, Cmd-click and **Open in split** replace the focused pane.
  A row that is already open focuses its pane instead of opening a second copy.
  The **×** in a pane's header closes it.
  Closing the second-to-last pane returns to a single conversation.
- Right-click a row in the sessions sidebar, focus it and press the context-menu key or Shift+F10, or hover or tab to its **⋯** button, for its quick actions.
  Both menus hold the same items.
  Every row offers **Open** and, when the row is not on screen yet, **Open in split**.
  A running session adds **Pin** (**Unpin** once pinned), its pull requests on GitHub, **Workspace settings**, **Copy path**, **Copy session ID**, and **End session** when the dashboard can end it.
  A past session adds **Resume**, which opens its transcript and continues it as the header's **Resume** does, then the same pin, links, and copies.
  An interrupted session adds **Move to past** after **Resume**.
  Elsewhere on the page, right-click keeps the browser's own menu.
- Drag the line between the columns, or between the rows, to resize the panes; each side keeps at least 320 px of width or 160 px of height.
  The lines also take focus: the arrow keys move them, Shift with an arrow moves them further, and Home and End move them to either limit.
  Double-click a line to return it to the middle.
  The sizes are stored in the browser, so they survive a reload.
- The maximize button in a pane's header makes that pane fill the page.
  The other panes keep running behind it, with their drafts and scroll positions, and the restore button or Esc brings the split back exactly as it was.
  A plain click on a row opens it in the maximized pane.
  Cmd-click and **Open in split** bring the split back.
  Closing the maximized pane brings the split back too.
- The hash holds every pane, in order, separated by commas, and `@<n>` names the focused pane counting from 0, for example `#7c51f77b,past/01a0f6a5@1`.
  A maximized pane adds `;max`, for example `#7c51f77b,past/01a0f6a5@1;max`, so back, forward, and reload return to it.
  With one pane the hash is the single-view form above, so older links still open.
  **Settings** takes over the page and leaves the panes behind it.
  Select **Sessions** to return to them.
- A part of the hash that does not decode, such as `#todo/%E0`, names nothing: the page opens without it, and a pane it names drops.
- When a pane's view fails to render, that pane shows **This view failed to render.** with the error under it, and the other panes and the sidebar keep working; the pane's header buttons still close or maximize it.
  A page that fails shows the same in its place, and opening another view clears it.

## Conversations

- Opening a live session or subagent puts the cursor in the focused pane's composer once it accepts messages, so you can type right away.
  A session that reconnects takes the cursor back the same way.
- The transcript fades at its top or bottom edge only while more of it lies past that edge, so a conversation that fits the pane shows no fade.
- Each tool call in a tool group shows an icon for its tool, such as a terminal for `bash`, a page for `read`, and a plug for an MCP tool; a tool without its own icon shows a wrench.
  The icon of a call that failed is red, and the group's heading counts the failures.
- The model's thinking is a row in that same group.
  It shows while the model is still writing it, then stays.
  A thinking block the provider redacts, which has no text, stays out.
  **Settings → Preferences** has a switch for each, **Show tool calls** and **Show thinking**, which hides the tool rows or the thinking text in every pane; the heading stays.
  The choice is saved in this browser.
  Cmd+Shift+E shows or hides the tool rows, and Alt+T (Option+T on macOS) shows or hides the thinking.
  Cmd+E still opens or closes the group.
  Hiding either leaves the outline's tool count as it was.
- A `task` tool call lists the subagents it spawned, by id, under its row: each one as it starts while the call runs, and every one once the call finishes.
  A tool group that spawned subagents stays open.
  In a live session or subagent, each id is a link with the subagent's status dot (green running, blue idle, hollow parked, red aborted); hover it for the subagent's type, status, and what it is doing.
  Click it to open the subagent, Cmd-click (Ctrl-click on Linux and Windows) to open it in a split, or middle-click to open it in a new tab.
  A subagent's own `task` calls link its subagents the same way.
  A past session's ids are not links, because the dashboard opens subagents only of a running session.
- A subagent's header starts with a back arrow that opens the session's main agent in the pane, or focuses the pane that already shows it.
  Its trail then names the workspace, the session's title, and the subagent's id, as in `webapp / Fix login / 0-Explore`.
- In a subagent of a terminal session, a message steers a running subagent, prompts an idle one, and revives a parked one.
  A follow-up (Ctrl+Enter, or Cmd+Enter on macOS) waits in the dashboard until the subagent stops running.
  In a subagent of a session that the dashboard started, a message steers a running subagent at its next step, through omp's RPC `steer_subagent`.
  omp's RPC mode reaches only a running subagent, so the composer offers no follow-up there and is disabled once the subagent stops.
  The composer is also disabled for aborted subagents and read-only rooms.
- The stop button after a running subagent's link cancels it for good, as the kill in omp's Agent Hub does, and leaves the session's own turn running.
  The subagent's task ends with an aborted result, and omp cannot revive it.
  It is offered in every room that the dashboard can write to.
- The conversation follows new output while you are at the bottom.
  Scrolling up pauses that follow; the down-arrow button jumps back to the latest message.
- User and assistant messages render GitHub-flavored Markdown, including tables, task lists, fenced code, and links.
  An image in agent text shows as a link to its address, so opening a transcript never fetches anything from the web; only inline `data:` images show in place.
- A path to a text file in agent text opens the file in a dialog: `.md`, `.markdown`, `.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.jsonl`, `.yaml`, `.yml`, `.toml`, `.xml`, `.diff`, or `.patch`.
  An absolute or `~/` path opens from plain text, inline code, or a link, `file://` included; a relative one opens from inline code or a link, against the session's directory.
  A `:line` suffix, as in `docs/usage.md:12`, is dropped; hover the path to read the file it opens.
  Markdown renders as the agent's messages do, a TSV or CSV file as a table of its first 1,000 rows, and anything else as plain text; **Show source** shows a rendered file's text.
  A path in an open Markdown file opens in the dialog's place, relative to that file.
  The dialog shows the first 1 MB of a larger file and says so; it refuses a file whose real path, past any link, has another extension, and a file that is not UTF-8.
  A todo's notes do not open paths: a path there is plain text.
- Every prompt has a copy button.
  Among the agent's messages, only the reply that ends each turn has one, not the messages it writes between tool calls.
  A turn still running shows none until it ends.
- A prompt that invoked a skill shows the skill as a chip with its name (`/skill:poteto-mode do X` reads **Poteto Mode** then `do X`), not the skill's text that omp sends the model.
  That covers skills sent from the dashboard, from omp's terminal, and to a subagent, in live and past sessions.
  Copy copies the prompt as typed.
  File commands show their expanded text, because omp records only that.
- A prompt's references show as chips, as the composer drew them: a leading `/command`, `@` files and folders, and the todos, tickets, pull requests, and sessions the `@` menu inserted.
  Hover a chip for the full path or title; a ticket or pull request chip opens it in a new tab.
  The outline's **Request** shows the first prompt the same way.
- A session's header is its trail: its workspace, the last segment of its working directory (`~/code/webapp` reads `webapp`), then its title, as in `webapp / Fix login`.
  A session without a title shows its workspace alone.
  Hover the workspace to see the full directory, and the worktree the session works in when that differs.
  That is the linked worktree of the same repository that the session's own bash calls last named as their `cwd`, as when a session started in the main checkout adds a worktree and works there.
  A bash `cwd` in the session's own checkout, outside git, or in another repository leaves the worktree as it was, and one in a directory that is gone falls back to the session's directory.
- On the right of a session's header, the pull request button names the first pull request the session submitted or worked on, such as `#6595`, with `+N` for the others.
  Its menu opens each one on GitHub, on Graphite, or in its details on the Pull requests page; the button shows only for a session with a pull request.
  Past sessions show it before **Resume**.
- The composer names a session's model by its label, next to the logo of the org that makes it (`anthropic/claude-opus-5-5` reads `Opus 5.5` with the Anthropic logo).
  The label leaves out the provider, the vendor prefix, and a release date, joins version parts with dots, and puts a `:` suffix such as a thinking level in parentheses (`Sonnet 5.5 (high)`).
  For a router model such as `openrouter/moonshotai/kimi-k3`, the org is the one the id names.
  Hover it to see the full model selector.
  The settings page labels models the same way.
- Click the branch of a pull request's details or of a Linear issue's detail view to copy its name; its icon turns into a check mark for a moment.
  A long branch name keeps its start and end with `…` in the middle, in a branch picker, a pull request's branches, a Linear issue's branch, and a stack's base name; its full name shows on hover where the label has no tooltip, and copying still copies the full name.
- A live session's header shows no connection status.
  It says **Connecting…**, **Reconnecting…**, or **Disconnected** only while the pane is not live; the sidebar's status dot tells whether the session works, idles, or waits on a question.

## Composer

- While a turn runs, Enter or the send button queues a follow-up until the turn finishes.
  Cmd+Enter (Ctrl+Enter on Linux and Windows), or the **Send now** button that shows beside the attach button while a draft would queue, steers the running turn immediately.
  Cmd+Enter again on the empty composer stops that turn and delivers a pending steer now, instead of leaving it behind a long reply or tool call.
  It does nothing once the agent has already taken the steer, and a follow-up still waits.
  When omp cannot hold a follow-up for a subagent, Enter steers instead.
  An idle session takes either key as a new prompt.
- Messages that wait on the turn show above the text field, each tagged **Steer** or **Follow-up**, as Cursor lists its queue.
  Hovering a row, or focusing it, shows three buttons; a touch screen shows them always.
  **Send now** (↑ icon, or Cmd+Enter on the focused row) turns a follow-up into a steer, which the running turn takes at its next step; on a steer it stops the turn so omp runs its held steers at once.
  **Edit** (pencil, or a double-click, Enter, or F2 on the row) moves the message back into the composer, with its images; its files come back as their `<file>` blocks in the text.
  **Remove** (**×**, or Delete on the row) drops it.
  ↑ in the empty composer moves the last one back, the last steer before the last follow-up, as omp does.
  **Stop** and Cmd+Shift+Backspace interrupt the turn and move every waiting message back into the composer, images included, so nothing runs after an interrupt.
  In a terminal session, Stop moves back only the follow-ups the dashboard holds; a steer already sent waits in the host's queue.
- When a turn ends, its reply can suggest what to send next: a `Suggestions:` line followed by numbered prompts, as its last lines.
  The starter kit's `APPEND_SYSTEM.md` asks omp to write one when the next moves are clear, up to three.
  The transcript leaves the block out of the reply, and so does its copy button; the composer lists the prompts under its buttons, numbered, while it is empty and nothing else waits on you: no turn runs and no question is open.
  Press a prompt's number to send it at once. ↓ moves a highlight into the list and ↑ back out; Enter sends the highlighted prompt, Tab puts it in the composer to edit first, and Esc drops the highlight.
  A click sends it too.
  Cmd+click (Ctrl+click off macOS) marks a prompt without sending it.
  A click or a number then sends the marked prompts plus that one as a single message, one per line.
  Enter sends them plus the highlighted prompt, if any, and Tab puts the same text in the composer instead.
  Esc clears the marks along with the highlight.
  Typing hides the list, and clearing the draft shows it again; the next prompt you send ends it.
  The prompts send as you would type them, so a message of your own that starts with a digit needs another character first, such as a space, while the list shows.
  omp's terminal shows the block as part of the reply.
- A session that the dashboard started queues steers and follow-ups in omp itself, and the composer shows omp's own queue.
  Collab has no follow-up frame, and the host steers every guest message that arrives during a turn.
  So in a terminal session the dashboard holds a follow-up until the host reports that the turn ended, then sends it as a prompt, one per finished turn, as omp's default `followUpMode` delivers them.
  A steer goes to the host at once.
  The host shows guests no queue, so a terminal session lists only the follow-ups that the dashboard holds, not the steers waiting in the host.
  A follow-up held when the room closes shows as a warning in the conversation instead.
  Esc in the host's terminal during a tool call looks to a guest like a turn that ended, so a follow-up that the dashboard holds still runs after it.
- Sessions started from the dashboard have a model menu, as Cursor's does: the button reads the model and its effort, such as **Opus 5.5 High**.
  **Fast** turns omp's `/fast` on or off; it is greyed out for a model without a priority tier, and reads **not active** when omp has it on but the provider refused the fast tier.
  **Context** shows the model's context window and switches to a variant of the same model with another window, such as Cursor's `claude-opus-5-5` (300K) and `claude-opus-5-5-1m` (1M); models without such a variant have no Context row.
  **Effort** chooses the thinking level among the ones the live model supports.
  **Model** opens the model search beside the menu, with the cursor in its field.
  Before you type, it lists the models that your `modelRoles` and `retry.fallbackChains` name, plus the current one, grouped by provider.
  A name counts as the model omp runs for it, so a fallback of `cursor/grok-4.7-high` lists `cursor/grok-4.7`.
  The providers that `modelProviderOrder` names come first, in that order.
  Typing searches every connected model, and every word typed must appear in the model's selector, label, or name, in any order.
  Each provider's heading shows how much of its plan is used, by the tightest window of the account with the most left, since omp moves to that account; hover the number for that account's windows.
  The list contains models that the session's omp RPC process offers from providers you are connected to, the ones omp's `/login` marks as signed in or given a key.
  Models that omp finds without a login, such as Apple's on-device model or a local Ollama, stay out of the list.
  A login made in a terminal shows the next time the menu opens.
  Each row shows the logo of the org that makes the model, its label (`Opus 5.5`), and its id, muted, to tell apart models that share a label.
  Choosing a model, a context, or an effort closes the menu.
  While a model, Fast, or Effort change runs, the picker spins and its settings wait until the server answers.
  Terminal sessions show their model and thinking level in the same place, but Collab has no frame that changes them, so make those changes in the terminal.
  Subagents have no pickers.
- The ring before the paperclip and the send button shows how full the session's context window is.
  It turns amber at 70% and red at 90%.
  Hover or focus it to see the token count and the window size, for example `Context 10% full: 95.6k of 1m tokens`.
  The numbers are the ones that omp's status line shows.
  Dashboard sessions report them after each turn and after each model or thinking change.
  Terminal sessions report them through Collab `state` frames.
- Type `/` to complete discovered file commands and `/skill:<name>` skills.
  Type `@` to mention something: the list shows the last three files the session changed, then Files & Folders, Todos, Tickets, Pull requests, and Sessions.
  Picking a category narrows the list to it, which you can also type as a prefix: `@file:`, `@todo:`, `@ticket:`, `@pr:`, or `@session:`.
  Type `@` and a word to search everything at once: up to five files from the selected session's working directory, then up to three matches from each category.
  Every word must appear in a row's name or the detail beside it, such as a ticket's ID, in any order; quote several words, as in `@"login page` or `@ticket:"login page`.
  A file inserts its path, as in omp's terminal.
  A todo inserts its text and ID, a ticket or pull request a Markdown link, and a session its title and ID.
  Done todos and the session you are typing in stay out of the list.
  Use arrow keys, Tab or Enter to insert a suggestion, and Esc to close the list.
  File suggestions follow Git ignore rules in Git repositories.
- In the composer, a skill or command at the start of the prompt, an `@` file or folder, and an inserted todo, ticket, pull request, or session show as a chip, a single unit with an icon and a short name, such as the file's name or the ticket's ID and title.
  A picked suggestion is a chip at once; a reference you type becomes one once you type past it or move the caret away, so `/mo` stays text while you type `/move`.
  Typing right against a chip turns it back into text, so `/move` followed by `X` reads `/moveX`.
  The arrow keys step over a chip as over one character, Backspace removes a chip whole, undo brings it back, and the prompt you send is still the text behind each chip.
- Attach files to a prompt with the paperclip between the context ring and the send button, by dropping them on the composer, or by pasting them, such as a screenshot.
  They show as tiles above the text field until you send; hover a tile for its **×**.
  PNG, JPEG, GIF, and WebP files go to the model as images, up to 32 MB per prompt.
  A text file, such as `.md`, `.txt`, `.json`, or source code, goes as its text, after what you typed, in the `<file name="…">` block that omp's `@file` writes.
  A PDF, Word, PowerPoint, Excel, or EPUB file goes as the Markdown that omp's own converter reads from it.
  Each file takes up to 32 MB, and the files' text up to a million characters per prompt; a file past that, or one omp cannot read, such as a `.zip`, stays out, and a note under the composer names it and says why.
  A prompt can be files alone.
  Steers and follow-ups carry their files too, and a queued row shows the files' names when you typed nothing.
  The new-session draft takes files for its first message.
  omp gives a subagent text only, so a subagent's composer takes text, documents included, but no image.
- A prompt's images show above it in the transcript, in live and past sessions, including images sent from omp's terminal, and its files show by name in chips above the text.
- In a session that the dashboard started, omp's built-in `/` commands run as they do in its terminal, for example `/compact` or `/usage`, and what a command prints shows as a line in the conversation.
  `!<command>` runs a shell command in the session's directory, as in omp's terminal: the command and its output show as your message, and the agent sees them in its next turn.
  omp saves a new session only with its first reply, so a new session cannot start with a `!` command.
  `!!`, which keeps the output out of the agent's context, needs the omp terminal, because omp's RPC mode has no such option.

## Questions

- A question that a session asks appears above the composer: a step of omp's `ask` tool, or a dialog from an extension (a select, a yes or no confirm, a one-line input, or a text editor).
  Click an option or press its number to answer.
  Type into a text field and press Enter (Cmd+Enter or Ctrl+Enter in a multi-line field), or click **Send**.
  **Dismiss** or Esc cancels the question, which omp treats like Esc in its terminal.
  The session continues its turn with your answer.
  Questions that wait in a queue show their count next to the first one, and a question with a timeout shows the time at which omp takes its default answer.
- omp asks one step at a time, as in its terminal.
  Picking `Other (type your own)` brings a text field next.
  In a multi-select question, each pick comes back as a new step with the pick toggled, and a final row (`Done selecting` or `Next →`) submits the selection.
  In a terminal session, the checked options show highlighted.
  omp's RPC dialogs do not report which options are checked, so a session that the dashboard started shows only the count, for example `(2 selected) Which languages do you use?`.
- In a session that the dashboard started, a multi-select question inside an `ask` with several questions has no row that submits it.
  omp's `ask` moves past such a question only on the right arrow key of its terminal dialog, and RPC dialogs cannot send that key.
  Answer it with `Other (type your own)`, or ask the agent to use one question per `ask`.

## Starting, ending, resuming, and forking

- To start a session, click **New session** at the top of the **Sessions** tab.
  The page shows a new-session draft with the same header and composer as a running session: its trail reads `webapp / New session`, and hovering the workspace shows the directory that omp will run in.
  No omp process starts and no row appears in the sidebar until you send the first message, so leaving an empty draft leaves nothing running.
  The directory is the selected workspace's, else the open session's, else the newest live session's, else the newest past session's.
  To start in another directory, under **All workspaces** or not, pick it in the directory picker after the model picker, or press Cmd+Alt+P.
  It lists the workspaces the sidebar lists, and **Use** takes any directory typed into its search field.
  The message you typed stays in the composer.
  Sending the first message starts omp there and sends it the message.
  The message stays in the composer while omp starts, and also if the start fails, with the error above it.
  When omp is ready, the dashboard opens the session in the focused pane.
  The draft is in the URL hash, `#new` or `#new/<encoded directory>`, and leaves the panes behind it, as **Settings** does.
  A session that you start or fork in another directory than the selected workspace switches the workspace picker to that directory, so the sidebar lists it.
- A session that the dashboard started has the directory picker after its model picker too.
  Picking a directory moves the session there, as omp's `/move` does: the transcript stays, and the header and the session's tools follow the new directory.
  The sidebar's workspace picker switches to the new directory, as for a session you start there, unless it shows all workspaces.
  The picker is disabled while a turn runs or waits on a question, since omp moves only an idle session.
  A typed `/move <path>` works the same way; in a session with no reply yet, the dashboard follows the move once omp writes the first reply.
- The draft's composer has the model menu at its bottom left, as a running session's does, without its Fast row.
  Until you pick one, it names the `default` role's model, such as **Opus 5.5**, which is the model omp starts on without `--model`.
  It reads **Default model** only when no `default` role names a model you are connected to.
  Context and the model search work as in a running session, and the curated models come from the draft directory's config.
  The effort choices come from the selected model's omp catalog entry.
  **Default** leaves omp's configured thinking level unchanged.
  Choosing a level starts the session at that level, and choosing another model resets the effort to **Default**.
  Models without selectable thinking levels offer only **Default**.
  Cmd+. opens the model search here too, and Cmd+J cycles the supported thinking levels after the catalog loads.
- A skill pinned in **Settings** shows as a toggle after the pickers, with the skill's name.
  While it is on, the first message goes through the skill, as if you had typed `/skill:<name>` before it, and the transcript shows the skill's pill.
  Click it to start this one session without the skill.
  It is greyed out when the directory has no skill of that name, and the session then starts without it.
  A first message that starts with `/` keeps its own command and skips the pinned skill.
- When the directory is in a git checkout, a branch picker sits after the directory picker.
  The picker lists the local branches, the checked-out one first, then the most recently committed to, each with where it would run: `here`, the worktree that has it checked out, or `new worktree`.
  Picking the checked-out branch keeps the directory as it is.
  Picking another branch runs omp in the worktree that has it checked out, or adds a worktree for it when none has.
  Type a name that no branch has to create that branch from the branch picked before it, as GitHub's branch menu does; a new branch always gets its own worktree.
  A new worktree goes beside the repository's main worktree, named after both with each run of characters other than letters, digits, `.`, `-`, and `_` turned into `-` (`~/code/webapp-fix-login` for `fix/login`).
  Hovering the workspace in the header then shows the directory omp will run in, after the draft's own.
  The worktree is added only when you send the first message, and a branch or worktree that git refuses shows git's reason above the composer.
- omp titles a session that the dashboard started from its first message, as it does in a terminal, within a few seconds and while the first turn still runs.
  omp's RPC mode titles no prompt by itself, so once omp holds a message of an untitled session, the dashboard sends it a bare `/rename`, which makes omp title the session from the conversation so far.
  Until the title arrives, the sidebar and the header show the workspace's name.
  A conversation of greetings or acknowledgements only, such as `hi`, stays untitled until a later message.
  omp counts that title as one that you set, as it counts a `/rename` in a terminal.
- A running session shows **End session** in its header, unless its room is read-only.
  **End session** stops its omp process: one that the dashboard started stops over its pipe, and a terminal session gets `SIGTERM`, as when its terminal closes, so its terminal returns to the shell.
  omp records the exit in the session file, and the session moves to the past sessions, where **Resume** continues it.
  The dashboard then removes the git worktree the session works in, the one its header names the branch of, with the checks of **Settings → Worktrees**, and keeps its branch; **Resume** then reports that the directory no longer exists until you check the branch out there again.
  A worktree that those checks keep, such as one with uncommitted changes or one another session uses, stays in **Settings → Worktrees**, whose **Delete** applies the same checks; a session in a main checkout or outside git leaves its directory as it is.
  The header shows **Ending…** until the process stops and the worktree check finishes.
  Each pane that showed the session, or one of its subagents, moves to the next running session the sidebar lists, else the previous one, skipping sessions already open in a pane.
  With none left, the pane closes and the dashboard shows its empty state.
- An agent ends its own session through the `end_session` tool, when you ask it to, for example "Merge on main, then end the session".
  It comes from `~/.omp/agent/extensions/end-session.ts`, which `bun run omp-template` installs.
  The session ends once the agent's turn is over, so its last reply stays in the transcript, and it moves to the past sessions as with **End session**, not as interrupted, its worktree removed the same way.
  The tool leaves its request as `<session id>.json` in `end-inbox/` beside `todos.json`; a message sent before the dashboard acts withdraws it, and a request waits while the dashboard is down.
- **Resume** in a past session's header starts omp on that session's file from the dashboard, as `omp --resume <session id>` does in a terminal.
  The pane then shows the live session, which carries on in the same file and moves to the running sessions.
  A session whose omp process exited mid-turn, for example because the dashboard that started it was stopped, resumes too: omp records the interrupted turn first, as it does in a terminal.
  If another omp process still writes the file, omp writes the resumed session's entries to a new file instead of mixing the two.
- Click **Fork from here** under a prompt or a turn's last reply to start a dashboard session that holds the conversation up to that point, as omp's `/branch` does.
  A fork from a prompt leaves that prompt out of the history and puts it in the composer, so you can edit and resend it.
  omp writes the fork to a new session file and does not change the original.
  A session whose omp process exited mid-turn cannot be forked until you resume it once, with **Resume** or in omp, because opening it would make omp append an abort record to the original.
- In a session started from the dashboard, double-click your last message, or click its pencil, to edit it in place.
  Enter resends it and Esc, or clicking away, cancels; Shift+Enter starts a new line.
  While the server rewinds and resends, the editor keeps your text and shows **Resending…**; it closes only after the server answers, and a failure leaves the text and error in place.
  The session then rewinds to just before that message and runs the edited one, in the same pane and omp process, stopping a running turn first.
  omp moves the session to a new file, as `/branch` does, so the conversation before the edit stays under the past sessions.
  Only a plain text message that omp has saved can be edited: not a skill prompt, one with images or files, or a message in a terminal session.

## Pull requests

- A session lists the pull requests it submitted or worked on as `#<number>` after its title in the sidebar, and on the pull request button in its header.
  In the sidebar, a session with several shows the first number and `+N` for the rest, for example `#6535 +2`; hover it to read them all, or find each in the row's menu.
  Its subagents' pull requests count as its own.
  A submission is a `gt submit` line (`<branch>: https://app.graphite.com/github/pr/<owner>/<repo>/<number> (created)` or `(updated)`) or the URL a `gh pr create` call printed, both from bash output, including bash run as a background job.
  A stack submit lists every PR it created or updated.
  A `gt submit` or `gt ss` call is a submission too, even when it printed nothing, as with `-q`: of the branch it names with `--branch`, else of the branch checked out where it ran, at the time it ran, in the main checkout too, but not of a `--dry-run`.
  Where it ran follows the bash call's `cwd`, a `cd` earlier in the same command, and `--cwd`; when it ran picks the branch from that worktree's HEAD reflog, so a later switch leaves the link alone.
  Work is one of the session's own tool calls: `gh pr checkout`, `edit`, `comment`, `review`, `merge`, or `ready` with a PR number or URL; a `git push` whose output shows that it updated a PR's head branch; or an omp `pr://` read.
  Work is also the branch checked out in the linked worktree the session works in, its own directory or the worktree its bash calls last ran in, when a PR heads that branch; a switch to another branch links that branch's PR at the session's next write.
  A repository's main checkout links no PR by its branch, since every session started there shares it.
  A bare number belongs to the repository that `origin` names in the session's working directory, unless the command passes `-R` or `--repo`.
  A push, a submit, or a worktree's branch links once the Pull requests page has listed the PR that the branch heads, because only that list knows which branch heads which PR.
  A submit links only while the directory it ran in exists.
  A PR the session only quoted, listed with `gh pr list`, or looked up with `gh pr view` does not count, unless it heads the session's worktree branch.
  A PR that a session submitted counts as submitted, even when it also worked on it.
- In a session's header, the pull request button's menu opens each pull request on GitHub, on Graphite, or in its details on the Pull requests page.
- A session's row menu has **Open ENG-2368** for each Linear issue the session worked on, by identifier.
  It opens the issue's details in the tickets page's main content (`#tickets/<identifier>`), and shows the **Tickets** tab's icon.
  An issue counts when the session or one of its subagents read it with omp's Linear tools (`get_issue`, `list_comments`), changed or opened it (`save_issue`), commented on it (`save_comment`), or names it in its `/ship` step.
  An issue that a `list_issues` search only listed does not count.
- Sessions that use `/ship` show their current workflow step in the sidebar, for example `6/7 · Rebase`.
  Hover the badge to see the Linear issue.
  The steps are ticket, implementation, draft PR, thermonuclear review, ready gate, live review, and merged.
  During live review the badge names the active rebase, review-comment, or CI-fix work.
  omp writes each step to its session file; the dashboard reads those entries for running and past sessions and updates when the step changes.
  Other sessions have no workflow badge.
- Six tabs under the sidebar header, **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, and **Settings**, switch pages and what the sidebar lists.
  Click a tab or use the left and right arrow keys while a tab has focus to switch pages.
  **Tickets** shows only once Linear is connected; see [Linear tickets](#linear-tickets).
  **Sessions** lists the running and past sessions, and **Todo** opens your own todo list, with its categories in the sidebar; see [Todo list](#todo-list).
  The **Sessions** tab counts the live sessions that wait on you, idle after a turn or with a question open, for the workspace that the sidebar's picker shows, pinned ones included, whatever the sidebar's search hides.
  **Calendar** opens a month of Google events, routine runs, and due todos and tickets, with your routines listed under it; see [Calendar](#calendar) and [Routines](#routines).
  The tabs show their names, and when the sidebar is too narrow for every name, their icons alone across the sidebar's width; hover an icon for its name.
  The tabs never spill past the sidebar.
  **Pull requests** opens the Pull requests page, a table of your pull requests like Graphite's inbox, and lists its sections in the sidebar, each with its count; click one to unfold its card on the page and scroll to it.
  Once you open a pull request or a session from the Pull requests page, the sidebar lists the pull requests instead, beside the details or the session panes.
  The tab stays on **Pull requests** while you open sessions from it, until you choose **Sessions**.
  The **Your move** count stands out in bold.
  The **Pull requests** tab counts the pull requests that wait on your move, for the workspace that the sidebar's picker shows, and reads GitHub every minute on every page so the count stays current.
  A `#pull-requests` address opens the Pull requests page.
  The pull request list covers the GitHub repository of the workspace that the sidebar's picker shows, or under **All workspaces** every repository that a session ran in, one section per repository.
  A workspace's repository is the one its `origin` remote names.
  A directory removed since its sessions ran, such as a deleted worktree, is no longer a workspace, so quick actions start in a workspace that still exists.
  Each repository lists your open pull requests, your merges from the last seven days, and the open pull requests that ask you for a review.
  They sort by whose move it is: **Your move**, **Agent on it**, **Approved**, **Waiting on others**, **Drafts**, and **Recently merged**.
  A sidebar row shows the title on up to two lines with its age beside it, such as `<1m`, `19m`, `17h`, or `2d`, which counts up each minute without a reload, then a badge that names its move, its number, the reason for the move, its place in a stack, its sessions, and its checks.
  A badge is coloured only for your moves, each with its own icon and colour, such as red for **Fix CI** and orange for **Rebase**; every other move is grey.
  The Pull requests page's table shows each section as a card, one row per pull request: the move's badge, the title with its author, number, and reason under it, the sessions on it, its place in a stack, its checks, its reviewers or review state, the lines added and removed, its age, and quick actions at the far right.
  A narrow page drops the sessions, stack, and line columns.
  Each pull request takes the first move that applies, in this order.
  A merge from the last seven days is **Merged**.
  A pull request that a running session asks you about is **Answer**, and one that a running session works on is **Working**.
  An idle session's turn ended, so the move comes back to you.
  A review asked of you is **Review**, with its author as the reason.
  Your own pull request is **Rebase** with merge conflicts, **Fix CI** with failed checks, and **Reply** with requested changes or review threads that wait for a resolution.
  A draft with none of those is **Draft**.
  It is **Merge** when it is approved or needs no review, its checks passed or it has none, it has no conflicts, and no review thread waits for a resolution.
  It is **CI running** while its checks run, and **In review** otherwise, with the reviewers it still waits on as the reason.
  Once you ask every reviewer who requested changes for a new review, the pull request is **In review** again, though GitHub still reports the change request until they review again.
  **Review**, **Merge**, **Fix CI**, **Rebase**, and **Reply** are your moves, in that order within **Your move**.
  **Answer** and **Working** are the agent's, **In review** and **CI running** wait on others, and **Draft** has its own section, **Drafts**.
  Your approved pull request that is **Merge**, **CI running**, or **Draft** goes in **Approved** instead, so it leaves the **Your move** count; one that needs a rebase, a CI fix, or a reply stays in **Your move**.
  Within a section, the pull requests of each move are most recently updated first.
  When the list holds another pull request of its stack, the row shows its place from the bottom, such as `2/4`, and its tooltip names the branch it is stacked on; otherwise a row stacked on another branch names it, as in `on fix/base`.
  Within a section, a stack's pull requests sit together, top first, where its first one would, and a line joins each to the one below it.
  A row shows one session chip: a running session first, since one may be working on the pull request now, then one that submitted it, then one that worked on it.
  A submitter's chip is filled and a worker's chip is outlined, and a chip's tooltip says which it is.
  A running session's chip starts with the sidebar's status dot: green while it works, amber while it waits on a question, blue once its turn ended.
  In the sidebar the chip shows only an agent icon and that dot, with the session's name in its tooltip; the table shows the name.
  `+N` after the chip lists every session on the pull request, each with whether it submitted or worked on it; choose one to open it.
  The table shows up to two reviewers' pictures and lists the rest under `+N`; with no reviewer, an icon shows the review state.
  A pull request with more than 100 review conversations shows the count among the first 100 with a `+`, for example `12+ open threads`.
  The lightning button is always visible in the table when quick actions apply; in the sidebar it shows while you hover or focus the row, or while a session starts on it.
  Click a **Review**, **Fix CI**, **Rebase**, or **Reply** badge to start its quick action when available, such as **Resolve conflicts** for **Rebase**.
  Click a repository or a section heading to fold it; the browser's localStorage keeps your choice across reloads.
  A folded section's heading shows its count, and its tooltip sums up its moves, such as `2 in review · 1 CI running`.
  A repository's heading names its workspaces only when their folder differs from the repository's name, and an unplugged icon in the header lists the workspaces whose repository could not be read.
  **Waiting on others** and **Recently merged** start folded, since they hold nothing to do now, and stay unfolded once you unfold them.
  Click the row to show the pull request's details in the main area; session chips, move badges, and quick actions keep their own clicks.
  The title remains a link for keyboard and modifier-click navigation.
  The back arrow at the start of the page header, **Back to Pull requests**, brings the Pull requests page back.
  Click a session to open it.
  The dashboard reads GitHub through `gh` when it loads and every minute after, on every page, so the **Pull requests** tab's count stays current.
  Reopening the Pull requests page, even after a reload, shows the last pull request list read for the chosen workspace at once; the top of the list says when that list was read, and the browser's localStorage keeps the last one of each workspace.
  The server keeps each repository's answer for 30 seconds, and the refresh button asks GitHub again at once.
- The sort button at the top of the Pull requests page orders the pull requests within each section: **Recently updated**, the default, **Newest first** and **Oldest first** by number, or **Manual**.
  Any sort but **Manual** keeps your moves in their order and sorts within each move.
  Drag a pull request within its section to place it by hand, which switches the sort to **Manual** and keeps the order the section showed until then.
  In **Manual**, a pull request you never placed comes first, most recently updated first.
  A stack moves as one, and its pull requests keep their order from the top of the stack.
  Drag a repository's name on the page or in its sidebar index to reorder the repositories, and a section's heading on the page to reorder the sections, which applies to every repository.
  Alt+Shift+↑ and ↓ move the focused pull request, section heading, or repository name one place, as dragging does.
  The browser's localStorage keeps the order across reloads, and **Reset the order** in the sort menu restores the default.
- The details of a pull request open with a header: the repository and number, a link to it on GitHub, then the title, its author, when it last changed, and `gh pr checkout <number>`, which a click copies.
  Its last line shows the branch it merges into, marked with a stack icon in amber when that is another pull request's branch, the branch it brings, its files, and the lines added and removed.
  On the right of the first line, the **Next move** shows as its badge, with its reason on hover, and one button that makes it.
  The button is the quick action that hands the move to an agent, such as **Fix CI** for **Fix CI** or **Resolve conflicts** for **Rebase**; a **Rebase** whose checks also failed offers **Fix CI and conflicts**.
  **Merge** offers **Merge on GitHub**, and **Answer** and **Working** offer **Open the session**; a move that no button makes, such as **CI running**, shows its badge alone.
  The `⋯` menu beside it holds the other quick actions, then **Open on GitHub** and **Open on Graphite**, each with its logo.
- Under the header, tabs split the details: **Summary**, **Timeline**, with the count of its comments, reviews, and review threads, and **Code**.
  The tab bar's right end sums up the head commit's checks, such as `1 of 3 running`, `2 of 5 failing`, or `3 passing`; click it for the failing and pending checks, and the passing and skipped ones folded behind their counts.
- **Summary** lists the pull request's properties.
  **Status** shows the pull request's state, then what stands between the pull request and its merge: **Ready to merge**, merge conflicts, failed checks, requested changes, unresolved review threads, checks still running, the reviews it waits on, approvals, and passed checks, blockers first; a blocker that another quick action works on carries that action's button.
  Click the state to make the pull request **Open**, **Draft**, or **Closed**; a merged one keeps its state.
  **Reviewers** lists each reviewer with an icon for where they stand: approved, requested changes, commented, or a review still requested.
  Click the reviewers for the people who can review on the repository, its author left out: picking one asks them for a review, again when they reviewed already, and picking someone already asked withdraws the request.
  **Labels** shows the labels in their GitHub colors; click them for the repository's labels, and pick one to add or remove it.
  The lists of reviewers and labels come from GitHub on the first click, and the server keeps them for 5 minutes.
  A change shows at once and goes to GitHub in turn after the ones before it; when GitHub refuses one, the details say why and read the pull request again.
  **Sessions** shows the running sessions on the pull request.
  When another open pull request of its repository stacks with it by base branch, whoever opened it, **Stack** shows the stack top first on a rail down to the branch the bottom one merges into, as Graphite does, marks this one, and links to the others; in the session details sidebar, a click shows the other one there instead.
  The server reads the repository's open pull requests for it and keeps them for 30 seconds.
  Then comes the description in full.
- **Timeline** lists what happened on the pull request as a chat does, newest first, with a line for each day that stays on top while you scroll its entries.
  Each entry shows its author's avatar, name, and time: a push lists its commits, one author's commits within an hour as one entry, with each commit's short hash and lines added and removed; a review shows its verdict and words; a comment shows its words.
  The pull request's own commits show, not those of its trunk that its branch took in; a commit counts as its own unless GitHub links it only to other pull requests.
  An unresolved review thread shows its first comment, under the file and line it is on, which link to the file on the **Code** tab; its replies fold behind a bar that shows who replied, how many replies, and when the last came.
  A red **New** line sits under what happened since you last opened the pull request's timeline in this browser, which its localStorage keeps for 30 days.
  Above the list, the counts of comments and commits, and **Newest first**, which flips the order.
- **Code** shows the pull request's files as the [session changes](#session-changes) page shows a session's: the explorer with every file the pull request changes, up to GitHub's 3000, and the open file in **Diff** or **File**, with ↓ and ↑ to step through them.
  A renamed file shows **R**, and a copied one **A**.
  It reads the files from GitHub, so it needs no checkout of the repository; a file GitHub shows no diff for, such as a binary one or one with a very large diff, shows why instead.
  Opening the tab reads the list from GitHub again, and the files you open within 30 seconds read from that list.
  In the session details sidebar's **PRs** tab, **Code** lists the files instead; a click on one opens the explorer in a dialog at that file, where the others open in place.
- Each opening reads the pull request again; the server keeps its answer for 30 seconds.
- The Pull requests page works from the keyboard, outside text fields, while its tab shows.
  ↓ and ↑ move to the next and previous row, and Enter shows the focused row's details.
  While the details show, ↓ and ↑ show the next and previous pull request; while the **Code** tab shows, they open the next and previous file.
  The sidebar's pull request list, which stays while you work in the sessions, takes ↓ and ↑ only once one of its rows has focus, so they keep scrolling a session.
  O opens the focused row's pull request, or the one whose details show, on GitHub, and `.` opens the focused row's quick actions.
  E gives the focused row's move, or the move of the pull request whose details show, to an agent, when a quick action makes that move.
- `#pull-requests/<owner>/<repo>/<number>` shows one pull request's details.
  The sidebar unfolds its row's repository and section, scrolls the row into view, and highlights it.
  When the list does not include that pull request, a note says why, and the details still show.
  `#pull-requests/<owner>/<repo>/<number>/files` opens the details on the **Code** tab at the first file, and `#pull-requests/<owner>/<repo>/<number>/files/<path>` at the file at that path, encoded; choosing **Code** puts that address in the location bar, and another tab takes it out.
- A lightning button on a row of the Pull requests page, and buttons in the pull request's details, start a new dashboard session in the background, in the repository's most recently used workspace, with a prompt that names the pull request and its branch.
  The page stays on screen, and the session shows at once as a chip with its status dot on the row and in the details of that pull request, before it has touched the pull request; click the chip to open the session (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  The chip stays while the session runs, after a reload too, so the row says whether an agent still works on the pull request.
  The session also shows in the sessions sidebar.
  Which actions show depends on the pull request: **Fix CI and conflicts** on your own open pull request with merge conflicts and failed checks, **Fix CI** on your own open pull request whose checks failed, **Resolve conflicts** on your own open pull request with merge conflicts, **Address comments** on your own open pull request with unresolved review threads or requested changes, **Review** on an open pull request that waits for your review, and **Thermonuclear review** on every open or draft pull request.
  **Fix CI and conflicts** rebases the branch and resolves its conflicts first, then fixes the checks that still fail on the rebased branch, in one session.
  **Thermonuclear review** runs the `thermonuclear-reviewer` agent on the pull request's diff.
  On your own pull request, the session then applies the valid findings on its branch, pushes them, and only after the push adds `- [x] Thermo-nuclear code quality review` to its description; on a pull request you review, it reports the findings in the session and changes nothing on GitHub.
  A merged pull request has none.
  The button waits while the session starts.
  When the start fails, a note at the top of the Pull requests page, and in the details of that pull request, gives the reason until you dismiss it.

## Linear tickets

- The **Tickets** tab, or a `#tickets` address, opens the Linear issues assigned to you, as Linear's **My issues › Assigned** lists them.
  The sidebar then lists the workflow states with their issue counts; click one to scroll the page to it and move focus there, and a folded state unfolds.
- The page groups the issues by workflow state.
  **In Review** comes first, in the sidebar and on the page, with a green circle-dot icon.
  The other states follow Linear's order: triage, started (such as **In Progress**), unstarted (**Todo**), backlog, completed, and canceled.
  Duplicates count as canceled.
  Completed and canceled issues show only when they changed in the last seven days, like the recent merges on the Pull requests page.
  Within a state, issues sort by priority, urgent first and no priority last, then by the latest update.
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
  The detail view lays the issue out as Linear does: the title, the description, and the comment threads in a wide column, and beside it the quick actions, the state, the priority, the assignee, the due date, the labels as chips, the project, Linear's branch name for it, the links Linear keeps for it (a pull request with its own icon), who opened the issue and when, and a link to the issue on Linear.
  On a page narrower than the side column needs, the side column stacks between the title and the description.
  Each opening reads the issue again through Linear's `get_issue` and `list_comments` tools.
  Linear's issue mentions in the text become links.
  Its images show in place, its screen recordings play in a video player, and another embedded file becomes a link to download it.
  The dashboard's server fetches each of these files from Linear, so a video still plays and seeks after Linear's five-minute link to it expires.
- Once Linear has answered, each field in the side column is a button that changes the issue in Linear: the state, the priority, the assignee, the project, and the labels open a list to search and pick from, and the due date opens a date field with **Set** and **Clear**.
  Labels toggle, and their list stays open for several.
  A change shows at once and saves in turn after the ones before it.
  The tickets list reads Linear again after each save, so an issue you assign to someone else leaves it.
  When Linear refuses a change, the detail view says why and shows the issue as Linear has it.
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
  Until omp is signed in to that server, the sidebar has no **Tickets** tab, Cmd+2 keeps its browser behavior, and a `#tickets` address shows Linear's integration row instead of the issues.
- To connect, open **Settings › Integrations** and choose **Connect** on Linear's row; see [Integrations](#integrations).
  A new browser tab opens Linear's sign-in page; approve omp there, and the **Tickets** tab appears within a few seconds.
  When Linear later refuses the sign-in, the **Tickets** tab stays and its page shows Linear's row with **Reconnect**; the Todo page's **Create Linear ticket** and the Calendar's tickets hide until it works again.

## Integrations

- **Integrations** is a section of [Settings](#settings): a row for each service omp's sessions reach through an MCP server, Linear, Slack, and Google Calendar so far.
  **Connected** lists the services that hold a sign-in, working or not, and **Available** lists the rest.
- Each MCP row shows whether omp is connected, by listing the server's tools with omp's sign-in: **Connected** with the server's host and the number of tools, which unfolds to their names, **Needs reconnecting** when the server refuses the sign-in, **Unreachable** with the server's error and **Check again**, or **Not connected** or **Signed out** when omp has no server or no sign-in for it.
  An unconfigured Slack or Google Calendar row says **Not set up** until its OAuth client is saved.
  The section checks again every minute while it is open, and **Refresh** checks at once.
- **Connect** signs in the way omp's `/mcp reauth` does, saves the sign-in in omp's credentials, and adds the service's MCP server, such as `https://mcp.linear.app/mcp`, `https://mcp.slack.com/mcp`, or `https://calendarmcp.googleapis.com/mcp/v1`, to `~/.omp/agent/mcp.json` when omp has none, so new omp sessions can use its tools too.
  Linear sends the browser back to `localhost:3000`, so that port must be free while you sign in.
  Slack sends the browser to the HTTPS redirect saved for the app, and omp listens for HTTP on the saved callback port.
  Google Calendar sends the browser back to `localhost` on the saved callback port, 3119 unless you change it.
  While it waits, the row says so, links to the sign-in page again, and hides its other buttons.
- A connected row's ⋯ menu holds **Reconnect**, which signs in again over a sign-in that the server refused or that still works, and **Sign out**.
  **Sign out** asks first, then removes the sign-ins omp manages for the service, as omp's `/mcp unauth` does, so omp's sessions lose its tools too; the server stays in `mcp.json`.
  When the sign-out fails, the question stays with the reason, to try again or cancel.
- Slack shows **Not set up** and **Set up** until its app settings are saved.
  **Set up** is for a new internal app from [Your Slack apps](https://api.slack.com/apps).
  Leave any existing production app unchanged.
  In the new app, open **Agents** and turn on **Slack Model Context Protocol (MCP) Server**.
  Add the user scopes for the conversations omp may search, read, and send.
  The form lists every scope it accepts, and you can save a smaller read-only set.
  Canvas, list, file, and reaction scopes are not part of that set.
  Turn on token rotation on that new app before you connect.
  Token rotation is irreversible, and Slack cannot turn it off later.
  omp refuses a Slack sign-in that comes back without a refresh token.
  It does not keep a grant that stops working when the access token expires.
  Register an HTTPS redirect URL on the app.
  A TLS terminator you trust must forward that URL to the HTTP callback on this machine.
  The callback port is 3000 unless you change it.
  An HTTP localhost address does not work as the redirect.
  If the redirect is HTTPS on localhost, choose a callback port other than the redirect's port.
  Slack requires confidential OAuth with the app's client ID and secret.
  Paste the client ID and the client secret.
  omp stores the client secret in that server's entry in `~/.omp/agent/mcp.json`.
  The Integrations section does not show the saved secret.
  Leave the secret blank to keep the saved secret when the client ID stays the same.
  A new client ID needs its own secret.
  A saved row shows the registered redirect and the callback listener, such as `localhost:3000`.
  **Connect**, **Reconnect**, **Sign out**, and the tool list then match the other MCP rows.
  **Reconnect** and **Sign out** keep the app settings.
  **Replace app settings** in the ⋯ menu opens the form again.
  Changing the client ID or the secret signs omp out of Slack and drops the old credentials.
  Saving a different scope selection changes the next **Connect** or **Reconnect**, not the existing sign-in.
- Google Calendar shows **Not set up** and **Set up** until its OAuth client is saved.
  In a [Google Cloud project](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), turn on the Google Calendar API.
  Under [Credentials](https://console.cloud.google.com/apis/credentials), create an OAuth client ID of type **Web application**, and add `http://localhost:3119/callback`, with your callback port, as an authorized redirect URI.
  Paste the client ID and secret, then **Connect**; Google asks you to grant reading and editing your events, reading your calendar list, and free/busy.
  omp stores the secret in that server's entry in `~/.omp/agent/mcp.json`, and the secret, client-change, and **Replace OAuth client** rules are Slack's.
  Once connected, the row lists the calendars checked in Google Calendar's own list, in their colors, with why the last read of one failed; one you unchecked in the Calendar page's sidebar shows muted and says **Hidden on the Calendar page**.
  Google Calendar's MCP tools answer omp's sessions only when the client's Google Cloud project is in Google's Workspace Developer Preview Program; the Calendar page reads Google's Calendar API and does not need it.

## Todo list

- The **Todo** tab, or a `#todo` address, opens todos of your own, not tied to a session or a workspace, in place of the panes.
  The sidebar then lists **All**, **Today**, **Needs you**, **From agents**, and **Archive**, then your categories, each with how many top-level todos are open in it.
  Each category has a color dot, and its todos carry a badge of that color.
  Click one to show its todos alone; `#todo/today`, `#todo/needs`, `#todo/agents`, `#todo/archive`, and `#todo/<category id>` address them.
  **All** lists every todo in one list, each top-level todo with its category's badge; a category's own list shows no badges.
  **Today** lists the todos due today or before, or with a todo under them that is, earliest due first; **Add a todo due today** there adds one due today.
  **Needs you** lists open todos whose latest linked session has a question open or is idle, wherever that session ran.
  **From agents** lists the todos that an agent added; see [Todos from agents](#todos-from-agents).
- The **+** beside **Categories** adds a category; type its name and press Enter, and the page opens it.
  A category's **⋯** menu renames it or deletes it; deleting a category keeps its todos, in no category.
- **Add a todo** at the end of a list's **Todo** group, or C outside a text field, starts a new todo in that list's category; type its title and press Enter.
  The **+** in a group's header starts one of that group's status instead.
  Enter then starts the next todo below it, of the same status, and Enter on an empty one, Esc, or a click elsewhere stops.
- A new todo's title, here or in the command menu's **Create todo**, can end with a due day: `today`, `tomorrow`, a weekday such as `fri` or `friday`, or a `YYYY-MM-DD` date.
  A new top-level todo's title can also end with `#` and the name of an existing category in any case, before or after the day.
  They set the todo's due day and category and leave its title, and a word that names neither stays in the title.
  A weekday names its next date, today included.
- Cmd+Enter or Ctrl+Enter on a new or edited top-level todo saves it and opens its **Start session** draft.
- A todo can hold todos of its own, one level down and no deeper, and they share its category.
  Tab while typing a todo moves it under the todo above it, and Shift+Tab moves it back out, with the todos below it, so the list reads in the same order.
  Tab does nothing on a todo that holds todos of its own, since they would end up three deep, nor on one with links, which a todo under another cannot hold.
  The **+** that shows on hover adds a todo under that one.
- A todo has a status, as a Linear issue does: **Backlog**, **Todo**, **In Progress**, **Done**, or **Canceled**; a new todo is **Todo**, and Done and Canceled close it.
  It also has a priority on Linear's scale: none, **Urgent**, **High**, **Medium**, or **Low**.
  It can be assigned to **You** or to an **Agent**, or to no one, as a new todo is; assigning an agent only records who should do it, and starts no session and changes no status.
- Every list but **Archive** groups its top-level todos by status, **In Progress**, **Todo**, **Backlog**, **Done**, then **Canceled**, each under a header with the status's icon, its name, and how many todos it holds; click a header to fold or unfold its group.
  **Done** and **Canceled** start folded, the browser's localStorage keeps what you fold, and a search unfolds every group.
  A group with no todo hides, except **Todo** in a list you can add to.
  Within a group, todos keep the list's own order: the one you set, or the earliest due day for **Today**.
- Drag a todo by its row to move it among the todos of its status beside it, top-level ones in **All** and a category, and a todo under another among its parent's.
  A dragged todo keeps its category; change it from the open todo.
  Alt+Shift+↑ and Alt+Shift+↓ move the focused todo one place the same way.
  **Today** sorts by due day and **Archive** by when it was cleared, so neither moves todos.
- A row shows the todo's priority as an icon when it has one, its status as an icon, its title, then what it carries, its assignee's icon when it has one, and the day it was added; a todo under another has its own priority, status, and assignee.
  Click the status icon, or the priority icon when there is one, to pick another, or press S or P outside a text field for the focused todo, or else the open one; while the menu is open, the digits pick a choice, 1 to 5 for a status and 0 to 4 for a priority.
  The open todo's **Priority** button sets a priority too.
  A does the same for the assignee, with 0 for none, 1 for **You**, and 2 for **Agent**, and Shift+D for the due day.
  Closing a top-level todo, as Done or Canceled, closes the open todos under it the same way.
  At both levels, open todos come first and closed ones after them, so a todo under an open one moves below the ones still open beside it once it closes, and reopening a todo puts it last among them.
  An open top-level todo linked to a session shows a work-state dot in the list and a pill in the open todo, instead of repeating the session's name: **Agent working**, **Needs you**, **In review**, **Shipped**, **Session ended**, or **Session unavailable**.
  Hover the dot for its state; the dot and the pill open the latest linked session, and do not change the todo's status or category.
  A todo that holds others shows how many of them are done, as in `2/3`, right after its title.
  The page's header counts the open top-level todos, and **Clear done** moves every Done and Canceled todo it lists to **Archive** at once, a closed todo under an open one as a todo of its own.
  The server does the same by itself for a todo closed over 24 hours ago, when it starts and every minute after.
- **Archive** lists the cleared todos, latest first, with the day each was closed.
  Hover one to put it back last in the list, in its category if that still exists, or to delete it for good; **Empty** deletes them all, after you confirm.
- Click a todo to open its details on the right of the list, as in Linear, and double-click it to rename it in the list; with no todo open, that side says how to open one.
  Drag the line between the list and the details, or focus it and use the left and right arrow keys, to size the list; double-click it to reset, and the browser's localStorage keeps the width.
  A page too narrow for both shows the open todo in place of the list, and its **×** goes back to the list.
  The open todo's bar names its category, its parent for a todo under another, and its status; its ↑ and ↓ open the todo above and below in the list, and **×** closes it.
  The address names the open todo, as `#todo/<category id>?open=<todo id>`, so a reload, a link, or the browser's Back returns to it.
  A search keeps the open todo on the right even when it hides its row.
  An empty title, or Backspace in an empty one, deletes the todo, and so does the **×** that shows on hover; deleting a todo deletes the todos under it.
  **Undo** shows for eight seconds after a delete and puts the todo back where it was, with its todos, notes, and links.
- The search field in the page's header, or `/` outside a text field, keeps the todos whose title or notes, or a todo under them, hold every word typed; Esc clears it.
  Outside a text field, ↓ and ↑ focus the next and previous todo, X marks the focused or open one **Done**, or a closed one **Todo** again, and Enter opens it.
  While a todo is open, ↓ and ↑ open the next and previous one instead, and Esc closes it.
- An open todo shows its title, which you edit in place, with Enter or a click elsewhere saving and Esc undoing.
  Under it, buttons show its status, its priority, its assignee, its category for a top-level todo, and its due day, each opening a menu to change it; the due day's menu also clears it.
  A todo due today reads **Today**, and one whose day has passed reads **Overdue** in red.
  Its notes follow, always formatted.
  Click into them and type: markdown at the start of a line formats it as you type, `# ` a heading, `- ` a bullet, `1. ` a numbered list, `[ ] ` or `[x] ` a check item, `> ` a quote, and ```` ``` ```` a code block.
  Around text, `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, and `[text](url)` format it too, and a typed or pasted URL becomes a link; a click on a link opens it in a new tab, and a click on a check item's box ticks it.
  The notes save a moment after you stop typing or tick a box, and at once when you click away, on Esc, or on Cmd+S; they are kept as markdown, and a todo with notes shows a notebook icon in the list.
  Underline and other formatting that markdown cannot hold, as Cmd+U or a paste would bring, does not apply.
  A GitHub table and raw HTML are not formatting the editor knows: they show and save as the text you wrote, one block per line.
  Saving an edit rewrites some markdown the way the editor writes it: a sublist indents four spaces, and `_italic_` and `__bold__` become stars.
  A `*`, `_`, `` ` ``, or `~` you type saves as typed, unless one in the note would read as formatting; then each of them saves after a backslash.
  A top-level todo then lists its sub-todos, with how many are done, a bar of that share, and each one's status and its priority when it has one; click one to open it, and the **+** adds one.
  A card then shows its latest linked session's work state and, when that live session has a question open, its title and **Reply in session**, which opens that session.
  For an open todo, the card's **Work on it** and **Plan it** start a session on it at once, and **Start session** opens the draft; with no linked session, only those buttons show.
  At the bottom, it shows the day it was added and the session that added it.
- A top-level todo shows what it links to: a session, a pull request, or a Linear issue, as an icon in the list and a chip under **Links** in the open todo, each opening it here.
  Each shows the icon of the sidebar tab it opens: **Sessions**, **Pull requests**, or **Tickets**.
  A running session shows its status dot; an open todo's **×** on a chip unlinks it.
- An open top-level todo's **Work on it** and **Plan it** start a session at once, in the sidebar's workspace, through the pinned skill when one is pinned, and link it to the todo.
  **Work on it** does what the todo asks from its title, notes, and open sub-todos, in a git worktree on a new branch when it changes code, then commits and reports without pushing.
  **Plan it**, on a todo not **In Progress** yet, reads what the todo concerns and reports a plan without changing anything.
  The button waits while the session starts, and a start that fails says why in the card, naming the todo by its title.
- An open top-level todo's **Start session** opens the new-session draft with its title and notes as the first message, in the sidebar's workspace, to edit the prompt or pick another directory first; `#new/<cwd>?todo=<id>` addresses it.
  A session started from a todo links to it once omp starts, which moves a **Backlog** or **Todo** todo to **In Progress**, and its agent marks the todo **Done** once it finishes the work; see [Todos from agents](#todos-from-agents).
- With Linear connected, an open top-level todo's **Create Linear ticket** asks for a team, starting with the last one an issue was created in, then opens an issue from the title and notes, assigned to you, and links it to the todo.
- The list icon on a ticket adds a todo of no category, last in the list, that links to it.
- The server keeps the list in `todos.json` beside its access token, so every browser tab and the desktop app show the same list, and a change in one shows in the others at once.
  A `todos.json` from before categories, notes, due days, links, the archive, statuses, priorities, or assignees still loads, with none of them; a todo checked then reads as **Done**, an unchecked one as **Todo**, both with no priority.
  A `todos.json` that the server cannot read as a todo list is moved to `todos.json.invalid` rather than written over.
  While the page has lost the server, the list cannot be changed.

### Todos from agents

- The `user_todo` tool lets an omp session list your todos, add one, or check one off, which marks it **Done**; it cannot edit or delete one, nor set another status.
  It comes from `~/.omp/agent/extensions/todos.ts`, which `bun run omp-template` installs.
- An agent adds a todo when it stops on a step outside the session that only you can take, such as setting up an account or a credential, running something on your machine, or reviewing a pull request.
  It asks for an approval or an answer in its reply, not in a todo.
  The todo lands last in no category, as **Todo** with no priority, and its chip names the session that added it and opens it.
- At each prompt, a session is told which open top-level todo links to it, such as the one its **Work on it**, **Plan it**, or **Start session** started, and which open todos it added.
  Its agent checks a linked todo off once it finishes the work, and leaves it open while the work still waits on you.
  It checks off a todo it added once you have done the step or it no longer applies, and adding a todo it already added, with the same title, returns the open one.
  Any agent also checks off a todo whose work you ask it to do.
- The tool takes an empty `due`, `text`, or `id` as absent.
- The tool leaves each change as a file in `todo-inbox/` beside `todos.json`, and the server applies it and deletes the file, so a todo an agent adds while the dashboard is down shows once it starts.
  A file that is not a change an agent may make, an add or a check, moves to `<name>.invalid`.

## Calendar

- The **Calendar** tab, or a `#calendar` address, shows a month in place of the panes, Monday first.
  The sidebar then lists **Calendar**, then, once Google Calendar is connected, your Google calendars under **My calendars** and **Other calendars**, then **All** and each routine by name.
- Each day lists its routine runs, the todos due on it, and, once connected, the Linear tickets due on it and events of the Google calendars you added.
  A green dot is a run that went through, a red one a run that failed, and a hollow one a run still to come.
  A violet dot is a todo, an amber one a ticket, and a timed Google event uses its calendar's color; an all-day event is a band in that color; a done or canceled todo or ticket is struck through.
- Planned runs follow each routine's schedules from its last run.
  A time that passed without a run shows as now, since the next minute's check runs it.
  A paused routine shows its past runs and no planned ones.
  A routine that runs more than once a day shows once on each day from today, with how often it runs, instead of each run.
  Only the last 10 runs of a routine are kept, so older months show no past runs.
- A day cell shows three entries and how many more there are; today's number is circled.
  Hover a day, or focus its number, to see all of its entries in a card beside it, each a link like in the day's list.
  Click a day's number, or its **+N more**, to list all of its entries beside the month; today is listed when the page opens.
- Click an entry to open its routine, its todo beside its list, or its ticket; a Google event opens in Google Calendar in a new tab.
- The arrows move a month at a time, the month and year menus jump to any month, and **Today** goes back to the current month.
- To show Google events, connect Google Calendar in **Settings › Integrations**; see [Integrations](#integrations).
  The sidebar lists the calendars checked in Google Calendar's own list, the ones you own under **My calendars** and the ones you subscribed to or others share under **Other calendars**, as Google Calendar groups them.
  Each has a checkbox in its color: uncheck one to hide its events on this page, and check it to show them again; the month updates at once.
  The checkbox flips immediately and waits for the save and event refresh before taking another click.
  A failed save restores its previous value and shows the error.
  The server keeps the choice in `calendars.json` beside its access token, so every browser tab and the desktop app show the same calendars.
  A calendar unchecked in Google Calendar's own list is not listed; check it there first.
  The page leaves out canceled events, the ones you declined, and working locations, repeats multi-day events on each day, and refreshes the open month every minute.

## Routines

- A routine starts sessions, or runs a shell command, on one or more schedules.
  **All** under the **Calendar** tab, or a `#routines` address, lists them in place of the panes, and the sidebar lists each routine by name, a paused one muted.
  `#routines/<id>` opens one routine.
- Routines run only while the dashboard runs; a time missed while it was down, or while the Mac was off or asleep, starts one run once it is back.
  In the desktop app, **Open at Login** keeps it running from the moment you log in.
- **New routine** opens the editor: a name, the workspace it runs in, its task, its schedules, and its skill.
  The task is a prompt you write, or a shell command.
  A prompt task can also **Pin the session when it finishes**.
  Each schedule repeats every so many minutes, hours, or days, counted from the last run, or runs at a time of day on the days you pick. **Weekdays** and **Every day** pick those days at once. **Add schedule** adds another. The routine runs at the earliest of them, and a missed time still starts one run.
  The skill starts as the one pinned in **Settings › Preferences**, and **None** starts the sessions without one.
- A command routine runs its command with `sh` in its workspace, without an omp session, so it takes no skill and the editor hides that field.
  The command runs with your user's full permissions, and nothing asks before it acts: a file it deletes is gone.
  It stops after 10 minutes, and its run keeps the last 64 KB of what it printed, stdout and stderr together.
  A command routine whose last command still runs records an error instead of running a second one.
  Its runs read **Running…**, **Succeeded**, **Failed (exit n)**, **Stopped at the time limit**, **Stopped with the dashboard**, or **Could not start**, and anything but a success also counts as an error.
- Each row shows the routine's schedules and task, when it runs next or **Paused**, and what its last run did: how many sessions it started, how many errors it had, and **Queued** while its session waits for a free slot.
  Its **⋯** menu has **Run now**, which runs it at once whatever its schedules, **Pause** or **Resume**, **Edit**, and **Delete**, which asks first.
  **Run now** shows progress until the server starts or queues the run, not until its prompt or command finishes.
- A routine's page shows its settings and its last 10 runs, newest first, each with the sessions it started, its command's output, and its errors.
  Output longer than 20 lines folds behind **Show output**.
  Click a session to open it, live while it runs, else its transcript (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  A run still opens a session in `/tmp`, which the sidebar does not list.
- At most 3 routine sessions run at once, and a queued run starts as one of them finishes.
  Commands do not count toward that limit.
  A prompt routine whose last session still runs records an error instead of starting a second one.
- A routine session runs unattended: its prompt tells it not to ask questions.
  Once its turn finishes, the dashboard ends it, so it moves to the past sessions with its transcript, and **Resume** continues it.
  With **Pin the session when it finishes** on, the session is pinned as its turn finishes, before it ends, so it shows under **Pinned** rather than **Past**.
  That pin replaces the one on the routine's previous session, and your other pins stay.
  A session that has not begun its turn 10 minutes after it started is ended, and its run records that as an error.
  Such a session is not pinned.
- Routines run only while the dashboard runs.
  A slot missed while the dashboard was closed runs once when it starts again, however many slots it missed.
  Quitting the dashboard stops a running command, and the next start does not run it again; its run reads **Stopped with the dashboard**.
- When more than one dashboard runs, such as a second one on another port, only one runs the routines and takes the todos that agents add; it is the first one started, and the server on another port says so in its log when it starts.
  If that one quits, another takes over within a minute.
- The server keeps the routines in `routines.json` beside its access token, so every browser tab and the desktop app show the same ones.
  While the page has lost the server, the routines cannot be changed.

## Projects

- A project is a coordinator session that plans the work and hands it to worker sessions, as Cursor's Projects do.
  The coordinator never changes the project's code: it starts a worker for each change, follows what the workers report, and tells you what is done and what waits on you.
  Every session of a project reads and keeps one shared directory of notes.
- The **Projects** page, a `#projects` address, G then P, or **Go to projects** in the command menu, lists the projects.
  On the **Todo** page, G then P picks the focused or open todo's priority instead, as P alone does there; with no todo focused or open, it opens the projects.
  **New project** on that page, the **+** of the sidebar's projects group, or `#projects/new` opens its form: a name, the workspace the coordinator starts in, its model and effort, as on a new session, and its first message, which says what the project is for.
  **Create** starts the coordinator on that message and opens its pane; a name left empty becomes **New project**.
  The project exists once its coordinator runs, so a start that fails leaves none behind.
- The coordinator has four tools that the dashboard serves it, and only it has them.
  `start_worker` starts a worker: a new dashboard session on a prompt that stands alone, with a short title, in the project's workspace or a directory the coordinator names, absolute, `~/`, or relative to the workspace.
  Workers are numbered `w1`, `w2`, and so on in the order their sessions start, and run on omp's default model.
  `list_workers` lists the workers and their phases, `read_worker` reads one worker's whole last reply and the questions it waits on, and `message_worker` sends one a message as you would: a running worker gets it after its current turn, and a stopped one is resumed first.
- The **Sessions** tab lists each project as a collapsible group at the top, under the project's name: the coordinator first, with a **Coordinator** badge, then the workers in order, `w1` first.
  A worker's row reads as the title the coordinator gave it, beside its `w1`, `w2` badge, rather than the title omp generated for the session.
  A project's sessions leave the other groups, **Pinned** included, and the group lists them even in `/tmp`, which the sidebar otherwise hides.
  With a workspace selected, a project shows when it started there or one of its sessions runs or ran there.
  A search that matches a project's name keeps all its rows, and one that matches a worker's title keeps that worker.
- `#projects/<id>` opens one project: its coordinator's status with **Open coordinator**, a table of its workers in order with each one's phase and last reply, the updates still waiting for the coordinator, and its notes files.
  A worker's phase is working, asking while it waits on a question, idle, interrupted when it stopped without **End session**, or ended.
  Click a notes file to open it in the file dialog.
  **Rename** renames the project, and **Archive** archives it: its group leaves the sidebar, its sessions go back to the other groups, and its coordinator's tools refuse to start, list, read, or message workers.
- Workers report back on their own, so the coordinator never polls.
  Each time a worker finishes a turn, asks a question, or stops, the dashboard keeps an update for the coordinator; a worker's later finished turn replaces its earlier one, since the coordinator reads only its last reply.
  Once the coordinator runs and is idle, every waiting update reaches it as one message that starts with `[omp-agents] Project update.`, quoting each finished worker's last reply up to 2,000 characters.
  When omp does not take that message, the updates keep waiting, and the coordinator's next change of state, such as its next turn ending, sends them again.
  A worker you prompt yourself reports the same way when its turn finishes.
  A worker is told to end each turn on a report that stands alone, since the coordinator reads only its last reply, and to end its turn with a question it needs answered rather than ask it through the `ask` tool.
  A question a worker still asks through `ask` waits for you in the dashboard: the coordinator cannot answer it, and its update tells the coordinator to tell you.
- A project's notes live in `$XDG_DATA_HOME/omp-agents/projects/<id>/`, `~/.local/share/omp-agents/projects/<id>/` by default, outside every repository, so every worktree the project works in shares them.
  A new project starts with `README.md`, which holds the goal from the first message and links the others, `testing.md` for how to build, run, and test the work, `preferences.md` for how you want it done, and `research.md` for what agents found out, with sources.
  Every session of the project is told to read `README.md` first and to record there what lasts.
  The coordinator may edit and write only these notes: its `edit` and `write` calls outside them, and calls whose files the extension cannot tell, are refused, and it is told to start a worker instead.
  Its `local://` and `artifact://` scratch files are allowed.
  A subagent that runs in a project session's own session, such as an advisor, has its role and its limit; one with a session of its own, such as a `task` subagent, has neither.
- The role text and that limit come from the omp extension `~/.omp/agent/extensions/projects.ts`, which `bun run omp-template` installs.
  When it is not installed, the dashboard loads this repository's copy with `-e` for each project session, so a project works either way.
  The extension adds the session's role and the notes' place to every prompt, so they survive compaction.
- **Resume** keeps a project's session in its project: a resumed coordinator gets its tools back, and the updates that waited while it was stopped reach it once it is idle.
  Resuming it with `omp --resume` in a terminal gives it the role text, when the extension is installed, but no coordinator tools, since only the dashboard serves them.
  A `/move` or an edited prompt, which gives a session a new id, keeps it in its project, and a fork of a project's session belongs to no project.
- The server keeps the projects and their waiting updates in `projects.json` beside its access token, so no update is lost while the coordinator is stopped or the dashboard restarts.
  Quitting the dashboard stops its sessions without telling any coordinator.
- This first version has limits.
  The coordinator cannot answer a worker's question; only you can, in the dashboard.
  No tool ends a worker, so end one yourself with **End session**.
  The coordinator's limit covers its `edit` and `write` calls, not its shell commands.
  **Archive** cannot be undone, and an archived project's workers still report to its coordinator, which can no longer act on what they say.

## Settings

- **Settings** is the last sidebar tab, after **Calendar**.
  It stays selected while Settings is open, including through a session's **Workspace settings** menu item, a direct link, or the Settings shortcut.
  Select **Sessions** to return to the existing panes.
  The sidebar lists seven sections in two groups.
  **General** holds **Analytics**, **Preferences**, **Integrations**, and **Workspaces**, which are the same whatever the workspace.
  **This workspace** holds **Models**, **Files**, and **Worktrees**, which show omp's config and files as a session in the chosen workspace loads them; only these sections show the workspace picker.
  It opens on **Analytics**, and the header names the open section.
  Switching sections keeps an unsaved edit, and the selected section stays when you change workspace.
- **Analytics** shows request usage for the last 24 hours.
  Choose **24h**, **7d**, **30d**, **90d**, or **All** to change the range.
  Each range's last result is cached in your browser, so switching back, reopening the page, or reloading shows it while a fresh read runs.
  A failed refresh keeps the cached result and shows the error.
  Refreshes run only while **Analytics** is open, every two seconds during indexing and every 30 seconds otherwise.
  While a range with no cached result loads, the previous range's numbers remain visible but dimmed.
  It shows tokens, estimated cost, requests, cache hit rate, and a chart of token usage over time.
  The cost is omp's API-equivalent list price, not what your subscription bills.
  The chart stacks token usage by the provider that handled each request, with a fixed color and a legend entry for each provider.
  Hover or tap a time bucket to see its total and each provider's tokens, estimated cost, and requests.
  Focus the chart and use Left or Right to move between buckets; Escape closes the details.
  **View bucket data** shows the same numbers in a table, including empty buckets and requests that recorded no tokens.
  The **24h** chart labels local hours; daily charts label UTC dates.
  Models and workspaces are ordered by tokens, followed by the token split among main agents, subagents, and advisors, and by tool calls.
  The top 20 sessions include their subagents' usage; select a session to open it.
  omp keeps the usage of a session whose transcript you deleted, so it stays listed as **Deleted session**, without a link.
  It covers every session whatever workspace the header picks.
  omp indexes session files when you first open **Analytics** and updates the tab while indexing continues.
  New requests appear as omp syncs them, including requests from sessions started outside the dashboard.
- **Worktrees** lists every Git worktree in repositories where a session ran, and a path you enter lists that repository too.
  Each row shows the branch and path, the last time an omp session file in that checkout changed, the last commit, approximate disk use, and tracked or untracked changes.
  No omp session reads as no omp session, not as unused.
  **Delete** asks before it removes a linked worktree or forgets a registration whose directory is already gone.
  It keeps the branch and session transcripts.
  It refuses the main checkout, a locked checkout, unsaved changes, a nested repository, a checkout this dashboard or a live session is using, and a checkout whose subagent locations are unknown.
  Ignored files such as dependencies and `.env` are deleted with the checkout, and the confirmation names them.
  A detached commit that no branch contains is named before its registration can be removed.
  The page cannot see every shell or editor, so close other tools using a checkout before you delete it.
  Disk use is approximate, and removing a checkout may free less than the number shown.
- **Models** shows which model omp uses for each role (`default`, `slow`, `plan`, `advisor`, `vision`, `smol`, `commit`, `tiny`, `task`) and the fallbacks that omp tries after that model, in order.
  A role without its own chain says that it uses the `default` role's chain.
  Chains keyed by a model or a `provider/*` wildcard appear in their own table, and the `modelProviderOrder` follows.
  **Retry and fallback**, last on the page, lists the `retry.*` settings with omp's defaults filled in, for example `usageAwareFallback`, `usageReservePct`, and `usageReservePolicy`.
  Hover a retry setting to see its config key.
- Every part of the routing has an **Edit** button.
  On a role, pick its model and thinking level from the models that `omp models` lists, then add, remove, or reorder its fallbacks.
  Save writes the change to your `~/.omp/agent/config.yml` and leaves every other key as it was.
  A role that walks the `default` chain keeps doing so until you change its fallbacks.
  Removing every fallback of a role removes its own chain, so it walks the `default` chain again.
  The retry settings and the provider order save the same way.
  A workspace's `.omp/config.yml` still overrides what you save there.
- The **Files** section lists the files that omp reads: context files such as `AGENTS.md`, the `SYSTEM.md` and `APPEND_SYSTEM.md` prompt files, `config.yml`, agents, commands, rules, skills, and hooks.
  Select a file to read its content, and choose **Edit** to change it in place (**Create** for a file marked `missing`).
  Save with the button or with Cmd+S. If the file changed on disk after the page read it, the save is refused and your edits stay in the editor, so you can copy them before you load the file from disk.
  A `.yml`, `.yaml`, or `.json` file must parse before it saves, and a settings file must hold a mapping.
  `~/.omp/agent/AGENTS.md` and `~/.omp/agent/config.yml` appear even before they exist, marked `missing`.
  If omp cannot load `config.yml`, **Models** shows omp's error and **Files** still lists the files, so you can fix the broken file there.
  Files from installed plugins and omp's bundled rules are left out.
- **Preferences** holds the dashboard's own choices, saved in the browser's localStorage, not in omp's files.
  **Theme**: **System** follows the computer's light or dark setting, and **Light** and **Dark** pin one; it applies at once and does not change omp's terminal theme.
  **Transcript**: **Show tool calls** and **Show thinking** are the same choices as their shortcuts.
  **New sessions** pins a skill.
  Every session that you start from the dashboard, from the new-session draft or from a quick action on a pull request, a Linear issue, or a todo, then sends its first message through that skill.
  The picker lists the skills of the workspace that Settings opened on, and says which, or your own skills with **User files only**.
  Choose **None** to unpin.
- **Integrations** connects omp to Linear and Slack and the dashboard to Google Calendar; see [Integrations](#integrations).
- **Workspaces** lists the directories that the sidebar's workspace picker and the directory pickers offer.
  Type a path in **Directory** and choose **Add workspace** to offer a directory no session ran in yet; `~` works, and a path that is not a directory shows an error.
  **Hide** drops a workspace and its sessions from the pickers, the session lists and counts, and session search, as for `/tmp`; a direct session link still opens them.
  Hidden workspaces list under **Hidden**, and **Show** offers one again.
  The server keeps the list in `workspaces.json` beside its access token, so every browser tab and the desktop app show the same workspaces.
- **Settings** opens on the workspace of the session that you had open, so it includes that workspace's project files and its `.omp/config.yml` overrides.
  With no session open, it shows user files only.
  Use the workspace picker in the header of a Workspace section to choose another directory that a session ran in, or **User files only**.
  Selecting the active **Settings** sidebar tab keeps the section and the workspace you chose.
  A session's **Workspace settings** opens **Models** on that session's workspace.
  The page is in the URL hash, `#settings/<section>` or `#settings/<section>/<encoded directory>`, such as `#settings/integrations`; `#settings` opens **Analytics**.
  After each save the page shows the settings as omp loads them from disk.

## Notifications

- The bell in the sidebar header, between the command menu and the keyboard shortcuts, lists what waits on you, newest first, and its badge counts the notices you have not read, up to `9+`.
- Three sources feed it.
  - **GitHub**: a pull request on the Pull requests page whose move is yours, one notice per move: **Review requested**, **Ready to merge**, **Checks failed**, **Conflicts to resolve**, or **Comments to address**.
    A pull request that a running session works on, or whose session asks you something, is not one, and its notice goes once the pull request leaves the move.
    Every two minutes while a page is open, and as soon as a page opens after none was, the server reads the pull requests of the workspaces that the Pull requests page covers.
  - **Slack**: a message from someone else in a direct or group conversation you have not answered since, one notice per conversation, and each mention of you in a channel, from the last three days.
    It needs the Slack sign-in of **Settings › Integrations**, and the server checks it with the pull requests.
  - **Updates**: a newer omp release or a newer model, checked at startup, every six hours, and after each update.
    - A newer omp release than the one installed, on the channel that omp's `update.channel` setting picks.
      Turning off omp's `startup.checkUpdate` setting turns this check off too.
    - A newer Claude or OpenAI model than one that your model roles or fallback chains name, from the same provider and the same line, such as Claude Opus 5.5 to Claude Opus 5.6.
      Only models that `omp models` lists on a connected provider count, and dated snapshots are left out.
- **All**, **GitHub**, **Slack**, and **Updates** filter the list, each with its count of unread notices.
  Unread notices list under **New** with a blue dot, and read ones under **Earlier**.
- A notice you open is read: a pull request's opens its details on the Pull requests page, and a Slack message's opens it in Slack in a new tab.
  Selecting an update's notice marks it read.
  The check mark in the header marks every notice in the filter read.
- Each pull request notice offers the move's quick action, such as **Review** or **Fix CI**, which starts a session on it and opens its page, or **Merge on GitHub** for one ready to merge.
- A notice that no page has shown yet shows as a toast at the bottom right; closing it marks it seen, so it does not show as a toast again in any tab or after a reload.
  A pull request's or Slack message's toast shows only within 15 minutes of its news, closes after a few seconds, and **Open** opens what it is about.
  An update's toast stays until you dismiss it.
- **Update**, on the toast or in the bell, runs the update; the notice shows its progress, then what changed or why it failed, and a failed update can run again.
  - For omp, it runs `omp update`, which installs the newest release.
    Restart omp-agents to load it, since the running server keeps the omp it started with.
    An install that `omp update` leaves older than the notice's release, such as one that Nix manages, reports as failed with omp's last line of output.
  - For a model, it puts the new model in place of the old one in every role and fallback chain of `~/.omp/agent/config.yml` that names it, and keeps each role's thinking level, as **Settings › Models** would save it.
    A chain keyed by the old model keeps its key, and a workspace's `.omp/config.yml` stays as it was.
- **×** clears a notice from the bell.
  A cleared update comes back with a newer version, a cleared pull request notice when the pull request comes back to the move after a while, and a cleared Slack notice with a newer message.
- The server keeps which notices were seen, read, and cleared in `notices.json` beside its access token.

## Keyboard shortcuts

The shortcuts follow Cursor where the browser allows it, with web-app navigation keys for the Pull requests page, the todo list, and other dashboard pages.
Cmd stands for Command on macOS and Ctrl on Linux and Windows.
Alt is Option on macOS.

| Key | Where | Action |
| --- | --- | --- |
| Cmd+Shift+Backspace | Composer | Stop the running turn |
| Cmd+Enter | Composer | Steer the running turn immediately; on an empty composer, deliver a pending steer now |
| Shift+Tab | Composer | Cycle the thinking level |
| ↑ | Empty composer | Move the last queued message back into the composer |
| Cmd+K | Anywhere | Open the command menu |
| Cmd+Shift+O | Anywhere | Start a new session |
| Cmd+Shift+X | Anywhere | End the focused session |
| Cmd+[ | Anywhere | Open the previous session in the sidebar |
| Cmd+] | Anywhere | Open the next session in the sidebar |
| Cmd+Alt+/ | Anywhere | Choose the session's model |
| Cmd+Alt+P | Anywhere | Choose the session's working directory |
| Cmd+E | Anywhere | Expand or collapse tool calls |
| Cmd+Shift+E | Anywhere | Show or hide tool calls |
| Alt+T | Anywhere | Show or hide thinking |
| Cmd+B | Anywhere | Show or hide the sessions sidebar |
| Cmd+Alt+B | Anywhere | Show or hide the session details sidebar |
| Ctrl+\` | Anywhere, the terminal too, on every platform | Show or hide the terminal |
| Esc | Maximized pane | Restore the split |
| ? | Outside text fields | Show keyboard shortcuts |
| / / Cmd+I | Outside text fields / anywhere | Focus the composer |
| Cmd+1 | Anywhere | Go to Pull requests |
| Cmd+2 | Anywhere | Go to your Linear tickets, when connected |
| C | Outside text fields, except on the Todo page | Create a Linear ticket, when connected |
| Cmd+3 | Anywhere | Go to the sessions |
| Cmd+4 | Anywhere | Go to your todo list |
| Cmd+5 | Anywhere | Go to your calendar |
| Cmd+6 | Anywhere | Open or close settings |
| G then R | Outside text fields | Go to your routines |
| G then P | Outside text fields | Go to your projects |
| G then W | Outside text fields | Choose the sidebar's workspace |
| ↓ | Pull requests page, outside text fields | Move to the next pull request, or show its details while one shows |
| ↑ | Pull requests page, outside text fields | Move to the previous pull request, or show its details while one shows |
| O | Pull requests page, outside text fields | Open the pull request on GitHub |
| . | Pull requests page, outside text fields | Open the pull request's quick actions |
| E | Pull requests page, outside text fields | Give the pull request's next move to an agent |
| / | Todo page, outside text fields | Search the todos |
| ↓ / ↑ | Todo page, outside text fields | Focus the next or previous todo, or open it while a todo is open |
| X | Todo page, outside text fields | Mark the focused or open todo Done, or a closed one Todo again |
| S | Todo page, outside text fields | Change the focused or open todo's status |
| P | Todo page, outside text fields | Change the focused or open todo's priority |
| A | Todo page, outside text fields | Change the focused or open todo's assignee |
| Shift+D | Todo page, outside text fields | Change the focused or open todo's due day |
| C | Todo page, outside text fields | Add a todo to the Todo group |
| Esc | Todo page, outside text fields | Close the open todo |
| Alt+Shift+↑ / Alt+Shift+↓ | Todo page or Pull requests page | Move the focused todo, or the Pull requests page's focused pull request, section, or repository, up or down |
| ↓ / ↑ | Changes page or a pull request's **Code** tab, outside text fields | Open the next or previous changed file |

- Press `?` outside a text field, or click the keyboard button in the sidebar header, to list the keyboard shortcuts.
  Hovering a button that has a shortcut shows its keys in the button's tooltip: the sidebar header's buttons and tabs, the workspace, model, directory, and thinking pickers, **New session**, **End session**, the composer's Stop and **Send now** buttons, a queued row's **Send now** and **Edit**, a maximized pane's restore button, and the open todo's ↑, ↓, and **×**.
- Cmd+1 through Cmd+5 select the dashboard's tabs, even while typing; they replace the browser's tab selection when the dashboard handles them.
  The numbers stay fixed when Tickets is hidden without a Linear connection; Cmd+2 then keeps its browser behavior.
  Cmd with T, W, N, L, R, D, Q, O, P, S, Tab, or another digit keeps its browser behavior.
  Single keys and the G pairs work only while no text field has focus, so they never take what you type.
  For a pair, press G, then the second key within 1.5 seconds.
- In the composer, Enter queues a follow-up while a turn runs, and Cmd+Enter steers it immediately.
  Esc leaves the composer; Cmd+Shift+Backspace interrupts the turn.
  ↑ moves the last queued message back only while the composer is empty, as ↑ edits your last message in Slack.
  On a focused queued row, Cmd+Enter sends it now, Enter or F2 edits it, and Delete removes it.
  With a draft, ↑ moves the caret as usual.
- Cmd+K opens the command menu, which searches every running and past session, in every workspace, by title, directory, pull request, or Linear issue, and the page's commands, such as **Go to pull requests** or **Toggle sessions sidebar**.
  What you type also searches your todos, closed ones too, the Linear tickets assigned to you once Linear is connected, and the open pull requests of the sidebar's workspace, each under its own heading; each must hold every word typed, in any order.
  With nothing typed they list only under **Suggestions**, once you use one often enough.
  A todo opens beside its list on the Todo page, a ticket opens its details, and a pull request opens its details on the Pull requests page; Cmd+Enter opens a ticket in Linear and a pull request on GitHub.
  **In conversations**, under those, lists the sessions whose prompts or replies hold every word typed, up to 30, the latest active first, each by the latest such message and how many match; tool output and thinking are not searched.
  Enter opens the session scrolled to that message, and Cmd+Enter opens it in a split.
  The first search after the dashboard starts reads every saved transcript, which takes about a second.
  The search button in the sidebar header, immediately before the keyboard button, opens it too.
  With nothing typed, **Suggestions** lists the five entries you use most, by how often and how lately, then **Running**, **Commands**, and **Past**.
  What you type ranks every match by how well it matches and how much you use it, and the menu remembers that in this browser.
  Enter runs the highlighted entry's main action, which opens a session in the focused pane, and Cmd+Enter runs its second, which opens a session in a split.
  A session from another workspace switches the sidebar to that workspace.
  Cmd+K inside the menu lists every action of the highlighted entry, as the session row's menu does, and you can search them; Cmd+Shift+P pins or unpins a session, Cmd+Shift+C copies its path, and Cmd+Shift+X ends it, without opening that list.
  **Choose workspace…** switches the sidebar's workspace, and **Create todo** asks for a todo's title; Esc or Backspace in the empty field goes back.
  The bar at the bottom names where you are, what Enter does, and **Actions**, which opens the same list as Cmd+K.
  Esc closes the action list, then goes back, then clears what you typed, then closes the menu.
  Whatever you type also offers **Create todo**, last, which adds it at the end of **All**, with no category.
  You stay on the page you were on.
  The title can end with a due day or a `#category`, as in [Todo list](#todo-list).
  With Linear connected, it also offers **Create ticket**, which opens the new-ticket dialog with what you typed as the title; see [Linear tickets](#linear-tickets).
  Cmd+[ and Cmd+] walk the sidebar's list, pinned sessions, then idle ones, then running ones, then interrupted ones, then past ones, in the focused pane, skipping the rows that the sidebar's search hides.
  From a subagent they step from its session's row.
- Cmd+Shift+O opens the new-session draft, as **New session** at the top of the session list does.
  Cmd+Shift+X ends the focused session, as **End session** in its header does, with no confirmation; **Resume** continues it from the past sessions.
  It does nothing in a subagent, a read-only room, or a past session.
  `/` or Cmd+I puts the cursor in the focused pane's composer.
- Cmd+Alt+/ opens the model picker, and Shift+Tab in a composer moves to the next thinking level, in sessions that the dashboard started and in the new-session draft.
  Cmd+Alt+P (Option+Cmd+P on macOS) opens the directory picker in the new-session draft and, between turns, in sessions that the dashboard started.
  Cmd+E expands or collapses every tool group.
  Cmd+Shift+E shows or hides the tool rows in those groups, and Alt+T (Option+T on macOS) shows or hides the thinking text.
  Both stay as you set them in this browser.
- Cmd+1 opens the Pull requests page, and Cmd+2 opens Tickets when connected to Linear; C then opens the new-ticket dialog from any page.
  Cmd+3 goes back from the Pull requests page, the todo list, the calendar, the routines, Settings, or the new-session draft to the panes.
  Cmd+4 opens the **Todo** page, Cmd+5 the **Calendar** page, G then R the **Routines** page, and G then P the **Projects** page.
  Cmd+6 opens Settings, where the model roles and the integrations live, and closes it again.
  G then W opens the workspace picker with its search field focused.
- Session shortcuts act on the focused pane.
  The dashboard does not read `~/.omp/agent/keybindings.yml`.

## Desktop app

`bun run desktop` shows the dashboard in its own window; see the [README](../README.md#desktop-app) to start it.

- The window is the same page as a browser tab, on the same address, `http://127.0.0.1:<port>`.
  It keeps its own localStorage, so folded sections, the sidebar widths, the theme, and the pinned skill start fresh in the window and stay apart from a browser's.
- At launch, the app asks the port for the dashboard's sign-in.
  When an omp-agents server answers, the window uses it, and quitting the app leaves it running.
  When nothing listens, the app starts the server from its checkout and stops it when you quit.
  When something else answers, the window says that the port is taken, with **Retry**.
  When the server that the app started stops on its own, or fails to start, the window shows the end of its output, with **Retry**.
  When the dashboard does not load, for example on a reload after the server it used stopped, the window says so, with **Retry**.
- On macOS, closing the window hides it: the server, the sessions it started, and its Collab guests keep running.
  Click the app in the Dock, or run `bun run desktop` again, to show it.
  Cmd+Q quits the app; when the app started the server, it waits for the server to end its sessions first, which then show under **interrupted** at the next start.
  Off macOS, closing the window quits.
- On macOS, **omp agents › Open at Login** starts the app, and with it the server, when you log in.
  It carries `PATH`, `PORT`, `XDG_CONFIG_HOME`, `OMP_PACKAGE_DIR`, and `PI_CODING_AGENT_DIR` from the environment you ticked it in, since an app started at login gets no shell environment; tick it off and on again after one of them changes.
- Every link to another site opens in the default browser, and so does an integration's sign-in page.
  The window never leaves the dashboard.
- Cmd+W closes the window, Cmd+R reloads it, Cmd+Q quits, Cmd+M minimizes, and Cmd+0, Cmd++, and Cmd+- set the zoom.
  The menu takes none of the dashboard's own shortcuts.
  Right-click in a text field for cut, copy, paste, and spelling suggestions.
- The window remembers its size and position.
- The window title follows what the page shows, and a browser tab's title does too: the focused session's name, a subagent's name ahead of its session's, `Pull requests`, `Tickets` or the open ticket's identifier, `Todo`, `Settings`, or `New session`, then `omp agents`.
  A session without a name reads as its workspace, and nothing open reads `omp agents`.
- The Dock, the menu bar, and Cmd+Tab show `omp agents` and the dashboard's icon, not Electron's.
- Alt+Shift+Cmd+T, from any app, brings the window up with the command menu's **Create todo** open, so you can type a title and press Enter to create a todo.
  When another app holds the keys, the app logs so and the shortcut does nothing.
- The Dock icon's badge counts the top-level todos left to do, as **All** does, and goes away at none.

## Limitations

In a terminal session, the dashboard cannot run omp's built-in `/` commands or the `!` shell shortcut: Collab accepts guest prompts, not host-side TUI commands.
No session runs the `$` Python shortcut from the dashboard, and only the omp terminal runs `!!`.
The composer says so under a draft that starts with one of them and does not send it, instead of sending literal text to the agent.
Run them in the omp terminal.
