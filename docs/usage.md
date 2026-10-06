# Using omp-agents

The full reference for the dashboard's interface.
For installation, see the [README](../README.md).

Controls with a filled blue-to-violet gradient start or continue agent work.
They send prompts and suggested follow-ups, answer questions, run quick actions, resume or fork sessions, and run routines now.
Navigation, editing, scheduling toggles, Stop, and Delete keep their existing styles.

- [Sessions sidebar](#sessions-sidebar)
- [Session details sidebar](#session-details-sidebar)
- [Panes, splits, and links](#panes-splits-and-links)
- [Conversations](#conversations)
- [Composer](#composer)
- [Questions](#questions)
- [Starting, ending, resuming, and forking](#starting-ending-resuming-and-forking)
- [Pull requests and the inbox](#pull-requests-and-the-inbox)
- [Todo list](#todo-list)
- [Routines](#routines)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Desktop app](#desktop-app)
- [Limitations](#limitations)

## Sessions sidebar

- The dot before each session shows its state.
  Green means a turn is running, blue means the agent is idle after finishing a turn, and amber means a question waits for an answer.
- Under **All projects**, a session row with a title starts with a badge that names its project, the last segment of its working directory.
  With one project picked, the rows show no badge.
  A row without a title shows the project's name as its label, with no badge.
- The project picker in the sidebar header shows only the running, idle, interrupted, and past sessions from one working directory.
  It lists the directories that a live or saved session ran in, live sessions' directories first, except temporary directories.
  The session counts then count that directory's sessions only, such as `2 running` and `9 past`.
  Picking a project also opens its most recently started running session in the focused pane, unless that pane already shows a session from the project or a page such as the inbox, Settings, or the new-session draft is open.
  Choose **All projects** to list every session again.
  The choice is saved in the browser's localStorage.
  If no session from the saved directory is left, the sidebar lists every session.
- Sessions in `/tmp` or `/private/tmp`, including their subdirectories, are hidden from project and workspace pickers, session lists and counts, and session search.
  Starting or opening one does not replace the saved project.
  Their saved transcripts remain available through a direct session link.
- **Pin** in a row's menu moves the session to the **Pinned** group at the top of the list, and **Unpin** moves it back.
  The group lists pinned running sessions first, then pinned past ones, interrupted ones first, and shows only while it has a row.
  A pinned session stays pinned when it ends, is resumed, or is interrupted, and an interrupted one says `interrupted` after its title.
  The selected project applies to the group too.
  The browser's localStorage keeps the pins, by session id.
- A live session whose turn ended, the blue dot, leaves **Running** for the **Idle** group above it, and moves back when its next turn starts.
  A session waiting on a question stays under **Running**, and a pinned session stays under **Pinned** whatever its state.
  The group shows only while it has a row.
- Click the **Pinned**, **Idle**, **Running**, **Interrupted**, or **Past** group label to collapse or expand its rows.
  The browser's localStorage keeps each group's choice across tabs, projects, navigation, and reloads, even while the group has no rows.
- The past sessions list every saved session that has no live host, newest first, with its title (else its first prompt) and how long ago it last changed; hover a row to see its working directory.
  Select one to read its transcript.
  The page cannot write to it until you resume it.
  A session that runs without publishing itself to the registry also appears in this list, and its transcript keeps updating while it runs.
- The interrupted sessions, between the running and the past ones, list the sessions that the dashboard started and that stopped without **End session**: because the dashboard server stopped or crashed, which stops every session it started, or because omp exited on its own.
  The group shows only while it has a row.
  Its **Resume all** button resumes every session it lists, under the selected project, as **Resume** does for one; a pane that shows one of them then shows it live.
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
  Cmd+B (Ctrl+B on Linux and Windows) toggles the sessions sidebar, and Cmd+Shift+B the session details sidebar.
  Each sidebar's width, and whether it is hidden, is saved in the browser's localStorage.
- The left sidebar's session rows leave out the full working directory and the model; the pane header shows both.
- The bottom of the sidebar shows how much quota is left on each plan that `omp usage` reports, one line per plan: its provider's logo, from [svgl](https://svgl.app), then each window, for example `5h 66%  7d 68%` for Anthropic.
  Hover the logo to see the plan's name and account.
  A provider without a logo shows the plan's name instead.
  A window is named by its length plus its model tier (`7d fable`).
  Two limits that would share a name, like Cursor's monthly limits, show omp's label instead.
  Amber means less than 20% is left, and red means none.
  Hover or focus a window to see omp's full limit name and when it resets.
  The server runs `omp usage --json` at startup and every minute after that.

## Session details sidebar

- The right sidebar shows what the focused pane's agent planned, changed, spawned, and captured: a live session, one of its subagents, or a past session, each from its own transcript file.
  It hides for the inbox, the tickets, **Settings**, and the new-session page, and while two or more panes sit side by side, which leaves no single pane to follow; a maximized pane brings it back.
- Tabs split it: **Plan**, **Files**, **Agents** for a live session or subagent, and **Media**.
  Each tab shows its icon and how many items it holds, such as `3` changed files; hover a tab for its name.
  The sidebar remembers the tab you chose, for every view; a past session, which has no **Agents** tab, shows **Plan** instead.
- **Plan** shows the agent's latest todo list, by phase, with how many of each phase's tasks are done (`2/5`).
  The task in progress is highlighted, a completed task is struck through, an abandoned one is dimmed, and a blocked one has an amber mark.
  The latest list wins, whether the agent's `todo` call wrote it or you edited it in omp's terminal.
- Below the todo list, **Plan** shows the plan the agent wrote, rendered as markdown under its file name: the last file named like `*plan.md` that its `write` or `edit` calls changed, such as the `local://auth-plan.md` that omp's plan mode writes.
  Hover the file name for its full path.
  The text follows each change the agent makes to that file, and it goes away when the agent deletes it.
- **Files** lists the files the agent's `edit` and `write` calls changed, in the order it first touched them.
  Each row shows whether the session created, edited, or deleted the file, how many times it changed it, how long ago the last change was, and the lines added and removed, which the list's heading totals.
  A path inside the session's working directory shows relative to it.
  Click a file to unfold its changes under it, newest first: each with its kind, its time, its lines added and removed, and its diff as omp recorded it with line numbers.
  A write replaces the whole file and records no diff, so it shows how many lines it wrote instead.
  A write counts as creating the file when the session had not read or changed that path before, since omp does not record whether the file existed; a created file counts every line it wrote as added, and a later write over it counts none.
  A failed call, and a write to something other than a file, such as an `agent://` message, count for nothing.
- **Agents** lists the live session's main agent and then its subagents, each indented under the agent that spawned it, with its status dot, its type, and what it is doing.
  The agent the pane shows is highlighted.
  Click a row to open that agent in the pane, or Cmd-click (Ctrl-click on Linux and Windows) to open it in a split.
- **Media** shows the images that the agent's tools returned and those of its subagents at any depth, newest first: browser screenshots from `eval`, and image files that `read` opened.
  On a session that is every image of the session; on a subagent it is that subagent's and its own subagents'.
  Images you attached to your own prompts are left out, since the transcript shows them.
  Each thumbnail names the agent whose tool returned it and how long ago.
  Click one to see it large, with the tool and what the call said it did; the arrows, or the Left and Right keys, step to newer and older images.
  **Open agent** opens the live agent that took it, unless the pane already shows that agent, and the external-link button opens the image in a new tab.
  New images show up while the agents run.
- A tab with nothing to show says so.

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
  Select a row to return to them.

## Conversations

- Opening a live session or subagent puts the cursor in the focused pane's composer once it accepts messages, so you can type right away.
  A session that reconnects takes the cursor back the same way.
- The transcript fades at its top or bottom edge only while more of it lies past that edge, so a conversation that fits the pane shows no fade.
- Each tool call in a tool group shows an icon for its tool, such as a terminal for `bash`, a page for `read`, and a plug for an MCP tool; a tool without its own icon shows a wrench.
  The icon of a call that failed is red, and the group's heading counts the failures.
- A `task` tool call lists the subagents it spawned, by id, under its row: each one as it starts while the call runs, and every one once the call finishes.
  A tool group that spawned subagents stays open.
  In a live session or subagent, each id is a link with the subagent's status dot (green running, blue idle, hollow parked, red aborted); hover it for the subagent's type, status, and what it is doing.
  Click it to open the subagent, Cmd-click (Ctrl-click on Linux and Windows) to open it in a split, or middle-click to open it in a new tab.
  A subagent's own `task` calls link its subagents the same way.
  A past session's ids are not links, because the dashboard opens subagents only of a running session.
- A subagent's header starts with a back arrow that opens the session's main agent in the pane, or focuses the pane that already shows it.
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
- Every prompt has a copy button.
  Among the agent's messages, only the reply that ends each turn has one, not the messages it writes between tool calls.
  A turn still running shows none until it ends.
- A prompt that invoked a skill shows the skill as a pill with its name (`/skill:poteto-mode do X` reads **Poteto Mode** then `do X`), not the skill's text that omp sends the model.
  That covers skills sent from the dashboard, from omp's terminal, and to a subagent, in live and past sessions.
  Copy copies the prompt as typed.
  File commands show their expanded text, because omp records only that.
- A session's header shows its project, the last segment of its working directory (`~/code/webapp` reads `webapp`), and its model's label next to the logo of the org that makes it (`anthropic/claude-opus-5-5` reads `Opus 5.5` with the Anthropic logo).
  The label leaves out the provider, the vendor prefix, and a release date, joins version parts with dots, and puts a `:` suffix such as a thinking level in parentheses (`Sonnet 5.5 (high)`).
  For a router model such as `openrouter/moonshotai/kimi-k3`, the org is the one the id names.
  Hover either to see the full directory or model selector.
  The settings page labels models the same way.
  When a running session's directory is in a git checkout, the header also names the GitHub repository that `origin` points to, as a link to it, and the branch that the directory has checked out.
  The page reads the branch again whenever a turn starts or ends, so a session that switches branches shows the new one.
  Click the branch to copy its name; its icon turns into a check mark for a moment.
  The same works on the branch of an inbox row, of a pull request's sheet, and of a Linear issue's detail view.
- A live session's header shows no connection status.
  It says **Connecting…**, **Reconnecting…**, or **Disconnected** only while the pane is not live; the sidebar's status dot tells whether the session works, idles, or waits on a question.

## Composer

- While a turn runs, the composer sends the way omp's terminal does.
  Enter, or the send button (labeled **Steer**), steers the turn, and omp hands the message to the agent after the current tool call.
  Enter again on the empty composer stops that turn and delivers the steer now, instead of leaving it behind a long reply or tool call.
  It does nothing once the agent has already taken the steer, and a follow-up still waits.
  Ctrl+Enter (Cmd+Enter on macOS) sends a follow-up, which waits until the agent finishes its turn; the placeholder names the shortcut while a turn runs.
  An idle session takes either as a new prompt.
- Messages that wait on the turn show above the text field, each tagged **Steer** or **Follow-up**.
  Double-click a row, or press Enter on it, to move it back into the composer.
  Its **×** removes it. ↑ in the empty composer moves the last one back, the last steer before the last follow-up, as omp does.
  **Stop** and Esc interrupt the turn and move every waiting message back into the composer, as Esc does in omp's terminal, so nothing runs after an interrupt.
- When a turn ends, its reply can suggest what to send next: a `Suggestions:` line followed by numbered prompts, as its last lines.
  The starter kit's `APPEND_SYSTEM.md` asks omp to write one when the next moves are clear, up to three.
  The transcript leaves the block out of the reply, and so does its copy button; the composer lists the prompts under its buttons, numbered, while it is empty and nothing else waits on you: no turn runs and no question is open.
  Press a prompt's number to send it at once. ↓ moves a highlight into the list and ↑ back out; Enter sends the highlighted prompt, Tab puts it in the composer to edit first, and Esc drops the highlight.
  A click sends it too.
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
  Typing searches every connected model, and every word typed must appear in the model's selector, label, or name, in any order.
  Each provider's heading shows how much of its plan is used, by the tightest window of the account with the most left, since omp moves to that account; hover the number for that account's windows.
  The list contains models that the session's omp RPC process offers from providers you are connected to, the ones omp's `/login` marks as signed in or given a key.
  Models that omp finds without a login, such as Apple's on-device model or a local Ollama, stay out of the list.
  A login made in a terminal shows the next time the menu opens.
  Each row shows the logo of the org that makes the model, its label (`Opus 5.5`), and its id, muted, to tell apart models that share a label.
  Choosing a model, a context, or an effort closes the menu.
  While a model switch runs, Fast, Context, and Effort wait until omp reports the new model and its levels.
  Terminal sessions show their model and thinking level in the same place, but Collab has no frame that changes them, so make those changes in the terminal.
  Subagents have no pickers.
- The ring before the paperclip and the send button shows how full the session's context window is.
  It turns amber at 70% and red at 90%.
  Hover or focus it to see the token count and the window size, for example `Context 10% full: 95.6k of 1m tokens`.
  The numbers are the ones that omp's status line shows.
  Dashboard sessions report them after each turn and after each model or thinking change.
  Terminal sessions report them through Collab `state` frames.
- Type `/` to complete discovered file commands and `/skill:<name>` skills.
  Type `@` to find files in the selected session's working directory.
  Use arrow keys, Tab or Enter to insert a suggestion, and Esc to close the list.
  File suggestions follow Git ignore rules in Git repositories.
- Attach images to a session's prompt with the paperclip between the context ring and the send button, by dropping them on the composer, or by pasting them, such as a screenshot.
  They show as tiles above the text field until you send; hover a tile for its **×**.
  PNG, JPEG, GIF, and WebP are accepted, up to 32 MB per prompt; images past that stay out, and a note under the composer names them.
  A prompt can be images alone.
  Steers and follow-ups carry their images too.
  The new-session draft takes images for its first message.
  omp gives a subagent text only, so a subagent's composer has no paperclip.
- A prompt's images show above it in the transcript, in live and past sessions, including images sent from omp's terminal.
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

- To start a session, click **+** next to the session count.
  The page shows a new-session draft with the same composer as a running session, and the header names the directory that omp will run in.
  No omp process starts and no row appears in the sidebar until you send the first message, so leaving an empty draft leaves nothing running.
  The directory is the selected project's, else the open session's, else the newest live session's, else the newest past session's.
  To start in another directory, under **All projects** or not, pick it in the directory picker after the model picker.
  It lists the directories that sessions ran in, and **Use** takes any directory typed into its search field.
  The message you typed stays in the composer.
  Sending the first message starts omp there and sends it the message.
  The message stays in the composer while omp starts, and also if the start fails, with the error above it.
  When omp is ready, the dashboard opens the session in the focused pane.
  The draft is in the URL hash, `#new` or `#new/<encoded directory>`, and leaves the panes behind it, as **Settings** does.
  A session that you start or fork in another directory than the selected project switches the project picker to that directory, so the sidebar lists it.
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
- When the directory is in a git checkout, the draft's header names its GitHub repository and branch, and a branch picker sits after the directory picker.
  The picker lists the local branches, the checked-out one first, then the most recently committed to, each with where it would run: `here`, the worktree that has it checked out, or `new worktree`.
  Picking the checked-out branch keeps the directory as it is.
  Picking another branch runs omp in the worktree that has it checked out, or adds a worktree for it when none has.
  Type a name that no branch has to create that branch from the branch picked before it, as GitHub's branch menu does; a new branch always gets its own worktree.
  A new worktree goes beside the repository's main worktree, named after both with each run of characters other than letters, digits, `.`, `-`, and `_` turned into `-` (`~/code/webapp-fix-login` for `fix/login`).
  The header shows the directory omp will run in, marked `new worktree` when sending adds it.
  The worktree is added only when you send the first message, and a branch or worktree that git refuses shows git's reason above the composer.
- omp titles a session that the dashboard started from its first message, as it does in a terminal, within a few seconds and while the first turn still runs.
  omp's RPC mode titles no prompt by itself, so once omp holds a message of an untitled session, the dashboard sends it a bare `/rename`, which makes omp title the session from the conversation so far.
  Until the title arrives, the sidebar and the header show the project's name.
  A conversation of greetings or acknowledgements only, such as `hi`, stays untitled until a later message.
  omp counts that title as one that you set, as it counts a `/rename` in a terminal.
- A running session shows **End session** in its header, unless its room is read-only.
  **End session** stops its omp process: one that the dashboard started stops over its pipe, and a terminal session gets `SIGTERM`, as when its terminal closes, so its terminal returns to the shell.
  omp records the exit in the session file, and the session moves to the past sessions, where **Resume** continues it.
  Each pane that showed the session, or one of its subagents, moves to the next running session the sidebar lists, else the previous one, skipping sessions already open in a pane.
  With none left, the pane stays on the ended session.
- **Resume** in a past session's header starts omp on that session's file from the dashboard, as `omp --resume <session id>` does in a terminal.
  The pane then shows the live session, which carries on in the same file and moves to the running sessions.
  A session whose omp process exited mid-turn, for example because the dashboard that started it was stopped, resumes too: omp records the interrupted turn first, as it does in a terminal.
  If another omp process still writes the file, omp writes the resumed session's entries to a new file instead of mixing the two.
- Click **Fork from here** under a prompt or a turn's last reply to start a dashboard session that holds the conversation up to that point, as omp's `/branch` does.
  A fork from a prompt leaves that prompt out of the history and puts it in the composer, so you can edit and resend it.
  omp writes the fork to a new session file and does not change the original.
  A session whose omp process exited mid-turn cannot be forked until you resume it once, with **Resume** or in omp, because opening it would make omp append an abort record to the original.

## Pull requests and the inbox

- A session lists the pull requests it submitted or worked on as `#<number>` after its title in the sidebar, and in its header.
  In the sidebar, a session with several shows the first number and `+N` for the rest, for example `#6535 +2`; hover it to read them all, or find each in the row's menu.
  Its subagents' pull requests count as its own.
  A submission is a `gt submit` line (`<branch>: https://app.graphite.com/github/pr/<owner>/<repo>/<number> (created)` or `(updated)`) or the URL a `gh pr create` call printed, both from bash output, including bash run as a background job.
  A stack submit lists every PR it created or updated.
  Work is one of the session's own tool calls: `gh pr checkout`, `edit`, `comment`, `review`, `merge`, or `ready` with a PR number or URL; a `git push` whose output shows that it updated a PR's head branch; or an omp `pr://` read.
  A bare number belongs to the repository that `origin` names in the session's working directory, unless the command passes `-R` or `--repo`.
  A push links once the inbox has listed the PR that the branch heads, because only the inbox knows which branch heads which PR.
  A PR the session only quoted, listed with `gh pr list`, or looked up with `gh pr view` does not count.
  A PR that a session submitted counts as submitted, even when it also worked on it.
- In a session's header, a pull request's number opens its details in the inbox, the arrow after the number opens it on GitHub, and the Graphite logo after the arrow opens it on Graphite.
  Hover the number to see whether the session submitted it or worked on it.
- A session's header also lists the Linear issues it worked on by identifier, such as `ENG-2368`, after its pull requests, and its row's menu has **Open ENG-2368** for each.
  Both open the issue's details in the tickets page's main content (`#tickets/<identifier>`).
  An issue counts when the session or one of its subagents read it with omp's Linear tools (`get_issue`, `list_comments`), changed or opened it (`save_issue`), commented on it (`save_comment`), or names it in its `/ship` step.
  An issue that a `list_issues` search only listed does not count.
- Sessions that use `/ship` show their current workflow step in the sidebar and session header, for example `6/7 · Rebase`.
  Hover the badge to see the Linear issue.
  The steps are ticket, implementation, draft PR, thermonuclear review, ready gate, live review, and merged.
  During live review the badge names the active rebase, review-comment, or CI-fix work.
  omp writes each step to its session file; the dashboard reads those entries for running and past sessions and updates when the step changes.
  Other sessions have no workflow badge.
- Five tabs under the sidebar header, **Inbox**, **Tickets**, **Sessions**, **Todo**, and **Routines**, switch what the sidebar lists.
  Click a tab or use the left and right arrow keys while a tab has focus to switch pages.
  **Tickets** shows only once Linear is connected; see [Linear tickets](#linear-tickets).
  **Sessions** lists the running and past sessions, and **Todo** opens your own todo list, with its categories in the sidebar; see [Todo list](#todo-list).
  **Routines** opens the sessions that start on a schedule; see [Routines](#routines).
  When the sidebar is too narrow for every tab's icon, the tabs show their names alone.
  **Inbox** opens a pull request inbox like Graphite's, and the sidebar then lists the inbox's sections with their pull request counts, under each repository's name when there are several.
  The counts of the sections that wait on your move stand out: **Needs your review** in bold, and **Returned to you** in red.
  The **Inbox** tab counts the pull requests in those two sections, for the project that the sidebar's picker shows, and reads GitHub every minute on every page so the count stays current.
  Click a section in the sidebar to scroll the page to it and move focus there; a folded section unfolds.
  An `#inbox` address selects the Inbox tab.
  The inbox covers the GitHub repository of the project that the sidebar's picker shows, or under **All projects** every repository that a session ran in, one section per repository.
  A workspace's repository is the one its `origin` remote names.
  Each repository lists your open pull requests, your merges from the last seven days, and the open pull requests that ask you for a review.
  They sort into Graphite's sections: **Needs your review**, **Returned to you** (changes requested), **Approved**, **Waiting for review**, **Drafts**, and **Recently merged**.
  A row shows the branch, its place in a stack, the reviewers' pictures, the review decision when its section does not already say it, the number of unresolved review comments, the check rollup, and the sessions on it.
  A review asked of you also shows its author's picture and name; your own pull requests leave out your picture.
  The review decision shows on drafts and on reviews asked of you, since the other sections name it.
  Your own open pull request says **Ready to merge** instead when it is approved or needs no review, its checks passed or it has none, it has no conflicts, and no review thread waits for a resolution.
  When the inbox lists another pull request of its stack, the row shows its place from the bottom, such as `2/4`, and its tooltip names the branch it is stacked on; otherwise a row stacked on another branch names it, as in `on fix/base`.
  Within a section, a stack's pull requests sit together, top first, where its most recently updated one would, and a line joins each to the one below it.
  A row shows one session chip: a running session first, since one may be working on the pull request now, then one that submitted it, then one that worked on it.
  A submitter's chip is filled and a worker's chip is outlined, and a chip's tooltip says which it is.
  A running session's chip starts with the sidebar's status dot: green while it works, amber while it waits on a question, blue once its turn ended.
  `+N` after the chip lists every session on the pull request, each with whether it submitted or worked on it; choose one to open it.
  The comment count shows only when a conversation waits for a resolution.
  A pull request with more than 100 review conversations shows the count among the first 100 with a `+`, for example `12+`.
  The dot on a reviewer's picture shows where they stand: green approved, red requested changes, grey commented, and amber means a review from them is still requested.
  Hover an icon or a picture to read what it means.
  The lightning and link buttons show while you hover or focus the row, while a start on it runs, and after a link write on it, so its outcome stays readable.
  Click a repository or a section heading to fold it; the browser's localStorage keeps your choice across reloads.
  **Recently merged** starts folded, since it lists history rather than work, and stays unfolded once you unfold it.
  Click the title to show the pull request's details in a sheet that slides in from the right, without leaving the page; Esc, the close button, or a click outside the sheet closes it.
  Click a session to open it.
  The sheet opens on **Status**, what stands between the pull request and its merge: **Ready to merge**, a draft, merge conflicts, failed checks, requested changes, unresolved review threads, checks still running, the reviews it waits on, approvals, and passed checks, blockers first.
  A blocker that a quick action works on carries that action's button, such as **Resolve conflicts** next to the conflicts, and the header keeps the other actions.
  Then it shows the branch and the one it merges into, the lines added and removed, the description, folded after about 16 lines behind **Show more**, the head commit's checks (failing and pending ones listed, passing and skipped ones folded behind their counts), the unresolved review comments by file and line, the conversation of comments and reviews, and the changed files, with links to the pull request on GitHub and on Graphite.
  Each opening reads the pull request again; the server keeps its answer for 30 seconds.
  The dashboard reads GitHub through `gh` when it loads and every minute after, on every page, so the **Inbox** tab's count stays current.
  Reopening the inbox, even after a reload, shows the last inbox read for the chosen project at once; the header says when that inbox was read, and the browser's localStorage keeps the last one of each project.
  The server keeps each repository's answer for 30 seconds, and **Refresh** asks GitHub again at once.
- The inbox works from the keyboard, outside text fields.
  J and K move to the next and previous row, and Enter opens the focused row's sheet.
  While a sheet is open, J and K show the next and previous pull request in it.
  O opens the focused row's pull request, or the sheet's, on GitHub, and `.` opens the focused row's quick actions.
- `#inbox/<owner>/<repo>/<number>` opens the inbox at one pull request.
  It unfolds the row's repository and section, scrolls the row into view, highlights it, and opens the pull request's sheet.
  When the inbox does not list that pull request, a note says why, and the sheet still opens.
- The link button on an inbox row with sessions writes links to those sessions into the pull request's description on GitHub, through `gh`, so that the PR leads back to them.
  It writes only when you click it.
  The links sit between `<!-- omp-sessions -->` and `<!-- /omp-sessions -->`, before Cursor's `<!-- CURSOR_SUMMARY -->` block when the description has one, else at the end.
  Another click replaces that block rather than adding a second one.
  Each link is `http://127.0.0.1:<port>/#session/<session id>`, and the block says that the links open only on the machine that runs the dashboard.
  They carry no token, so they open the session in a browser that has signed in to the dashboard, and show the sign-in page elsewhere.
  The button's tooltip reports whether the description changed or why the write failed.
- An inbox row has a conflicts icon (a red merge symbol) when GitHub reports merge conflicts with the pull request's base branch.
  A lightning button on the row, and buttons in the pull request's sheet, start a new dashboard session in the background, in the repository's most recently used workspace, with a prompt that names the pull request and its branch.
  The inbox stays on screen, and the session shows at once as a chip with its status dot on the row and in the sheet of that pull request, before it has touched the pull request; click the chip to open the session (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  The chip stays while the session runs, after a reload too, so the row says whether an agent still works on the pull request.
  The session also shows in the sessions sidebar.
  Which actions show depends on the pull request: **Fix CI** on your own open pull request whose checks failed, **Resolve conflicts** on your own open pull request with merge conflicts, **Address comments** on your own open pull request with unresolved review threads or requested changes, **Review** on an open pull request that waits for your review, and **Thermonuclear review** on every open or draft pull request.
  **Thermonuclear review** runs the `thermonuclear-reviewer` agent on the pull request's diff.
  On your own pull request, the session then applies the valid findings on its branch, pushes them, and only after the push adds `- [x] Thermo-nuclear code quality review` to its description; on a pull request you review, it reports the findings in the session and changes nothing on GitHub.
  A merged pull request has none.
  The button waits while the session starts.
  When the start fails, a note at the top of the inbox, and in the sheet of that pull request, gives the reason until you dismiss it.

## Linear tickets

- The **Tickets** tab, or a `#tickets` address, opens the Linear issues assigned to you, as Linear's **My issues › Assigned** lists them.
  The sidebar then lists the workflow states with their issue counts; click one to scroll the page to it and move focus there, and a folded state unfolds.
- The page groups the issues by workflow state.
  **In Review** comes first, in the sidebar and on the page, with a green circle-dot icon.
  The other states follow Linear's order: triage, started (such as **In Progress**), unstarted (**Todo**), backlog, completed, and canceled.
  Duplicates count as canceled.
  Completed and canceled issues show only when they changed in the last seven days, like the inbox's recent merges.
  Within a state, issues sort by priority, urgent first and no priority last, then by the latest update.
- A row shows the priority, the identifier, the state, the title, the labels, the project, the due date when there is one, and how long ago the issue changed.
  Hover an icon to read what it means.
  Click a state's heading to fold it; the browser's localStorage keeps folded ones folded across reloads.
- Click a row to replace the tickets list with the issue's details in the main content.
  **Back to tickets** returns to the list with its folded states preserved.
  The detail view shows the title, the state, the priority, the assignee, the project, the due date, the labels, who opened the issue and when, the description, Linear's branch name for it, the links Linear keeps for it (such as its pull requests), and the comment threads, with a link to the issue on Linear.
  Each opening reads the issue again through Linear's `get_issue` and `list_comments` tools.
  Linear's issue mentions in the text become links.
  Its images show in place, its screen recordings play in a video player, and another embedded file becomes a link to download it.
  The dashboard's server fetches each of these files from Linear, so a video still plays and seeks after Linear's five-minute link to it expires.
- Once Linear has answered, each field under the issue's title is a button that changes the issue in Linear: the state, the priority, the assignee, the project, and the labels open a list to search and pick from, and the due date opens a date field with **Set** and **Clear**.
  Labels toggle, and their list stays open for several.
  A change shows at once and saves in turn after the ones before it.
  The tickets list reads Linear again after each save, so an issue you assign to someone else leaves it.
  When Linear refuses a change, the detail view says why and shows the issue as Linear has it.
  The lists come from the issue's team in Linear, read when you first open one, and the server keeps them for five minutes.
- `#tickets/<identifier>`, such as `#tickets/ENG-2368`, opens that issue's details directly, even when the tickets list does not include it or cannot load.
  **Back to tickets** opens the list from a direct link too.
- A lightning button on the row, and buttons in the issue's details, start a new dashboard session in the background, with a prompt that names the issue.
  The page stays on screen, and the session shows at once as a chip with its status dot on the issue's row and after the buttons in its details; click the chip to open the session (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  A row and the details show a chip for every running session that works on the issue, whether a quick action started it or it read or changed the issue with omp's Linear tools, so they say whether an agent still works on it, after a reload too.
  A row shows two chips at most.
  The session also shows in the sessions sidebar.
  A Linear issue names no repository, so the session starts where a new session would: in the sidebar project's workspace, or under **All projects** in the open session's workspace, else the newest session's.
  **Work on it**, on any open issue, implements the issue in a git worktree on Linear's branch for it, continuing a branch or pull request that exists already, then commits and reports without pushing.
  **Plan it**, on an issue that has not started yet (triage, backlog, or unstarted), reads the issue and the code and reports a plan without changing anything.
  A completed or canceled issue has none.
  The button waits while the session starts.
  When the start fails, a note above the issue's details or at the top of the list gives the reason, even when the issue itself cannot load, until you dismiss it.
  The inbox and the tickets page share that note: either page shows the last failed quick action, whether it ran on a pull request or an issue.
- The list of tickets is not tied to the sidebar's project.
  The page reads Linear when it opens and every minute after, and shows the last read at once on a reopen, even after a reload.
  The server keeps Linear's answer for 30 seconds, and **Refresh** asks again at once.
- The dashboard reads Linear through omp's Linear MCP server and its sign-in, so there is no key to set.
  Until omp is signed in to that server, the sidebar has no **Tickets** tab, G then T does nothing, and a `#tickets` address shows how to connect instead of the issues.
- To connect, open **Settings › Integrations** and choose **Connect Linear**.
  A new browser tab opens Linear's sign-in page; approve omp there, and the **Tickets** tab appears within a few seconds.
  The dashboard signs in the way omp's `/mcp reauth` does, saves the sign-in in omp's credentials, and adds Linear's MCP server, `https://mcp.linear.app/mcp`, to `~/.omp/agent/mcp.json` when omp has none, so new omp sessions can use Linear's tools too.
  Linear's page sends the browser back to `localhost:3000`, so that port must be free while you sign in.
  When Linear later refuses the sign-in, the tickets page says to run `/mcp reauth <name>` in omp; **Sign in again** in the settings does the same.

## Todo list

- The **Todo** tab, or a `#todo` address, opens todos of your own, not tied to a session or a project, in place of the panes.
  The sidebar then lists **All**, **Today**, **From agents**, and **Done**, then your categories, each with how many top-level todos are left to do in it.
  Click one to show its todos alone; `#todo/today`, `#todo/agents`, `#todo/done`, and `#todo/<category id>` address them.
  **All** lists the todos of no category first, then each category's under its name.
  **Today** lists the todos due today or before, or with a todo under them that is, earliest due first; **Add a todo due today** there adds one due today.
  **From agents** lists the todos that an agent added; see [Todos from agents](#todos-from-agents).
- The **+** beside **Categories** adds a category; type its name and press Enter, and the page opens it.
  A category's **⋯** menu renames it or deletes it; deleting a category keeps its todos, in no category.
- **Add a todo** at the bottom of a list starts a new todo in that list's category; type its title and press Enter.
  Enter then starts the next todo below it, and Enter on an empty one, Esc, or a click elsewhere stops.
- A todo can hold todos of its own, one level down and no deeper, and they share its category.
  Tab while typing a todo moves it under the todo above it in its category, and Shift+Tab moves it back out, with the todos below it, so the list reads in the same order.
  Tab does nothing on a todo that holds todos of its own, since they would end up three deep, nor on one with links, which a todo under another cannot hold.
  The **+** that shows on hover adds a todo under that one.
- Drag a todo by its row to move it among the todos beside it, top-level ones in **All** and a category, and a todo under another among its parent's.
  Dropped beside a todo of another category, a top-level todo joins that category.
  Alt+Shift+↑ and Alt+Shift+↓ move the focused todo one place the same way.
  **Today** sorts by due day and **Done** by when it was cleared, so neither moves todos.
- Click the circle before a todo to check it; checking a todo checks the todos under it too.
  A todo that holds others shows how many of them are checked, as in `2/3`.
  The page's header counts the top-level todos left to do, and **Clear done** moves every checked todo it lists to **Done**, a checked todo under an unchecked one as a todo of its own.
- **Done** lists the cleared todos, latest first, with the day each was checked.
  Hover one to put it back last in the list, in its category if that still exists, or to delete it for good; **Empty** deletes them all, after you confirm.
- Click a todo's title to edit it and open it beside the list.
  An empty title, or Backspace in an empty one, deletes the todo, and so does the **×** that shows on hover; deleting a todo deletes the todos under it.
  **Undo** shows for eight seconds after a delete and puts the todo back where it was, with its todos, notes, and links.
- The search field in the page's header, or `/` outside a text field, keeps the todos whose title or notes, or a todo under them, hold every word typed; Esc clears it.
  Outside a text field, J and K focus the next and previous todo, X checks the focused one, and Enter opens it.
- An open todo shows its category, which you can change for a top-level todo, its due day, and its notes in markdown.
  A todo due today reads **Today** in the list, and one whose day has passed reads **Overdue** in red; **No due day** takes the day off.
  The notes always render as the agent's messages do, with GitHub's task lists and tables, and that render stays on screen while you edit them in the same type.
  They save when the text field loses focus and on Cmd+S; a todo with notes shows a notebook icon in the list.
- A top-level todo shows what it links to: a session, a pull request, or a Linear issue, each a chip that opens it here.
  A running session's chip shows its status dot; an open todo's **×** on a chip unlinks it.
- An open top-level todo's **Start session** opens the new-session draft with its title and notes as the first message, in the sidebar's project; `#new/<cwd>?todo=<id>` addresses it.
  The session links to the todo once omp starts.
- With Linear connected, an open top-level todo's **Create Linear ticket** asks for a team, then opens an issue from the title and notes, assigned to you, and links it to the todo.
- The list icon on an inbox pull request, a ticket, and a live session's header adds a todo of no category, last in the list, that links to it.
- The server keeps the list in `todos.json` beside its access token, so every browser tab and the desktop app show the same list, and a change in one shows in the others at once.
  A `todos.json` from before categories, notes, due days, links, or the archive still loads, with none of them; a todo checked then reads as checked when the server loads it.
  A `todos.json` that the server cannot read as a todo list is moved to `todos.json.invalid` rather than written over.
  While the page has lost the server, the list cannot be changed.

### Todos from agents

- The `user_todo` tool lets an omp session list your todos, add one, or check one off; it cannot edit or delete one.
  It comes from `~/.omp/agent/extensions/todos.ts`, which `bun run omp-template` installs.
- An agent adds a todo when it stops on a step only you can take, such as approving a migration or reviewing a pull request.
  The todo lands last in no category, and its chip names the session that added it and opens it.
- The tool leaves each change as a file in `todo-inbox/` beside `todos.json`, and the server applies it and deletes the file, so a todo an agent adds while the dashboard is down shows once it starts.
  A file that is not a change an agent may make moves to `<name>.invalid`.

## Routines

- A routine starts sessions, or runs a shell command, on one or more schedules.
  The **Routines** tab, or a `#routines` address, lists them in place of the panes, and the sidebar then lists **All** and each routine by name, a paused one muted.
  `#routines/<id>` opens one routine.
- **New routine** opens the editor: a name, the workspace it runs in, its task, its schedules, and its skill.
  The task is a prompt you write, or a shell command.
  Each schedule repeats every so many minutes, hours, or days, counted from the last run, or runs at a time of day on the days you pick. **Weekdays** and **Every day** pick those days at once. **Add schedule** adds another. The routine runs at the earliest of them, and a missed time still starts one run.
  The skill starts as the one pinned in **Settings › New sessions**, and **None** starts the sessions without one.
- A command routine runs its command with `sh` in its workspace, without an omp session, so it takes no skill and the editor hides that field.
  The command runs with your user's full permissions, and nothing asks before it acts: a file it deletes is gone.
  It stops after 10 minutes, and its run keeps the last 64 KB of what it printed, stdout and stderr together.
  A command routine whose last command still runs records an error instead of running a second one.
  Its runs read **Running…**, **Succeeded**, **Failed (exit n)**, **Stopped at the time limit**, **Stopped with the dashboard**, or **Could not start**, and anything but a success also counts as an error.
- Each row shows the routine's schedules and task, when it runs next or **Paused**, and what its last run did: how many sessions it started, how many errors it had, and **Queued: n** while it still has sessions to start.
  Its **⋯** menu has **Run now**, which runs it at once whatever its schedules, **Pause** or **Resume**, **Edit**, and **Delete**, which asks first.
- A routine's page shows its settings and its last 10 runs, newest first, each with the sessions it started, its command's output, and its errors.
  Output longer than 20 lines folds behind **Show output**.
  Click a session to open it, live while it runs, else its transcript (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  A run still opens a session in `/tmp`, which the sidebar does not list.
- At most 3 routine sessions run at once, and a run starts the rest of its queue as they finish.
  Commands do not count toward that limit.
  A prompt routine whose last session still runs records an error instead of starting a second one.
- A routine session runs unattended: its prompt tells it not to ask questions.
  Once its turn finishes, the dashboard ends it, so it moves to the past sessions with its transcript, and **Resume** continues it.
- Routines run only while the dashboard runs.
  A slot missed while the dashboard was closed runs once when it starts again, however many slots it missed.
  Quitting the dashboard stops a running command, and the next start does not run it again; its run reads **Stopped with the dashboard**.
- The server keeps the routines in `routines.json` beside its access token, so every browser tab and the desktop app show the same ones.
  While the page has lost the server, the routines cannot be changed.

## Settings

- The gear button in the sidebar header opens **Settings**, split into seven tabs that look like the sidebar's **Inbox** and **Sessions** tabs: **Model roles & provider order**, **Retry and fallback**, **Files**, **Worktrees**, **Integrations**, **New sessions**, and **Appearance**.
  Switching tabs keeps an unsaved edit, and the selected tab stays when you change workspace.
  **Integrations** connects Linear; see [Linear tickets](#linear-tickets).
  **Worktrees** lists every Git worktree in repositories where a session ran, and a path you enter lists that repository too.
  Each row shows the branch and path, the last time an omp session file in that checkout changed, the last commit, approximate disk use, and tracked or untracked changes.
  No omp session reads as no omp session, not as unused.
  **Delete** asks before it removes a linked worktree or forgets a registration whose directory is already gone.
  It keeps the branch and session transcripts.
  It refuses the main checkout, a locked checkout, unsaved changes, a nested repository, a checkout this dashboard or a live session is using, and a checkout whose subagent locations are unknown.
  Ignored files such as dependencies and `.env` are deleted with the checkout, and the confirmation names them.
  A detached commit that no branch contains is named before its registration can be removed.
  The page cannot see every shell or editor, so close other tools using a checkout before you delete it.
  Disk use is approximate, and removing a checkout may free less than the number shown.
  The first tab shows which model omp uses for each role (`default`, `slow`, `plan`, `advisor`, `vision`, `smol`, `commit`, `tiny`, `task`) and the fallbacks that omp tries after that model, in order.
  A role without its own chain says that it uses the `default` role's chain.
  Chains keyed by a model or a `provider/*` wildcard appear in their own table, and the `modelProviderOrder` follows.
  **Retry and fallback** lists the `retry.*` settings with omp's defaults filled in, for example `usageAwareFallback`, `usageReservePct`, and `usageReservePolicy`.
  Hover a retry setting to see its config key.
- Every part of the routing has an **Edit** button.
  On a role, pick its model and thinking level from the models that `omp models` lists, then add, remove, or reorder its fallbacks.
  Save writes the change to your `~/.omp/agent/config.yml` and leaves every other key as it was.
  A role that walks the `default` chain keeps doing so until you change its fallbacks.
  Removing every fallback of a role removes its own chain, so it walks the `default` chain again.
  The retry settings and the provider order save the same way.
  A workspace's `.omp/config.yml` still overrides what you save there.
- The **Files** tab lists the files that omp reads: context files such as `AGENTS.md`, the `SYSTEM.md` and `APPEND_SYSTEM.md` prompt files, `config.yml`, agents, commands, rules, skills, and hooks.
  Select a file to read its content, and choose **Edit** to change it in place (**Create** for a file marked `missing`).
  Save with the button or with Cmd+S. If the file changed on disk after the page read it, the save is refused and your edits stay in the editor, so you can copy them before you load the file from disk.
  A `.yml`, `.yaml`, or `.json` file must parse before it saves, and a settings file must hold a mapping.
  `~/.omp/agent/AGENTS.md` and `~/.omp/agent/config.yml` appear even before they exist, marked `missing`.
  If omp cannot load `config.yml`, the two routing tabs show omp's error and **Files** still lists the files, so you can fix the broken file there.
  Files from installed plugins and omp's bundled rules are left out.
- **New sessions** pins a skill.
  Every session that you start from the dashboard, from the new-session draft or from a quick action on a pull request or a Linear issue, then sends its first message through that skill.
  The picker lists the skills of the workspace that the settings show, or your own skills with **User files only**.
  Choose **None** to unpin.
  The pin is saved in the browser's localStorage, not in omp's files.
- **Appearance** sets the dashboard's theme: **System** follows the computer's light or dark setting, and **Light** and **Dark** pin one.
  The choice applies at once and is saved in the browser's localStorage, not in omp's files, so it does not change omp's terminal theme.
- **Settings** opens on the workspace of the session that you had open, so it includes that project's files and its `.omp/config.yml` overrides.
  With no session open, it shows user files only.
  Use the workspace picker in the header to choose another directory that a session ran in, or **User files only**.
  The page is in the URL hash, `#settings` or `#settings/<encoded directory>`.
  After each save the page shows the settings as omp loads them from disk.

## Keyboard shortcuts

The shortcuts follow common web-app conventions, from Slack, GitHub, Gmail, Linear, VS Code, and ChatGPT.
Cmd stands for Command on macOS and Ctrl on Linux and Windows.
Alt is Option on macOS.

| Key | Where | Action |
| --- | --- | --- |
| Esc | Composer | Interrupt the running turn |
| Cmd+Enter | Composer | Send once the running turn finishes, as a follow-up (Enter steers it) |
| ↑ | Empty composer | Move the last queued message back into the composer |
| Cmd+K | Anywhere | Start a new todo |
| Cmd+Shift+K | Anywhere | Jump to a session |
| Cmd+Shift+O | Anywhere | Start a new session |
| Cmd+Shift+X | Anywhere | End the focused session |
| Alt+↑ | Anywhere | Open the previous session in the sidebar |
| Alt+↓ | Anywhere | Open the next session in the sidebar |
| Cmd+. | Anywhere | Choose the session's model |
| Cmd+J | Anywhere | Cycle the thinking level |
| Cmd+E | Anywhere | Expand or collapse tool calls |
| Cmd+B | Anywhere | Show or hide the sessions sidebar |
| Cmd+Shift+B | Anywhere | Show or hide the session details sidebar |
| Cmd+, | Anywhere | Open or close settings |
| Cmd+/ | Anywhere | Show keyboard shortcuts |
| Esc | Maximized pane | Restore the split |
| ? | Outside text fields | Show keyboard shortcuts |
| / | Outside text fields | Focus the composer |
| G then I | Outside text fields | Go to the pull request inbox |
| G then T | Outside text fields | Go to your Linear tickets |
| G then S | Outside text fields | Go to the sessions |
| G then D | Outside text fields | Go to your todo list |
| G then R | Outside text fields | Go to your routines |
| G then P | Outside text fields | Choose the sidebar's project |
| J | Inbox, outside text fields | Move to the next pull request, or show it in the open sheet |
| K | Inbox, outside text fields | Move to the previous pull request, or show it in the open sheet |
| O | Inbox, outside text fields | Open the pull request on GitHub |
| . | Inbox, outside text fields | Open the pull request's quick actions |
| / | Todo page, outside text fields | Search the todos |
| J / K | Todo page, outside text fields | Focus the next or previous todo |
| X | Todo page, outside text fields | Check or uncheck the focused todo |
| Alt+Shift+↑ / Alt+Shift+↓ | Todo page | Move the focused todo up or down |

- Press `?` outside a text field, Cmd+/ anywhere, or click the keyboard button in the sidebar header, to list the keyboard shortcuts.
  Hovering a button that has a shortcut shows its keys in the button's tooltip: the sidebar header's buttons and tabs, the project, model, and thinking pickers, **New session**, **End session**, the composer's Stop button, and a maximized pane's restore button.
- No shortcut takes a key that the browser keeps for itself: Cmd with T, W, N, L, R, D, Q, O, P, S, Tab, or a digit does what the browser does.
  Single keys and the G pairs work only while no text field has focus, so they never take what you type.
  For a pair, press G, then the second key within 1.5 seconds.
- In the composer, Esc interrupts the running turn and Cmd+Enter sends a follow-up. ↑ moves the last queued message back only while the composer is empty, as ↑ edits your last message in Slack.
  With a draft, ↑ moves the caret as usual.
  In a maximized pane, Esc in the composer restores the split only when no turn runs there.
- Cmd+K opens the **Todo** page on **All** and starts a new todo, so you can type its title and press Enter.
  Cmd+Shift+K searches every running and past session, in every project, by title or directory, and opens the one you pick in the focused pane.
  The search button in the sidebar header, immediately before the keyboard button, opens that search.
  A session from another project switches the sidebar to that project.
  Alt+↑ and Alt+↓ walk the sidebar's list, pinned sessions, then idle ones, then running ones, then interrupted ones, then past ones, in the focused pane.
  From a subagent they step from its session's row.
- Cmd+Shift+O opens the new-session draft, as the **+** next to the session list does.
  Cmd+Shift+X ends the focused session, as **End session** in its header does, with no confirmation; **Resume** continues it from the past sessions.
  It does nothing in a subagent, a read-only room, or a past session.
  `/` puts the cursor in the focused pane's composer.
- Cmd+. opens the model picker and Cmd+J moves to the next thinking level, in sessions that the dashboard started and in the new-session draft.
  Cmd+E expands or collapses every tool call.
  Cmd+, opens Settings, where the model roles live, and closes it again.
- G then I opens the Inbox tab.
  G then S goes back from the inbox, the todo list, the routines, Settings, or the new-session draft to the panes.
  G then D opens the **Todo** page, and G then R the **Routines** page.
  G then P opens the project picker with its search field focused.
- Session shortcuts act on the focused pane.
  The dashboard does not read `~/.omp/agent/keybindings.yml`.

## Desktop app

`bun run desktop` shows the dashboard in its own window; see the [README](../README.md#desktop-app) to start it.

- The window is the same page as a browser tab, on the same address, `http://127.0.0.1:<port>`.
  It keeps its own localStorage, so pins, folded sections, the sidebar widths, the theme, and the pinned skill start fresh in the window and stay apart from a browser's.
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
- Every link to another site opens in the default browser, and so does **Connect Linear**'s sign-in page.
  The window never leaves the dashboard.
- Cmd+W closes the window, Cmd+R reloads it, Cmd+Q quits, Cmd+M minimizes, and Cmd+0, Cmd++, and Cmd+- set the zoom.
  The menu takes none of the dashboard's own shortcuts.
  Right-click in a text field for cut, copy, paste, and spelling suggestions.
- The window remembers its size and position.
- The window title follows what the page shows, and a browser tab's title does too: the focused session's name, a subagent's name ahead of its session's, `Inbox`, `Tickets` or the open ticket's identifier, `Todo`, `Settings`, or `New session`, then `omp agents`.
  A session without a name reads as its project, and nothing open reads `omp agents`.
- The Dock, the menu bar, and Cmd+Tab show `omp agents` and the dashboard's icon, not Electron's.
- Alt+Shift+Cmd+T, from any app, brings the window up on the **Todo** page with a new todo started, so you can type it and press Enter.
  Cmd+K starts that new todo while the dashboard is focused.
  When another app holds the keys, the app logs so and the shortcut does nothing.
- The Dock icon's badge counts the top-level todos left to do, as **All** does, and goes away at none.

## Limitations

In a terminal session, the dashboard cannot run omp's built-in `/` commands or the `!` shell shortcut: Collab accepts guest prompts, not host-side TUI commands.
No session runs the `$` Python shortcut from the dashboard, and only the omp terminal runs `!!`.
The composer says so under a draft that starts with one of them and does not send it, instead of sending literal text to the agent.
Run them in the omp terminal.
