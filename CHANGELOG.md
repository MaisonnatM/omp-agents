# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines when you click What's new, the sparkles button at the top right.

## 2026-10-30

- Behind the scenes: the pull request rebase tests build their repositories once and copy them for each test, and wait up to 30 seconds, so they pass when the machine is busy.
- When an agent shows you design options, it names each one, such as Mode chip, and uses that same name in previews, Slack posts, tickets, pull requests, and suggested prompts, so a number never points at the wrong design.
- The End session button in a session's header is now a filled button, so it stands out.
- The End session button in a session's header shows its stop icon again; it was an empty, invisible button.
- You can pin a Bot to keep it at the top of the Bots tab and the gallery: right-click it and choose Pin.
- You can group your Bots into sections: right-click a Bot, choose Move to section, then New section.
- A section's menu in the Bots tab renames it or removes it, and you can fold any group of Bots.
- Behind the scenes: the starter kit's guide now names a reply's three parts the way the agent writes them, so it no longer confuses new readers.
- New Bot now asks for a type: Routines, the Bots you had, or PR shepherd.
- A PR shepherd watches your approved pull requests and starts a session to fix conflicts, failing checks, or review comments, then queues the merge.
- A PR shepherd merges only what a reviewer approved: a rebase is fine, but new code waits for a fresh review, and it tells you why.
- A PR shepherd tries each fix at most twice per pull request, then asks you.
- Fixed: a session on a Cursor model asks you its questions with the question form instead of in plain text, because the starter kit now points it to omp's question tool.
- Cmd+W now ends the focused session, in place of Cmd+Shift+X.
- Cmd+Shift+W now closes the window, since Cmd+W ends a session.
- End session in a session's header is now a stop icon; hover it to see its name and shortcut.
- You can click Review visuals, the eye in the Browser's toolbar, to open every page the agent asks you to look at, each in its own Browser tab.
- An agent's list of pages to review now shows as a small card in its reply.
- The Browser's tabs look like a web browser's, with the App tab pinned first and a close button on each review tab.
- Maximize Browser and Open in default browser now sit in the Browser's ⋯ menu, which leaves the address field more room.
- You can stop a session's dev server from the Browser's server menu with Stop dev server.
- The Browser's server menu now shows each dev server's command without long folder paths, as the CPU card does.
- Fixed: Settings › Source control now looks for `gh` and `gt` on the app's current `PATH`, not only the one it started with.
- Fixed: a reply that shows a screenshot keeps its suggested prompts, because the starter kit now has the agent put the screenshot above them.
- Fixed: Settings, Notes, Calendar, and Email show the sidebar's tab bar again, so a tab such as Sessions takes you back.
- Fixed: on macOS, the title bar's Back and Forward buttons now line up with the window's close, minimize, and zoom buttons, with a gap after them.

## 2026-10-29

- Fixed: a session's Changes dialog now shows line counts for files it edits in another checkout of the project from its first edit, rather than marking them S until it runs a command there.
- New: Get started walks you through setup on first launch, one step per screen in a dialog. Sign in to a model provider right there, choose how terminal sessions show, install the starter kit, connect GitHub and your tools, then start your first session from a suggested task. Close it and it waits in a bubble at the bottom right until setup is done; reopen it any time from the bubble or Cmd+K.
- When omp is not installed, the desktop app now shows the command to install it, with Copy and Retry, instead of a startup error.
- Fixed: the desktop app's starter kit now includes its model settings.
- A Bot's right sidebar now shows only Details, and Tickets once its conversation worked on a Linear issue; the PRs and Browser tabs are gone there.
- Settings, Notes, Calendar, and Email now show their list in the left sidebar without the tab bar above it.

## 2026-10-28

