# Sessions sidebar

- The content header and both sidebar header rows are 48 px tall at the default font size, each with a hairline under it.
- The sidebar's tab bar shows **Pull requests**, **Tickets**, **Bots**, **Sessions**, and **Todo**.
  **Notes**, **Calendar**, and **Email** are buttons in the header, right after the command menu button, between two dividers; each opens its page and shows its list in the sidebar, and the open one's button stays pressed.
  The **Bots** tab lists your Bots, which the **Sessions** tab does not; see [Bots](bots.md).
- The dot before each session shows when it waits on you.
  A running turn shows no dot, blue means the agent is idle after finishing a turn, and amber means a question waits for an answer.
- Under **All workspaces**, a session row with a title shows a badge that names its workspace, the last segment of the workspace's directory, on the right before its age.
  With one workspace picked, the rows show no badge.
  A row without a title shows its directory's name as its label, and the badge only when it runs in a linked worktree, whose name is not its workspace's.
- The workspace picker in the sidebar header shows only the running, idle, interrupted, and past sessions from one workspace.
  A workspace is a repository's main checkout, or a directory outside git: a session in a linked git worktree, such as `~/code/yampa-review-triage-3935ff7b`, counts in its repository's workspace, `~/code/yampa`, and still runs in its worktree.
  A session whose worktree was removed counts in the repository whose main checkout's path, followed by `-`, starts its directory, such as `~/code/yampa-wt/fix` in `~/code/yampa`, else in the only repository whose main checkout has its directory's name, such as Codex's `~/.codex/worktrees/f5e7/yampa`.
  The picker lists the workspaces that a live or saved session ran in, live sessions' first, then the ones added in **Settings › Workspaces**, except temporary directories and hidden workspaces.
  The session counts then count that workspace's sessions only, such as `2 running` and `9 past`.
  Picking a workspace also opens its most recently started running session in the focused pane, unless that pane already shows a session from the workspace or a page such as a pull request, Settings, or the new-session draft covers the panes.
  Choose **All workspaces** to list every session again.
  The app keeps the choice.
  If no session from the saved workspace is left, the sidebar lists every session.
- **New session** at the top of the **Sessions** tab opens the new-session draft, in the selected workspace when there is one, and stays highlighted while the draft is open.
  It shows its key, Cmd+N, on its right.
- The search field under it narrows every group to the sessions whose title or working directory holds every word typed, in any order and any case, within the selected workspace.
  A group left without a match hides, and `No sessions match` shows when none is left; Esc clears the field.
  While empty, it shows its key, Cmd+F, on its right.
  Cmd+F puts the cursor in it while the **Sessions** tab shows; elsewhere, and while the sidebar is hidden, Cmd+F does nothing.
  Cmd+K opens the command menu, which searches every workspace instead.
- Sessions in `/tmp`, `/private/tmp`, or macOS's temp folders under `/var/folders` (where `mktemp -d` puts its directories), including their subdirectories, are hidden from the workspace pickers, session lists and counts, and session search.
  Starting or opening one does not replace the saved workspace.
  Their saved transcripts remain available through a direct session link.
- A workspace hidden in **Settings › Workspaces** is left out the same way, with the sessions of its linked worktrees, but only its own directory: sessions in a directory inside it stay listed.
- **Pin** in a row's menu moves the session to the **Pinned** group at the top of the list, and **Unpin** moves it back.
  The group lists pinned running sessions first, then pinned past ones, interrupted ones first, and shows only while it has a row.
  A pinned session stays pinned when it ends, is resumed, or is interrupted, and an interrupted one says `interrupted` after its title.
  The selected workspace applies to the group too.
  The server keeps the pins in `pins.json` beside its access token, by session id, so every window of the app shows the same ones.
  Pins that an older version kept in the page move to the server the first time its page connects.
- A live session whose turn ended, the blue dot, leaves **Running** for the **Idle** group above it, and moves back when its next turn starts.
  A session waiting on a question stays under **Running**, and a pinned session stays under **Pinned** whatever its state.
  The group shows only while it has a row.
