# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines in Settings › What's new.

## 2026-11-17

- The Todo page has no list on its left anymore; All, Today, Needs you, From agents, and Archive are tabs in the bar above the list, as on the Pull requests page.
- Filter on the Todo page has a Category choice, which shows the todos of the categories you check, or those in no category; checking one alone shows that category as its old list did, and new todos join it.
- Display › Categories… on the Todo page adds, renames, and deletes categories, where the left list did before.
- The color checkboxes that hid a category from the Todo lists are gone; use Filter › Category instead, and an old link to a category opens All.
- A Markdown artifact draws its `mermaid` diagrams and `chart` blocks as pictures, as a reply in the conversation does, instead of showing their source.
- The stack menu on a pull request lists the session's other pull requests by number and title, with an icon that says whether each is open, a draft, merged, or closed.
- Images in the Artifacts tab open when you click them: a screenshot inside an HTML page, or an SVG, fills the window, where you can zoom and step to the page's other images with the arrow keys.
- The dashboard takes affectUI's Clean look in light and dark: the Inter font, softer grays, near-black buttons, and new shadows and corner radii.
- Tool calls in a conversation show as small cards with the tool's icon, name, summary, and status, and the group line shows the last tools' icons and how many failed.
- The context ring's menu opens on a card with the tokens used, a grid filled to the share used, and when auto-compaction starts.
- A plan's usage card leads with the share left of its tightest window, then lists each limit with its bar and reset time.
- Shortcut keys, segmented tabs, toasts, loading bars, and spinners have a softer look, and a toast that stays open closes with a round ×.
- The Overview's Files list shows each file's icon on a tinted square, green for new and red for deleted, with its line counts at the right.
- Folder trees, in the changes dialog and Settings › Files, open with a turning chevron and show a guide line under each open folder.
- A subagent's file diff highlights only the words that changed between a removed line and the added line that replaces it.
- A yes-or-no question from a session shows as a card with No and Yes buttons, each with its number key.
- A tool approval shows as the yes-or-no card asking "Allow bash?", with what it will run and Deny, Allow for session, and Allow once buttons, each with its number key.

## 2026-11-16