- The Settings sidebar now sorts its sections into Usage, General, Connections, and This workspace, and Source control providers is now just Source control.
- The command menu (Cmd+K) now finds Settings sections: type a section's name or what it holds, such as "theme" or "graphite", and press Enter to open it.
- Providers, Integrations, MCP servers, Workspaces, and Worktrees in Settings no longer repeat their name under the page header.
- Settings › Sync now counts the files the last sync received and sent instead of listing them all; click a count to see the files.
- Settings › Sync can now create a private GitHub repository for you and use it as the remote, also right after a sync fails because the remote does not exist.
- Settings › Source control can now sign Graphite in with a token pasted in the page, shows repository paths from your home folder, and no longer lists repositories in temporary folders.
- In the desktop app, Settings › Workspaces has Choose folder…, which opens the system's folder picker and adds the folder you pick.
- Settings › Files has a field above the list that narrows it to the files whose name you type.
- Settings › MCP servers no longer repeats Linear, Slack, Gmail, and Google Calendar as rows; one line names them and links to Integrations.
- The gear button and G then , now reopen the Settings section you last had open.
- In the Browser, Select element now opens a field on the element you click, so you can type a note at once; sending it adds the note and the element to the composer, and you can go on to the next element.
- Pasting a long text into the message box now attaches it as a file, Pasted text.txt, as ChatGPT and Claude do, so what you type stays readable. Its tile shows the first lines.
- A routine's message in its Bot's conversation now shows as a run card instead of a message from you: the routine's name, what triggered it, whether it was sent or how its command ended, and its output a click away, with a link to the routine. The Bots sidebar shows the routine's name in place of "You:".
- The Browser tab now picks as T3 Code does: the pointer button floats a Select, Region, Draw, and Erase switch over your app. Elements you select and boxes and lines you draw go in together with the comment you type beside them: one chip in the message box and one picture. The new camera button attaches a picture of the whole app.
- The session details sidebar, and the Browser in it, now widens to 960 pixels, as far as the conversation keeps 480.
- Behind the scenes: agents checking the desktop app now see a script's error instead of a confusing crash later, so they fix the right problem.
- Behind the scenes: merging a branch into main without a line here now stops at the merge, and a fast-forward without one warns, so the line goes on the branch instead of a fix-up after it.
- Fixed: a todo an agent files under a category you don't have now lands in your list with no category instead of failing.
- Fixed: /ship no longer refuses to put a pull request live, or to check its review boxes, when a project's settings file holds an old GitHub token; it uses your GitHub sign-in instead.
- A session running /ship now shows a Ship section in its todos card, with the current stage and a progress bar; unfold it to see every stage as a step.
- Notes, Calendar, and Email moved to buttons in the header beside the command menu, replacing the Dev and Ops switch.
- Cmd+1 through Cmd+5 now count the tabs of the sidebar's bar: Pull requests, Tickets, Bots, Sessions, and Todo.
- The Browser's Start dev server button now starts your app itself and opens it in the Browser; when it cannot, it asks the session as before.
- Fixed: plan usage failed because the app started on a Bun older than omp allows. It now starts on Bun 1.4.4.
- The workspace picker now lists each repository once, with sessions in its worktrees, such as a review's, under it instead of one workspace each.
- Sessions started in a Mac temporary folder, such as one `mktemp -d` made, are now hidden from the sidebar like those in `/tmp`.
- An issue's header now stays at the top while its details scroll, and shrinks to its title and branch, as a pull request's does.
- Fixed: the dashboard starts again after omp updates itself to a single program file.
- On a wide pane, the todos card now floats at the top right sooner, and the conversation moves left to make room for it.
- Behind the scenes: agents test the desktop app in a hidden window, so their checks no longer open windows on your screen.
- Fixed: a running session's name in the sidebar still sat a little to the right of the others; it now lines up.
- The Preview tab in the desktop app is now called Browser.
- The Browser has a Start dev server button, which asks the session to start its app so the Browser can show it.
- The Browser has a Maximize button, which fills the app's window with it, not your whole screen; press it again or Escape, even inside your app, to put it back in the sidebar.
- The Browser's Open in browser button is now called Open in default browser.
- Fixed: signing in to your app in the Browser no longer jumps to your default browser; the sign-in finishes in the Browser, and a sign-in popup opens as a small window of the app.
- Fixed: a sign-in in the Browser that comes back to your app's usual port, such as localhost:3000, now lands on the session's dev server instead, and one that goes through the app's own API, such as localhost:8000, reaches the API first.
- Fixed: the Start dev server button in the Browser showed its icon above the label instead of beside it.
- A running session's name in the sidebar no longer leaves an empty gap where its green dot used to be.
- Settings → Workflows lists your workflows, the skills tagged as one, with the command that starts each, and lets you read and edit each one in place.
  A flowchart above each workflow draws its numbered steps in order.
