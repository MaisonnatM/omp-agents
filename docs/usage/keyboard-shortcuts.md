# Keyboard shortcuts

The shortcuts follow Cursor where the window's menu leaves the key free, with web-app navigation keys for the Pull requests page, the todo list, and other dashboard pages.
Cmd stands for Command on macOS and Ctrl on Linux and Windows.
Alt is Option on macOS.

| Key | Where | Action |
| --- | --- | --- |
| Cmd+Shift+Backspace | Composer | Stop the running turn |
| Cmd+Enter | Composer | Steer the running turn immediately; on an empty composer, deliver a pending steer now |
| Shift+Tab | Composer | Cycle the thinking level |
| ↑ | Empty composer | Move the last queued message back into the composer |
| Cmd+K | Anywhere | Open the command menu |
| Cmd+N / S | Anywhere / outside text fields | Start a new session; on the tickets page, Cmd+N creates a Linear ticket |
| Cmd+F | Anywhere | Put the cursor in the sidebar's session search |
| Cmd+Shift+X | Anywhere | End the focused session |
| Cmd+[ | Anywhere | Open the previous session in the sidebar |
| Cmd+] | Anywhere | Open the next session in the sidebar |
| ↓ / ↑ | Sessions, outside text fields | Open the next or previous session in the sidebar |
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
| Cmd+1 … Cmd+8 | Anywhere | Go to the first … eighth tab the sidebar shows |
| C | Outside text fields, except on the Todo, Notes, Calendar, and Inbox pages | Create a Linear ticket, when connected |
| G then N | Outside text fields | Go to your notes |
| G then I | Outside text fields | Go to your Gmail inbox, when connected |
| G then R | Outside text fields | Go to your routines |
| G then W | Outside text fields | Choose the sidebar's workspace |
| ↓ | Pull requests page, outside text fields | Move to the next pull request, or show its details while one shows |
| ↑ | Pull requests page, outside text fields | Move to the previous pull request, or show its details while one shows |
| O | Pull requests page, outside text fields | Open the pull request on GitHub |
| . | Pull requests page, outside text fields | Open the pull request's `⋯` menu |
| E | Pull requests page, outside text fields | Give the pull request's next move to an agent |
| Space | Pull requests board, a card's title focused | Pick up the card; ← and → choose a column, Space or Enter drops it, and Escape puts it back |
| Cmd+Shift+K / Cmd+Shift+C | Pull requests page showing a PR | Copy its `#N` / GitHub link |
| / | Todo page, outside text fields | Search the todos |
| ↓ / ↑ | Todo page, outside text fields | Focus the next or previous todo, or open it while a todo is open |
| X | Todo page, outside text fields | Mark the focused or open todo Done, or a closed one Todo again |
| S | Todo page, outside text fields | Change the focused or open todo's status |
| P | Todo page, outside text fields | Change the focused or open todo's priority |
| A | Todo page, outside text fields | Change the focused or open todo's assignee |
| Shift+D | Todo page, outside text fields | Change the focused or open todo's due day |
| C | Todo page, outside text fields | Add a todo to the Todo group |
| Esc | Todo page, outside text fields | Close the open todo |
| / | Notes page, outside text fields | Search the notes |
| ↓ / ↑ | Notes page, outside text fields | Focus the next or previous note, or open it while a note is open |
| C | Notes page, outside text fields | Add a note and open it |
| Esc | Notes page, outside text fields | Close the open note |
| C | Calendar page, outside text fields | Add an event |
| ↓ / ↑ | Inbox page, outside text fields | Focus the next or previous conversation, or open it while one is open |
| Esc | Inbox page, outside text fields | Close the open conversation |
| O | Inbox page, outside text fields | Open the focused or open conversation in Gmail |
| R / A | Inbox page, outside text fields | Reply, or reply to all, to the open conversation's last message |
| # | Inbox page, outside text fields | Move the open conversation to Gmail's Trash |
| C | Inbox page, outside text fields | Write a new mail |
| Alt+Shift+↑ / Alt+Shift+↓ | Todo page or Pull requests page | Move the focused todo, or the Pull requests page's focused pull request, section, or repository, up or down |
| ↓ / ↑ | Changes page or a pull request's **Code** tab, outside text fields | Open the next or previous changed file |

- Press `?` outside a text field, or click the keyboard button in the sidebar header, to list the keyboard shortcuts.
  The dialog groups them in tabs by category: General, Sessions, Pull requests, Todo, Notes, Inbox, Calendar, and Changes.
  Its header states the rule for where a key works: chords with Cmd, Alt, or Ctrl work anywhere, even while you type, and single keys and G pairs work outside text fields; a **Composer only** tag marks the keys that work only in the composer.
  Each tab's column headings stay pinned while its list scrolls, and rows fade in under them.
  Hovering a button that has a shortcut shows its keys in the button's tooltip: the sidebar header's buttons and tabs, the workspace, model, directory, and thinking pickers, **New session**, **End session**, the composer's Stop and **Send now** buttons, a queued row's **Send now** and **Edit**, a maximized pane's restore button, the open todo's ↑, ↓, and **×**, the Calendar page's **New event**, and an Inbox conversation's **Reply**, **Reply all**, **Delete**, and **Open in Gmail**.