- Click the **Pinned**, **Idle**, **Running**, **Interrupted**, or **Past** group label to collapse or expand its rows.
  The app keeps each group's choice across workspaces, navigation, and reloads, even while the group has no rows.
- The past sessions list every saved session that has no live host, newest first, with its title (else its first prompt) and how long ago it last changed; hover a row to see its working directory.
  Select one to read its transcript.
  The page cannot write to it until you resume it.
  A session that runs without publishing itself to the registry also appears in this list, and its transcript keeps updating while it runs.
  A one-shot `omp -p` or `omp --mode json` run, such as one another session starts to check something, stays out of the list, as task subagents do; resumed in a terminal or from the dashboard, it lists again.
  It is marked by `~/.omp/agent/extensions/headless-mark.ts`, which `bun run omp-template` installs, so runs from before it was installed still show.
  Claude Code's sessions in `~/.claude/projects` and Codex's in `~/.codex/sessions` list here too, among omp's.
  `CLAUDE_CONFIG_DIR` and `CODEX_HOME` move those directories as they move them for their agents.
  Their rows name their source first among their details, **Claude Code** or **Codex**; omp's rows name no source.
  Their transcripts keep updating while the agent writes, and the conversation search finds their prompts and replies.
  They are read-only: the pane's header reads `Read-only · Claude Code` or `Read-only · Codex`, and neither the header nor the row's menu offers **Resume** or **Fork from here**.
  An unknown or malformed line shows in the transcript as one warning with the line's start, alongside any text or tools the reader understood.
  Their subagents' sessions are left out of the list.
  The group lists the 100 newest at first, and **Show 100 more** at its end adds the next ones.
- The interrupted sessions, between the running and the past ones, list the sessions that the dashboard started and that stopped without **End session**: because omp exited on its own, or stopped while no dashboard ran, as when the computer restarted.
  A session the dashboard started keeps running when the dashboard server stops, restarts, or crashes, turn, background jobs, and subagents included, and the next server shows it live again, so it never shows here for that.
  It shows as working again when its turn ran, compacted, or waited on a background job's result as the server stopped.
  The group shows only while it has a row.
  Its **Resume all** button resumes every session it lists, under the selected workspace, as **Resume** does for one; a pane that shows one of them then shows it live.
  A session that was working when it stopped, or waiting on a question, also gets the prompt `continue`, so it picks its turn back up; an idle one waits for your next message.
  The notices bell's **Sessions** tab lists those that stopped mid-turn, and its **Continue all** resumes them the same way; see [Notifications](notifications.md).
  When some fail to start, a note under the group label names how many and the first reason, until **Dismiss**.
  **Move to past** in a row's menu moves it to the past sessions.
  A session that you end, resume, or move leaves the group.
  The server keeps the list in `interrupted.json` beside its access token, so it survives a restart.
  Sessions started in a terminal keep running when the dashboard stops too, and never show here.
- The sidebar list fades at its edges only after you scroll it: the top fades once rows pass under the header, and the bottom fades while more rows sit below.
- Drag a sidebar's inner edge to resize it: the right edge of the sessions sidebar, or the left edge of the session details sidebar.
  With the edge focused, the arrow keys move it in steps (hold Shift for bigger steps), and Home and End jump to the narrowest and widest sizes.
  Double-click the edge to reset the width.
  Resize handles show no tooltip on hover or while dragging.
  The button at the outer corner of the sessions sidebar's header hides it: the sidebar slides shut and the button glides with its edge to the narrow strip it leaves, on the header's line, where a click shows it again.
  Both sidebars slide open and shut in about a quarter second, or at once when the system asks for reduced motion.
  The session details sidebar's button stays at the end of the top-right pane's header, whether the sidebar is shown or hidden, and leaves with the sidebar while panes sit side by side.
  Cmd+B (Ctrl+B on Linux and Windows) toggles the sessions sidebar, and Cmd+Alt+B the details sidebar, which shows the session's details on the panes and a Bot's on its page.
  Each sidebar's width, and whether it is hidden, is saved in the app.