- omp-agents starts again on omp 18.21.0, which removed the piece the sandbox cleanup used to find a running ovnfs file system; the cleanup now asks `ovnfs status` itself, still without ever starting it. The weekly model replays run again too.
- Settings › Agents no longer has a special case for omp's seance agent, which omp 18.21.0 removed.
- Settings › Workspaces has a Filter workspaces field that narrows the Workspaces and Hidden lists by folder name or path as you type.
- Every + button, on New session, New tab, New Bot, New routine, and Add, uses the smaller plus-small icon.
- The app opens again after the update that removed Gmail and Google Calendar; it stayed blank while its saved Integrations answer still listed them.
- The Email, Linear tickets, and Calendar pages are gone from the sidebar, along with everything that used Gmail, Google Calendar, or Linear.
- Sessions no longer have a Tickets tab, the New ticket shortcut is gone, and todos no longer link to or create Linear tickets.
- Routines can no longer start from a new email or a calendar event, and agents can no longer add reminders for you to see.
- Settings › Integrations no longer offers Linear, Gmail, or Google Calendar. Your saved events and Google account list stay on disk, unused.
- Resting the pointer on a link to another site shows a card with its whole address in place of the address at the bottom left of the window; for a link outside an agent's text, the card also shows the site and the page's title and description.
- Behind the scenes: site icons and link cards share one safe way to read public web pages, and a site's icon now shows even when its home page is large. Emails show `&nbsp;` and `&apos;` as the characters they stand for.
- Linear tickets has the Pull requests header: a search, All, Active, Todo, and Backlog tabs, a Filter by status, priority, label, project, team, and dates, and a Display menu to group by status, priority, project, or nothing.
- Todo has Filter and Display above its list: filter by priority, assignee, link, due date, and creation date, and group by status, priority, assignee, or nothing.
- Notifications has a search, All and Unread tabs, a Filter by source and date in place of the source buttons, and a Display menu to group by new and earlier, source, or nothing.
- The session sidebar has a Diffs tab: a row per changed file, and a click shows that file's diff, with Previous and Next to step through them.
- The session sidebar's + menu starts with a search field that narrows its tabs, subagents, and New terminal as you type.
- Down chevrons, on menus, pickers, and folding rows, use the smaller chevron-down-small icon.
- Fold chevrons, on sidebar sections and other folding rows, also use chevron-down-small, turned to point right while folded.
- Right chevrons, on menu items, breadcrumbs, and folded rows, use the smaller chevron-right-small icon.
- Left and up chevrons, on calendars, find bars, and lists, use the smaller chevron-left-small and chevron-up-small icons.
- A session left idle for 12 hours now stops on its own and moves to Past, keeping its worktree, so Resume picks it back up where it was. A session still waiting on a subagent is not idle.
- Settings › Preferences has a new Stop idle sessions choice: Off, or after 4 hours, 12 hours, 24 hours, or 3 days. Sessions started in a terminal, private sessions, and Bots' conversations keep running.
- The Tickets tab and page are now called Linear tickets, and so are their groups in the command menu and Settings › Keyboard.
- The Linear tickets page no longer shows a list at its left, so the issues take the whole page.
- The Linear tickets tab reopens the last issue you had open, or the list when you have opened none yet.
- Modules show the logo of the service they use, in the sidebar, the tabs, the command palette, and Settings › Modules: Linear for Tickets, Google Calendar for Calendar, and Gmail for Email.
- Cmd+Shift+T reopens the last tab you closed in the header, in its old place and on the page it showed.
- Right-click a header tab to Pin tab, Unpin tab, open a New tab, Close tab, or Close other tabs, and Ctrl+Shift+P pins or unpins the tab on screen.
- Pinned tabs sit first and show only their icon, and stay open until you unpin them, even after a reload.
- A header tab's right-click menu also has Duplicate tab, which opens the same page in a new tab right after it, Copy URL, which copies the tab's address and has no key, so Cmd+L stays the browser's, and Close tabs to the right, which keeps pinned tabs.
- Each header tab keeps its own Back and Forward, as in Capy: the buttons, Cmd+[ and Cmd+], and the mouse's back and forward buttons go through what the tab on screen showed, and switching tabs no longer mixes them up.
- A tab's Back and Forward stay after a reload, after pinning it, and after Cmd+Shift+T brings it back, and Duplicate tab gives the copy the same Back and Forward.
- The Pull requests page has tabs above the list, Open, Your move, Approved, Merged, and All, that show only those sections, and the page remembers your pick.
- Filter, beside the tabs, filters the Pull requests page by section, repository, author, and when a pull request was created or last updated, and each filter shows as a chip under the tabs that you can change or remove.
- The Pull requests page has a search in its header that finds pull requests by title, number, branch, author, or repository.
- Display, beside Filter, groups the Pull requests page by repository, section, or author, or not at all, and holds the order, Show empty sections, and Repositories.
- The + in the Pull requests page's header starts a session that makes the change you describe in a repository you pick and opens a pull request for it.
- The Pull requests page no longer has a Board view, so it always shows the list.
- The Pull requests page no longer shows a list at its left, so the table takes the whole page.
- Repositories, under Display on the Pull requests page, hides or shows each repository and moves it up or down.
- A hidden repository also leaves the Pull requests tab's count, and Reset the order keeps it hidden.
- While you hide any repository, the Display button's tooltip says how many, and a page with every repository hidden offers Show all repositories.
- In Settings, the up and down arrows that move a sidebar tab, an account, or a list entry keep focus at the top or bottom of the list, and their tooltip says why they do nothing there.
- Behind the scenes: the Pull requests page and Settings › Preferences share one list of switches and arrows.
- Settings has a search field above its sections: type a name or a related word, such as git, to list only the matching sections, and press Enter to open the first one.
- The message box of a new session now takes the cursor when you pick its project, start a new session from a workspace in the sidebar, or open the page before the dashboard has connected.
- The sidebar's foot now shows plan usage as full-width rows with a bar, instead of a grid of rings, so long account emails read in full.
- The Mac's CPU, free memory, and free disk no longer show in the sidebar; Settings › Storage still shows the free disk space.
- A workspace's new-session button in the sidebar now sits level with the workspace name and its chevron, instead of a few pixels lower.
- In the desktop app, the sidebar toggle and the back and forward buttons above the sidebar respond to clicks again, instead of dragging the window.
- Settings has a new Modules page listing Tickets, Calendar, Sport, and Email, each with a switch to turn it on or off.
- A module you turn off leaves the sidebar, and its shortcuts and commands stop working; opening its page says it is off and links to Modules.
- Turning Sport off also stops new sessions from getting the sport tool.
- New module, Edit, and Delete on the Modules page open a new session with a request already written for an agent to add, change, or remove the module; you review it and send it.
- Delete turns the module off right away, and its saved data stays on your computer.
- In poteto mode, a Babysit run's todo list now holds only the steps its mode runs, so a one-time rebase or a review-thread fix no longer ends with a turn spent ticking off polling and merge steps.
- A session's subagents now show only in the right sidebar's Overview tab. The conversation no longer lists them under the task call that started them, so that call's tool group folds like any other once it finishes.
- Clicking a subagent in the right sidebar now opens its conversation in a sidebar tab named after it, with its composer, so the session's own conversation stays in the main pane. Cmd-click still opens it in a split.

