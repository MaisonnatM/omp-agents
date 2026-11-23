# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines in Settings › What's new.

## 2026-11-23

- Docs: four choices kept only in project memory (the Memory page layout, session sidebar links, skipped hidden repositories, agents' project access) now have decision records.
- Projects: the sidebar page list and Settings › Preferences › Sidebar tabs no longer have a Projects row, since the Projects section just below it already lists them.
- Session sidebar: opening a session now opens its PRs and Linear tabs whenever it has a pull request or a Linear issue, even after you closed them on another session.
- Projects: when an agent in no project changes a project without naming it, the error now lists the open projects with their ids, so it can retry in one step instead of listing them first.

## 2026-11-20

- Projects: a plan step can now hold sub-steps, one level deep, and agents see and tick them by number, such as 2.1.
- Projects: Select in the Plan card lets you pick several steps and start a new session in the project with them already in its prompt.
- Todo: when you ask an agent to file todos under a category that does not exist yet, it can now add that category itself; it still cannot rename or remove one.
- Session sidebar: a new Review tab compares each screen change the agent lists, its before and after screenshots split by a line you drag; pin spots on it, edit its description, and add a tweak or a revert request to the composer.
- Pull requests: the list refreshes about twice as fast in a busy repository, and a slow refresh no longer fails and leaves the list a minute out of date.
- Pull requests: a repository you hide under Display, then Repositories, is no longer read from GitHub, so the rest of the list refreshes sooner.
- Projects: a new Projects page follows one effort across sessions and workspaces, with its goal, a checklist plan, decisions, and a log.
- Projects: each session in a project gets the project's goal, plan, decisions, and latest log when it starts.
- Projects: a session in a project ticks steps and logs what it did as it goes.
- Projects: an agent can list every project, create one, and make any change the Projects page makes, on any project.
- Projects: Move to project in a session's menu puts it in a project.
- Projects: the sidebar lists each project as a folder of its sessions, above the workspaces.
- Projects: New session on a project's page starts a session already in it.
- Projects: the Projects page lists every project with its status, progress, sessions, and last update.
- Projects: an open project shows its figures, plan, sessions, decisions, and recent activity.
- Pull requests: each Your move heading now ends with buttons such as Reply 3, Fix CI 2, and Rebase 1, which hand that fix to an agent on every pull request waiting on it, after you click again to confirm.
- Behind the scenes: when a new omp release needs a newer Claude Code, the omp release check now updates Claude Code itself and bumps the tested omp version, instead of stopping.
- Behind the scenes: tested with omp 19.0.1.
- Behind the scenes: the omp release check runs again; it stopped at its first step after the dashboard started loading one of omp's native `.js` files.
- Pull requests: an approved pull request labeled `ask-human` now waits under **Waiting on others** instead of **Approved**, since a person still has to approve it.
- Agents can now schedule a follow-up message to their own session, such as checking CI in five minutes; it shows under Scheduled, where you can send it now, edit it, or cancel it.
- Pull requests: a failing `human-review` check no longer shows **Fix CI**, even once the pull request is approved and the check has not rerun yet.
- Memory: the omp memory tab is gone from the Memory page, which now opens on Project memory; omp memory stays in Settings › omp memory.
- Project memory: the Memory page now opens on **All projects**, every repository's memories in one table with the project each belongs to; the repository picker still narrows it to one.
- Sessions: ↑ and ↓ no longer switch to another session while a dialog, such as the image viewer, is open.
- Terminal panel: a shell that ends now gives its terminal back to your Mac right away, so a long-running dashboard no longer runs out of terminals for new shells.
- Behind the scenes: the slowest tests now get room to finish when your Mac is busy, so landing a change no longer fails on them by chance.
- Session sidebar: the Linear tab now lists only the ticket a session works on, the tickets it created or updated, and the ones your prompts link, not every ticket the agent read or mentioned.
- Session sidebar: a pull request a subagent only reviewed or commented on no longer shows; one a subagent opened still does.
- Memory: a project memory now opens in a panel beside the table, as a bookmark does, instead of a sheet over it.
- Agents now end a session on the first try when you ask; they save a project memory beforehand only when the session learned something worth keeping.
- Pull requests: a pull request whose only failing check waits for a person to approve it, such as `human-review`, now shows under review instead of Fix CI.
- A new Memory tab gathers your omp memory, each repository's project memory, and your bookmarks in one page.
- You can read, add, edit, and delete the project memories your agents wrote, for every repository you work in.
- Your Zen bookmarks and your x.com bookmarks show in Memory, searchable, and Sync x.com reads the x.com ones again through your Zen sign-in.
- x.com posts in another language show in English, translated by Google Translate when you sync, and the reader can show the original.
- x.com posts in Memory now show their photos, videos, and GIFs.
- Agents can now search your bookmarks when you ask them to.
- Ship: `ship_stage` now reads the same pull request as waiting for review too, instead of sending its session to Fix CI.
- Agents now ask for several independent tool calls at once more often and see how long they have been working, so Claude sessions should finish sooner. Set OMP_AGENT_PACE=0 to turn it off.
- Builds and test runs from parallel sessions wait less: the machine now shares a third of its CPU cores between them instead of a quarter.

## 2026-11-19

- A new Bot designer interviews you one question at a time, starting from the goal rather than the steps, and asks how to check the Bot's work and where feedback on it shows up, so the Bot it creates can improve itself. A designer you already made keeps its job until you edit it.
- The dashboard now works with omp 19.0.0: the process list and Start dev server use omp's new background service manager, and old task sandboxes still get cleaned up.
- Behind the scenes: the five omp patches are ported to omp 19.0.0; the tool-contracts patch got smaller because omp now does part of it.
- A question that lets you pick several options now shows a checkbox on each option that ticks as you click it, and, when asked one step at a time, a Done selecting button instead of numbered rows with Done among them.
- The session's right sidebar has a Linear tab, which opens by itself when the conversation links a Linear issue and shows that issue with its status, priority, assignee, and description, or any other issue whose id or link you type, read through the Linear server in Settings › MCP servers.
- Settings › MCP servers offers Linear in its catalog, and every installed server now shows a logo: Linear's and Marked's marks, and the site's own icon for other servers.
- Checklists in pull request descriptions no longer show a bullet beside each checkbox.
- A dashboard that an omp session starts, such as an agent's test run on another port, no longer runs your routines or messages your Bots; only the dashboard you opened does, so two dashboards stop fighting over the same Bot conversation.

## 2026-11-18

- The Artifacts tab takes the look of Claude's artifacts: one thin bar on top with the artifact's name, Preview and Source, and the actions, and the artifact filling the rest of the tab.
- With two or more artifacts, click the name at the top of the Artifacts tab to pick another from a menu.
- A bar at the bottom of the Artifacts tab steps to the older or newer version with its arrows, and Version 2 of 3 opens a menu of every version with its note.
- A Markdown artifact reads as a document: a centered column with larger headings and more space between lines.
- Each artifact in a conversation shows as a card with an icon, its title, and its kind, version, and note; click anywhere on it to open it.
- Agents can now run a helper on Fable 5.2 or Grok 4.7, so an arena can compare them with the other models.
- Changed files appear at once with a quick fade, instead of sliding in one after another.
- The Files section of Overview has no Review button anymore; click a file, or press Cmd+Shift+G, to open the changes.
- The Files, Images, and Sources headers in Overview are shorter.
- The window's top row is shorter: the header tabs keep the same small gap above and below them that the page keeps from the window's edges, and the sidebar toggle, back and forward, + and the macOS window buttons all line up with the tabs.
- The grid and sun behind New session are blue again, as they were before the new look turned them grey.
- Tool calls in a conversation are back to one line each with the tool's icon, name, and summary, under a "Ran N tools" line that says how many failed, instead of the small cards.
- A reply's work shows as one Working group: the thinking, the tool calls, and the messages the agent writes between them fold into it, and only its last message stays below. On a Bot's page those messages still show as messages.
- The Working group says how long the reply worked, "Worked for 2 min 13 s", counting up while it runs, and an artifact the reply saves now shows its card under that group instead of splitting it in two.

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