- The steps /ship follows now live in a ship skill, so you can change them from Settings → Workflows; /ship works as before.
- In the desktop app, the greyed Back and Forward buttons still show their tooltip, and the command menu offers Go back and Go forward, now with arrow icons, only when there is somewhere to go.
- Past sessions no longer list the quick one-off agent runs that other sessions start in the background, only sessions you had a conversation in.
- The Files, Images, and Sources sections moved from above the message box into the Todos card, at the top right of the conversation or above its messages when the window is narrow.
- Past sessions show the Todos card too, with their files, images, and sources.
- Show todos card in Settings → Preferences now hides only the todo list, so the card's Files, Images, and Sources sections stay.
- Sections you folded stay folded after the move.
- A working session no longer shows a green dot, so the blue dot alone marks a session waiting on you.
- While you are still trying out a design with an agent, it now also waits for your go on the direction before writing tests for it.
- /ship now runs an interface review before the deep code review when a pull request changes files a project lists as interface files, and holds the pull request back from going live until its fixes are pushed.
- That interface review also checks that new screens reuse the app's existing components, colors, and sizes, and look like the screens next to them, and tells you when a pull request brings a new way of showing something, such as cards for a list in an app whose lists are all tables.
- Behind the scenes: omp-agents lists its page's components and styles as interface files, so its own pull requests that change them get the interface review.
- The todos card in a session now has a lighter shadow, and you can hide it with the checklist button after the session's title or with Show todos card in Settings → Preferences.
- The todos card in a session now has a lighter shadow, never covers the conversation, sitting above it when the pane is too narrow to keep it at the side, and you can hide it with Show todos card in Settings → Preferences.
- While you are still trying out a design with an agent, it now waits for your go on the direction before running its deep code review, instead of reviewing every round of tweaks.
- A session's conversation now shows the agent's own todo list in a small card at its top right, with how many tasks are done and the one in progress; click the card to see every task.
- New in the desktop app: a Preview tab next to PRs in the right sidebar shows the app a live session runs, and an element you pick in it goes into the session's message box, with a note if you add one.
- A Bot can now create, change, pause, and delete its own routines when you ask it in its conversation, and it can't touch another Bot's routines.
- A Bot can now save or change its own job when you tell it what to do, and the Job field on its page updates.
- The Bots tab now also counts Bots with a reply you have not read, not only those asking you something.
- A Bot's right sidebar now has PRs and Tickets tabs beside Details, showing the pull requests and tickets its conversation worked on, as a session's does.
- Fixed: a short Bot name no longer shows cut off in the header of its page.
- The Files, Images, and Sources card above a session's message box now has a border, so it stands apart from the conversation.
- On the Todo page, each category in the sidebar now has a checkbox: uncheck one to hide its todos from All, Today, Needs you, and From agents, and the app remembers it when you come back.
- A Bot's page no longer lets you end its conversation, and its Delete button is now red.
- You can drag the edge of a pull request's details beside the list to make them wider or narrower, and the app keeps the width.
- The Ask about this button over selected text is now solid, so the text under it no longer shows through.
- What's new now explains each update in everyday words, and every update to omp-agents adds its own lines there.
- You can approve a pull request in one click, from its menu in the list or from the top of its details, and the button goes away once you have approved it.
- Clicking a pull request in the list now shows its details beside the list instead of replacing it, and Open as a page still gives them a page of their own.

## 2026-10-27