## 2026-11-13

- The shortcuts now match Capy's. Cmd+1 to Cmd+9 go to your tabs at the top, and Option+1 to Option+9 open the sidebar's first nine sessions.
- Cmd+T opens a new tab, Cmd+Option+W closes all the other tabs, and Ctrl+Tab or Cmd+Option+→ and ← move between tabs.
- New keys, the old ones no longer work: Cmd+Shift+O starts a new session, Cmd+. stops the turn, Option+M dictates, Cmd+, opens Settings, Cmd+Shift+B shows the details sidebar, and Cmd+Shift+, copies a pull request's link.
- New keys: Cmd+/ attaches files, Cmd+Shift+L also opens the right sidebar when it is closed, Cmd+Shift+G pressed again on the Overview opens Review, Ctrl+Shift+F maximizes a pane, and J and K move through lists like ↓ and ↑.
- The sidebar's pages no longer take Cmd+number keys; open them from the sidebar or the command menu.
- The tab on screen no longer shows a dotted grip; you can still drag any tab from anywhere on it.
- A session's header no longer shows Open PR; Open pull request in the command menu still asks the session to open one.
- With the sidebar open, the back and forward buttons now sit beside its toggle at the sidebar's right edge, and the tabs start right where the page does.
- The bottom of the sidebar now shows how much of each model plan is left, as a grid of rings with the provider's logo inside and the percent left below, one per account, and your Mac's CPU, free memory, and free disk in the same rings, where the Keyboard shortcuts link was. Reset times and reset credits show when you hover a ring. Hover or click CPU to see each session's processes, or the disk to clean up. Settings › Keyboard and ? still open the shortcuts.
- The strip along the bottom of the window is gone, so the page runs to the window's edge.
- The terminal's button, its Ctrl+` shortcut, and its command in the command menu are gone; New terminal in a session's right sidebar + menu still opens it on a new shell.
- Behind the scenes: the sidebar's foot is its own piece under the sessions list, plan and machine tiles share one tile, and the Activity history for the CPU and disk clicks starts over under new names.
- Resume, or a message to a past session, now puts back the folder the session worked in when archiving it had removed that folder, on the same branch, so the agent picks up where it left off.
- When the session's branch was deleted meanwhile, the folder comes back on a fresh branch of the same name, started from the latest main branch.
- Fixed: when the project the session worked in is gone, Resume now says so instead of starting an agent in a missing folder.
- Fixed: an agent that rebased its own branch, or ran a script or background job that switched it, was told another process had switched the branch and could not edit, resolve the rebase, or abort it. Its own moves now pass, and a switch by another session still stops it.
- Settings › Keyboard and Settings › Activity now list each page's shortcuts and views in the same order as the sidebar.
- Behind the scenes: Sport, Calendar, Email, and Tickets are now separate modules, so a page like them can be added or removed without touching the rest of the app.
- The **+** menu in a session's right sidebar now lists its subagents, each opening its view, and **New terminal**, which opens the terminal on a new shell.
- ⇧⌘G shows the right sidebar's Overview tab and ⇧⌘L opens its Browser tab in the desktop app, as in Capy; the + menu lists both keys.
- The right sidebar's tabs now work as Capy's: it starts with Overview, + lists PRs, Browser, Tickets, and Artifacts to open as tabs, and each opened tab has an × to close it. A Bot's details do the same with Routines and Tickets.
- Notifications moved from the bell at the top right to a Notifications row in the sidebar, before Settings, with its unread count; it opens a full page with the same filters and Mark all as read.
- The omp logo and the search button moved down out of the window's top bar to their own row in the sidebar, just above New session.
- Notifications moved from the bell at the top right to a Notifications row in the sidebar, right under New session, with its unread count; it opens a full page with the same filters and Mark all as read.
- The header no longer has a Settings button; the sidebar's Settings row and G then , still open Settings.
- What's new moved from the sparkles button at the top right to Settings › What's new, with Update dashboard. The header now holds only your tabs.
- Archive session now shows an archive icon in the header and the sidebar's right-click menu, and the header button is plain instead of filled.
- A session's header no longer shows its branch or its pull request and Linear issue buttons.
- The Personal and Work spaces are gone: every page shows all your workspaces, sessions, Bots, events, and accounts together, and the sidebar's Workspaces label still narrows the list to one workspace.
- Keyboard shortcuts now live in Settings › Keyboard, and ? opens it.
- The sidebar no longer has a Keyboard shortcuts link at its bottom; ? still opens Settings › Keyboard.
- End session is now called Archive session.
- The details sidebar now joins the page with no gap: one line, which you drag to resize it, sits between them.
- The sidebar's page list no longer has a Sessions tab; the workspace list below it already holds the sessions, and the tabs after it move up a number key.
- Sport and Tickets now show all the time, and any session can read and log your training with its sport tool.
- Personal sessions are gone, with the Memory tab and the remember tool they had; Bots keep their own memory.
- Google accounts are no longer placed in a space: Email, the Calendar, and agents use every connected account.
- Behind the scenes: removed the space code from the server, the agents' extensions, and the page, and files from older versions drop their space fields when they load.
- Hiding the sessions sidebar now closes it all the way: the page takes the full width, and the button to bring it back stays at the left of the tabs.
- A page's own list, such as your Bots, the Pull requests sections, the Todo categories, or the Settings sections, now sits in a column at the page's left, as in Linear's inbox, instead of under its row in the sidebar. Drag the column's edge to size it. In a narrow window or on a phone it stays under its row.
- A closed session you open no longer shows up inside its workspace in the sidebar; workspaces list only running and interrupted sessions, and closed ones stay in Past.
- Cmd+W now closes the header tab on screen and leaves its session running. Ending a session takes the End session button or its menu item.
- Clicking a session or a page no longer opens a new tab at the top: as in Capy, it shows in the tab you are on, or switches to the tab that already shows that session. The + at the end of the tabs opens a new tab, and closing the last tab leaves a new one on New session. Your open tabs reset once with this update.
- Every icon in the dashboard now comes from Central Icons, with a lighter, rounder line than before.
- In an email, Reply all is now a button with its name, since the new icons have no reply-all picture to tell it from Reply.
- The right sidebar has a new first tab, Overview, with the session's subagents, changed files, images, and sources, each under a header that folds.
- The Session card no longer floats over the conversation, so the messages keep their full width; its toggle in the session header and the Show session card switch in Settings are gone.
- Each subagent in Overview now takes two lines: its name and what it is doing, then the model it runs on with its maker's logo, its type, and how long it has run.
- The sidebar's page list, from New session to Settings, now stays in place while you scroll your sessions below it.
- Bullets in an agent's reply read as a plain list again, with the bold word starting the sentence, instead of a two-column grid with lines between rows.
- Agents now answer comparisons, such as which tickets match which pull requests, with a table: the starter kit's reply format asks for one.
- The Notes page is gone, with its sidebar tab, the G then N shortcut, notes in the command menu, and the notes listed under a todo. A todo's own notes stay.
- Agents no longer have a tool to add or read your notes. Notes you already saved stay on this computer but no longer show anywhere.
- Agents no longer point you at `artifact://` or `local://` addresses the dashboard cannot open: the starter kit tells them to save what you should read to the Artifacts tab instead.
- A session can now run up to 8 helper agents at once instead of 2: the starter kit sets the limit to 8.
- UI changes come back faster: the starter kit's design workflow now has agents check their own screenshots on each round, and the separate design critic runs once, when you approve the direction, instead of on every tweak.
- When an agent asks you several questions at once, you get them again in one card that you go through with Next and Back, instead of one card per question. This needs the new omp patch for asking.
- A question that only takes typed text now opens straight on the text field, and you can send it blank to keep the answer already filled in.
- Messages that another agent sends to a session, such as its parent's instructions to a helper, now show in that session's conversation with the sender's name.
- The five omp patches, paid Cursor fallback, tool documentation, Cursor tools, the credit patch, and the new asking patch, now apply to omp 18.20.0.
- omp-agents is now tested with omp 18.20.0.
- The starter kit's artifact tool now names the Artifacts tab in its description, so agents link it to the rule about when to save one.
- Fixed: with omp 18.20, Settings › Models again reads your model roles and fallback chains, and offers model updates.
- The starter kit now tells agents when to save something to the Artifacts tab on their own: a report you will choose from or come back to, a one-file mockup, or a diagram too large for the reply.
- The window has a new look. The sidebar runs down the whole left side with every page in one list, and the page sits beside it in a rounded panel.
- A row of tabs now runs across the top of the window with the pages and sessions you opened lately. Click a tab to go back to it, drag it or press Alt+Shift and an arrow key on it to move it, and close it with its x or a middle click.
- Notes, Calendar, Todo, Sport, and Email now sit in the sidebar's page list with the other pages, and Cmd+1 to Cmd+5 go to the first five pages of that list.
- The Personal and Work switch now lives in the account row at the bottom of the sidebar, and its menu also opens the keyboard shortcuts.
- Sessions now show inside a folder for each workspace, with interrupted ones at the end of their folder, and Past stays folded until you open it.
- The sessions search now opens from the search button beside Workspaces or with Cmd+Shift+F.
- Scroll bars no longer vanish to nothing in some lists.
- A tab in the top row now has the same name as the window's title, such as the pull request's owner/repo#12 or the ticket's id, instead of just Pull requests or Tickets.
- Fixed: the window's title on the Bots gallery now says Bots instead of New Bot.
- Behind the scenes: the window's layout is declared in one place, the reorder helpers moved out of the pull requests model, and the tab row now keeps its edge fades right when the window resizes.
- Behind the scenes: the header buttons, the tab menu, and the desktop title bar were removed, and the Activity history for the command menu and space switch buttons starts over under new names.
- When Update dashboard brings in a new version that does not start, the desktop app now goes back to the version you had and starts it again. The bell and the command menu say which update did not start and why, and Update dashboard waits for a newer one before it tries again.
- When the dashboard stops on its own, the desktop app now starts it again after a few seconds, keeping your page. If it keeps stopping, the app shows what went wrong with a Retry button.
- When Obscura is installed (`brew install obscura`), the starter kit adds it as a browser agents use by default to read and click through pages. It loads a page several times faster than Chrome and uses about a tenth of the memory. Screenshots and design checks still use Chrome.