- The left sidebar's session rows leave out the full working directory, the model, the /ship step, and the pull requests; hover the workspace in the pane header to see the directory, the composer shows the model, and the session details sidebar shows the pull requests.
- A strip along the bottom of the window, under both sidebars, shows how much quota is left on each plan that `omp usage` reports, the plans side by side: each plan's provider logo, from [svgl](https://svgl.app), then each window, for example `5h 66%  7d 68%` for Anthropic.
  Hover the logo to see the plan's name and account, and how many reset credits the plan holds with when the soonest one expires, such as `3 reset credits, next expires Oct 22.`; a reset credit, which omp redeems, clears a used-up window.
  A provider without a logo shows the plan's name instead.
  A window is named by its length plus its model tier (`7d fable`).
  Two limits that would share a name, like Cursor's monthly limits, show omp's label instead.
  Amber means less than 20% is left, and red means the window is used up, as omp reports it.
  Hover or focus a window to see omp's full limit name and when it resets.
  Next to the provider logo, before the windows, a plan with extra usage, the pay-as-you-go spend past its plan such as Claude's, shows the dollars spent and the cap, as `extra $12.40 / $50.00`; amber means less than 20% of the cap is left, and red means it is used up.
  A window omp meters in dollars, such as Cursor's `Other Models`, adds the dollars spent to its hover.
  The server runs `omp usage --json` every minute while a page is open, and once when a page opens after a minute with none.
- The strip's right side shows the machine's CPU, the percent of every core's time spent busy since the last read, the memory available, which macOS reads as `memory_pressure`'s free percentage of the physical memory, and the disk space free on the volume that holds your home directory.
  The strip reads them again every five seconds while the page is visible.
  Hover or focus the memory for its full reading.
  Hover or focus the disk space for that volume's percent used, a bar of it, and the space used, free, and in total.
- Hover or click the CPU for a popover that lists what every live session runs besides omp, read again every 5 seconds while it is open.
  Clicking the CPU while hover opened it, or pressing Enter on it, moves focus into the popover, so Tab reaches each **Stop**.
  The busiest session comes first, by the CPU of omp and its processes together, each named by its session name or else its folder.
  The CPU of a process is the share of one core it uses, so one process can show more than 100%; macOS reads it as an average that decays over the last minute.
  Each session starts with the CPU, memory, and process count of omp and its MCP servers, which end with the session and have no **Stop**.
  Below it come its jobs and services, biggest memory first.
  A job is a process group the session started, such as a dev server or a watcher, named by its command line; a service is a daemon that omp's project broker runs for the session, named by the daemon's name and command.
  Each row shows its CPU, its memory, how many processes it holds when more than one, **Shared with this project's sessions** for a broker daemon no session owns, such as omp's browser, and **Stops in N min** once the idle stop has a time for it.
  A shared service shows under each session of its project, and counts toward each one's CPU.
  **Stop** ends it at once: a job gets SIGTERM, then SIGKILL after 3 seconds, and a service is stopped through its broker.
  A process the session ran in a Docker container does not show, since Docker runs it outside the session's processes.
- The idle stop ends a job once its session has been idle, waiting on you or done with its turn, for the time **Stop idle processes** in [Settings](settings.md) names, 30 minutes by default, counted from when the session was last busy or from the job's start if that is later.
  A shared service stops once every live session of its project has been idle that long.
  Only the server that runs unattended work, the first one started, stops processes, so another server shows no **Stops in** time.
- When a session ends or its omp exits, the server stops the services it owned and the jobs it left running.
  A session started from the dashboard also has the rest of its processes ended when it ends, as before.
- **Terminal**, at the start of the strip's right side, shows or hides the [terminal](terminal.md).