- New Bots tab: a Bot is a named helper with a job, a memory, and one ongoing conversation you come back to, like a chat app.
- New Bot lets you name a Bot, pick its shape and color, and start from a ready-made job such as PR reviewer or Daily retro.
- The Bots tab opens the Bot you spoke with last, and the grid button shows all your Bots as cards.
- A Bot's conversation reads like a chat, with only your messages and its replies, and its job, memory, and routines sit in the right sidebar.
- In a Bot's message box, typing @ lets you mention people, teams, files, todos, tickets, pull requests, emails, events, and sessions, and People now includes your Linear teammates.
- Every routine now belongs to a Bot and either sends that Bot a message or runs a command, so the separate Routines tab is gone.
- Routines can now start on their own when a Slack message waits on you, a pull request waits on you, a calendar event is about to start, or unread mail arrives.
- A Bot's routines card lists each routine with Run now, a pause switch, a countdown to its next run, and its last 10 runs as colored ticks.
- Settings › Preferences can now play a sound with notifications, and lets you choose whether a finished turn notifies you.
- Settings › Decisions shows your project's recorded decisions as a timeline, with only the ones still in force by default.
- The Inbox page is now called Email.
- The desktop app's title bar has Back and Forward buttons, also on Cmd+[ and Cmd+], and moving between sessions is now Cmd+Alt with the arrow keys.
- On the tickets page, the sessions working on an issue now sit in a dropdown in its details.
- Sync now also carries your notes, todos, preferences, workspaces, and hidden calendars to your other computers, and every window shares the same preferences.
- The changes card above the message box has a new Sources section listing the web pages a session opened, each with its site's icon.
- Notes now leave space around headings, lists, quotes, and code blocks, so they are easier to read.
- The What's new button at the top right lists recent features, with a blue dot when there are ones you haven't seen.
- Starting a session on a ticket, pull request, or todo that another session already works on is now refused, with a link to that session.
- When your GitHub hourly allowance runs low, the Pull requests page pauses its refreshes and says when they resume, so your agents can keep working.
- Fixed: a session's details now show the pull request it opened before one its first message only linked to.
- Behind the scenes: the Pull requests list now uses about a twenty-fifth of the GitHub allowance it used before.
- Behind the scenes: quick actions on pull requests and tickets start in the branch's own folder, and agents can no longer wipe a pull request's description by mistake.
- Behind the scenes: agents suggest more useful next prompts, and the agent starter kit gained upkeep scripts and a checklist for setting up a new computer.

## 2026-10-26

- A Dev and Ops switch in the header splits the sidebar tabs into two groups, and Settings moved to the gear button in the header.
- Cmd+1 through Cmd+4 now count only the tabs of the group the switch shows.
- The command menu and the bell moved to the desktop app's title bar and the page headers.
- The dashboard now runs only in the desktop app, and a browser tab can no longer sign in.
- Opening a ticket shows its details beside the list, laid out like a pull request, and Cmd+N creates a ticket on the tickets page.
- Click a session's title in its header to rename it.
- The folder and branch pickers and the context usage ring now sit inside the message box.
- Session rows are simpler: the status dot comes before the title, and the workspace name sits beside the age.
- In the Pull requests list you can change a pull request's reviewers from its row and right-click a row for its menu, and the reviewer pickers show people's pictures and names.
- Right-click a todo, a note, or a mail conversation for a menu of actions.
- Hover the CPU reading in the status bar to see what each session runs, with a Stop button for each, in place of the Processes tab.
- Settings › Activity shows which pages, shortcuts, and commands you used over the last 30 days, and which features you never touch.
- Settings › Worktrees shows totals and disk use, filters for All, Merged, and Removable, and lets you act on several rows at once.
- The Calendar's Show routines checkbox hides routine runs from the month.
- Agents can now edit, file, and delete your todos, not only add them.
- A session's header now links only the pull requests and tickets it actually worked on.
- The Projects page is gone.
- Behind the scenes: two sessions sharing a folder can no longer overwrite each other's unsaved work.
- Behind the scenes: a security, speed, and quality review made the dashboard safer and quicker to load.
- Behind the scenes: checked against omp 18.12.6.

## 2026-10-23