## 2026-11-12

- The starter kit now tells agents to run builds, test suites, and browser runs through a small helper that lets only a few of them run at once across all sessions, a quarter of the computer's cores by default, so many sessions testing together no longer slow the computer until tools time out. A command that has to wait says it is queued and what it waits for.
- The workspace pickers no longer list folders that were deleted, or folders inside an app's own data such as ~/.cache, ~/.codex, or ~/Library.
- A session in a subfolder of a project, or in a test project made inside it, now counts in that project's workspace instead of adding one of its own.
- In the new session's folder picker, type a path and choose Create folder to make that folder and start there.
- In the box you type a prompt in, / now lists commands, $ lists skills by name, and @ stays for files and other mentions.
- The plan usage at the bottom of the screen now shows one short chip per account, such as `yampa 5h 71% left · ✦ 2`, naming the account when a provider has two and how many windows are used up. Hovering or clicking a chip opens a card with every window's bar, when it resets, such as "Resets in 1d3h · Fri 13 Nov, 14:00", and the reset credits left.
- You can ask an agent to make a page, a document, or a drawing for you to look at, and it opens beside the conversation in the new Artifacts tab of the right sidebar.
- A page in the Artifacts tab is ready to use: its buttons and forms work, sealed off from the dashboard.
- Each time the agent saves an artifact again, a numbered version is kept with a short note on what changed, so you can go back to any earlier one.
- Go to latest, beside an earlier version, returns to the newest one.
- You can see each save in the conversation as "Saved … as version N", and its Open button shows that version in the sidebar, even from a pane beside others.
- You can switch an artifact between how it looks and its source text, copy it, download it, or open it in its own browser tab.
- The pull request description tool and the ship workflow now stop a gh command that hangs after 20 seconds and say which one timed out, such as "gh pr view timed out after 20s", where they could wait many minutes and then report only "gh exited -1".
- Fixed: a session's title no longer disappears in a narrow header, such as beside a wide right sidebar.
- In a narrow header, the header's buttons now fold into one menu named after the tab you are on, as on a phone, so the title keeps room to read.
- Fixed: a session's header beside a wide right sidebar now takes at most two rows, the title and then its buttons, where it could take three.
- The menu named after your tab in a narrow header now shows a blue dot on its button and a count beside Personal or Work while the other space has sessions that need you, as the switch it replaces does.
- Fixed: on a phone or in a narrow conversation, the Session card above the messages no longer looks like it covers them: it sits flat with a gap below it, and keeps its shadow only where it floats beside the messages.

## 2026-11-11

- In Settings, Workflows, the ship workflow's diagram now shows its real path: the reviews it can skip, the ready step, the live review loop of rebases, comments, and CI fixes, and the merge at the end.
- A workflow can draw its own diagram in Settings, Workflows by holding a mermaid block in its skill file; without one, its numbered steps still show in a line.
## 2026-11-11

- The Todos card no longer shows the agent's todo list or the Ship steps; it keeps Subagents, Files, Images, and Sources.
- The Todos card is now the Session card, and Settings › Preferences says Show session card.
## 2026-11-11

- The Browser's new Screen size menu shows the app as an iPhone, an iPad, or a laptop sees it, with a touch screen and Safari's user agent on the phone and tablet, so you can test its responsive layout; its Rotate turns the phone or tablet sideways, a size too big for the Browser shrinks to fit, and the session keeps its pick for 30 days.
- A Browser picture taken at a screen size keeps that size's own width and its chip names the size, such as Mobile, 390×844.