- Cmd+1 through Cmd+8 go to the first through eighth tab the sidebar shows, even while typing.
  The numbers follow the order the sidebar shows, which **Settings › Preferences** sets: a tab you hide, or Tickets or Inbox without a Linear or Gmail sign-in, takes no number, and the tabs after it move up one.
  A number with no tab is left to the window.
  In the default order the tabs are Pull requests, Tickets, Sessions, Todo, Notes, Calendar, Inbox, and Settings, so with both services connected Cmd+7 opens the **Inbox** and Cmd+8 **Settings**.
  The **Inbox** takes its number like any tab and keeps G then I.
  Cmd with T, W, L, R, D, Q, O, P, S, Tab, 9, or 0 is left to the window, whose menu takes Cmd+W, Cmd+R, Cmd+Q, and Cmd+0; see [Desktop app](desktop-app.md).
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
  The search button in the sidebar header, immediately before the keyboard button, opens it too.
  With nothing typed, **Suggestions** lists the five entries you use most, by how often and how lately, then **Running**, **Commands**, and **Past**.
  What you type ranks every match by how well it matches and how much you use it, and the app remembers that.
  Enter runs the highlighted entry's main action, which opens a session in the focused pane, and Cmd+Enter runs its second, which opens a session in a split.
  A session from another workspace switches the sidebar to that workspace.
  Cmd+K inside the menu lists every action of the highlighted entry, as the session row's menu does, and you can search them; Cmd+Shift+P pins or unpins a session, Cmd+Shift+C copies its path, and Cmd+Shift+X ends it, without opening that list.
  **Choose workspace…** switches the sidebar's workspace, and **Create todo** asks for a todo's title; Esc or Backspace in the empty field goes back.
  **Update dashboard**, listed when the server runs from a git checkout, names the new commits on its branch and runs [Updating omp-agents](updating-omp-agents.md).
  The bar at the bottom names where you are, what Enter does, and **Actions**, which opens the same list as Cmd+K.
  Esc closes the action list, then goes back, then clears what you typed, then closes the menu.
  Whatever you type also offers **Create todo**, last, which adds it at the end of **All**, with no category.
  You stay on the page you were on.
  The title can end with a due day or a `#category`, as in [Todo list](todo-list.md).
  With Linear connected, it also offers **Create ticket**, which opens the new-ticket dialog with what you typed as the title; see [Linear tickets](linear-tickets.md).
  Cmd+[ and Cmd+] walk the sidebar's list, pinned sessions, then idle ones, then running ones, then interrupted ones, then past ones, in the focused pane, skipping the rows that the sidebar's search hides.
  ↓ and ↑ do the same while the panes show and no text field has focus, instead of scrolling the conversation; a page, the changed files, or a focused sidebar row keeps them.
  From a subagent they step from its session's row.
- Cmd+N opens the new-session draft, as **New session** at the top of the session list does; on the tickets page it opens the new-issue dialog instead.
  S outside a text field does it too; on the Todo page, S changes a focused or open todo's status instead.
  Cmd+Shift+X ends the focused session, as **End session** in its header does, with no confirmation; **Resume** continues it from the past sessions.
  It does nothing in a subagent, a read-only room, or a past session.
  `/` or Cmd+I puts the cursor in the focused pane's composer.
- Cmd+Alt+/ opens the model picker, and Shift+Tab in a composer moves to the next thinking level, in sessions that the dashboard started and in the new-session draft.
  Cmd+Alt+P (Option+Cmd+P on macOS) opens the directory picker in the new-session draft and, between turns, in sessions that the dashboard started.
  Choosing a model, an effort, a directory, or a branch in a composer's picker puts the cursor back in that composer, and so does a click on its send or Stop button; Esc leaves the focus on the picker's button.
  Cmd+E expands or collapses every tool group.
  Cmd+Shift+E shows or hides the tool rows in those groups, and Alt+T (Option+T on macOS) shows or hides the thinking text.
  Both stay as you set them in the app.
- The number of the **Pull requests** tab opens the Pull requests page, and that of **Tickets** opens Tickets when connected to Linear; C then opens the new-ticket dialog from any page but the Todo and Calendar pages, where it adds a todo or an event.
  The number of **Sessions** goes back from the Pull requests page, the todo list, the calendar, the inbox, the routines, Settings, or the new-session draft to the panes.
  The numbers of **Todo** and **Calendar** open those pages, G then I or the Inbox's number the **Inbox** page when connected to Gmail, and G then R the **Routines** page.
  The number of **Settings** opens Settings, where the model roles and the integrations live, and closes it again.
  G then W opens the workspace picker with its search field focused.
- Session shortcuts act on the focused pane.
  The dashboard does not read `~/.omp/agent/keybindings.yml`.