- Conversations can now show diagrams and charts.
- An agent's file edits now show as cards with the lines it removed and added.
- A changes card above the message box gathers the files and images a session touched.
- New Notes page, G then N, for your own notes, which agents can add to as well.
- The new session screen lists your todos, recent sessions, and pull requests waiting on you, so you can pick one up in one click.
- The clock button in the message box opens Chat history, which gathers every prompt you sent in a session.
- Conversations are narrower and easier to read, the buttons by a session's title appear on hover, and pointing at a link shows its address at the bottom of the window.
- When sessions stop in the middle of their work, the bell offers Continue all to pick them all back up.
- A session that stops on a dropped connection or a brief provider error now tries again on its own, waiting longer each time.
- Rebase on main, in a pull request's menu, brings it up to date with no agent involved, and Rebase N behind does it for every pull request that is behind.
- A session's details list the programs it runs, each with Stop, and the dashboard stops them for you once the session has sat idle for a while.
- Fixed: ending one session no longer stops the browser and helpers that other sessions share.
- Behind the scenes: the usage guides are now one page per feature, so agents find the right one faster.

## 2026-10-22

- Pull request details have a new look, with a cleaner header, Summary, Timeline, and Code tabs, and a popover for checks.
- In the Code tab you can mark files as Viewed and comment on a line or a range of lines.
- A round button at the bottom right of a pull request's details opens a box to comment, or to submit a review that comments, approves, or requests changes.
- The Check out menu opens a pull request in a separate folder with a new session, or checks it out in your repository.
- The Board view shows pull requests in columns by whose move it is, and dragging a card to another column does the step that moves it there.
- Todo, session, ticket, and pull request chips in your sent messages now open inside the dashboard.
- Behind the scenes: agents check more carefully before they publish a pull request, such as a ticked browser proof box when the pull request asks for one.

## 2026-10-21

- Select text in a conversation or in a pull request's code and choose Ask about this to ask a side question without disturbing the session.
- The Review quick action now saves its findings as a review draft that you check, edit, and post yourself, from the Review draft tab.
- Settings › Sync keeps your setup the same on all your computers, through a private Git repository of yours.
- You can select images a session made and attach them to its pull request or Linear issue.
- Open PR now goes away as soon as the session opens its pull request.
- Buttons and colors got a refreshed look.
- Behind the scenes: agents now work directly in the branch's folder when it is not main.

## 2026-10-20

- Sessions started from the dashboard keep running when the dashboard restarts or crashes.
- You get a notification when a session asks you something or finishes, and the Dock icon counts the sessions waiting on you.
- Open PR, in a working session's header and in the command menu, asks the agent to commit, review its work, and open a pull request.
- Merge now waits until GitHub allows it, Merge stack merges a whole stack from the bottom up, and After a merge ends the finished sessions and tidies up after them.
- Update dashboard, from the bell or the command menu, loads the newest version and restarts in place.
- A session stopped by a provider's usage limit now continues on its own when the limit resets.
- Each message box keeps what you typed but didn't send, per session, when you switch away or reload.
- Images and videos from an agent's tools or named in its messages now show in the conversation, and one viewer steps through them all.
- An agent's questions now come as one form, one question at a time, with checkboxes where several answers fit.
- Session rows are tidier, their actions open on right-click, and a button next to a session's title copies its ID.
- Picking several suggested prompts sends them together as one list.
- Fixed: a pull request that is ready but behind its base now says so instead of Ready to merge.
- Fixed: routines keep track of their sessions after the dashboard restarts.
- Behind the scenes: every update to the main code now ships a new version, and agents got a glossary and a log of past decisions.

## 2026-10-19

- You can connect several Gmail and Google Calendar accounts, link each to workspaces, and see their mail and events together.
- Cmd+N starts a new session, Cmd+F searches sessions, and the sidebar shows these keys.
- Clicking the branch in a session's header copies its name and frees it to be checked out elsewhere.
- Tool calls have a new compact look, and code blocks show their language with a copy button.
- In the desktop app, right-click an image to copy it.
- Fixed: the pull request tabs in the sidebar no longer scroll sideways.
- Behind the scenes: agents no longer inherit the dashboard's own settings, and several guides were corrected.
