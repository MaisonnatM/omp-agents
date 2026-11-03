# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines when you click What's new, the sparkles button at the top right.

## 2026-11-03

- The Todos card now lists a session's subagents with their status, so you can open or stop one without scrolling back to where it started.
- Fixed: a session that replied while a background job it started was still running no longer shows as working until the job ends. It shows idle and tells you it replied, and shows working again when the job's result wakes it.
- You can hide or show the todos card with the checklist toggle in a session's header, between Open PR and End session; it hides the whole card, its files, images, and sources too, as Show todos card in Settings → Preferences now does.
- The checklist toggle looks pressed while the todos card shows, and appears only while the card has something to show, such as todos, ship steps, subagents, files, images, or sources.
- Agents can now run git in a throwaway folder they just made with `mktemp`, such as `d=$(mktemp -d); cd $d`, without being told to spell out its path.
- Fixed: images you send with a skill, such as the first message of a new session with a pinned skill, now stay in the conversation instead of disappearing once the agent starts. Past sessions show them again too.
- Images you send now show as smaller thumbnails in the conversation, the same size as the agent's screenshots. Click one to open it full size, as with screenshots.

## 2026-11-02

- Fixed: a session that omp went on with in a new file, because another omp window had it open, now shows once in Past sessions instead of twice.
- Fixed: renaming a past session that another omp window is writing now says to rename it there, instead of risking a clash with that window.
- Fixed: a question that asks for a secret, such as an API key, now shows dots for what you type, and the dashboard never saves it.
- Fixed: Resume on a past session that omp went on with in a new file now opens that newer file, with the latest turns, instead of the older one.
- The paid Cursor fallback patch now applies to omp 18.15.0. Subagents started with their own model keep it, and a model with no sign-in tries included plans before paying.
- Behind the scenes: checked against omp 18.15.0, which keeps the daily compression log that Storage reads.
- In a narrow window, such as a phone, an open sidebar now slides over the page instead of squeezing it to a sliver; picking a page or tapping outside closes it.
- Behind the scenes: every test now ignores the session it runs from, so a test added later cannot stamp an agent's session on its commits and fail "Merge on main".
- Settings, Workspaces: long folder paths now wrap onto a second line instead of being cut off, in both the workspace list and Trusted projects.
- Agents working in a separate copy of a project can no longer read or edit the main copy by mistake through a short file path; they are told the full path to use instead.
- Long conversations now scroll and update more smoothly while an agent writes, since the dashboard no longer redraws every earlier message for each new word.
- Fixed: the dashboard no longer freezes for a few seconds while it stops a session that stopped answering.
- Agents in a repository now start each file edit faster, since the check that keeps sessions out of each other's checkout no longer runs git for every edit.
- Behind the scenes: the dashboard checks running processes, lists models, and reads a session's changed files less often, so several open windows cost less.
- Fixed: a question an agent asks you, such as whether to mark its pull request ready, no longer disappears when the dashboard updates and restarts, which left the session waiting on an answer you could not give.
- A /ship session now asks you once before marking its pull request ready for review, instead of twice.
- A routine scheduled only on some weekdays now ignores its triggers on the other days, so a weekdays-only routine no longer wakes on weekend pull requests or Slack messages.
- A Router's task whose session crashes or is killed mid-step is now restarted right away instead of waiting for your review; ending its session yourself still moves it to Needs you.
- A Router can now start a task on a pull request it read about or whose branch its own folder holds; its own conversation no longer counts as working on that pull request.
- A /ship session that ticks a review box and moves on right away is no longer refused for a missing box: the check reads the pull request once more before it says no.
- The Inbox page is gone: the Sessions sidebar no longer shows its row and G then I no longer opens it, while the notification bell and the Sessions tab's count of sessions that need you stay.
- The context button in the composer, and any button whose label holds an icon, now centers its icon instead of sitting a few pixels high.
- New Bot type, Router: a Bot named Atlas that answers at once and hands real work to background sessions, which its new Tasks tab groups into Needs you, In progress, and Done.
- A Router's task moves to Needs you when its session finishes, and the Router tells you in one line; Mark done and Stop in a task's menu close it.
- A Router's task that gets stuck, repeats the same step, or whose session dies is restarted with what went wrong; after two restarts it is stopped and the Router tells you why.
- A task the Router cannot restart is stopped at once, with the reason in the Tasks tab, and the Router tells you.
- A Router's task in the middle of a long build or test run gets 30 minutes before it counts as stuck, instead of six.
- A new Router comes with a Team events routine, so it hears about Slack messages waiting on you and pull requests that need your move.
- A Router skips team messages that need nothing, such as "thanks!", and its next run tells you how many it skipped.
- News on a pull request or Slack thread a Router's task follows goes straight to that task, without waking the Router.
- A Router starts a quiet task for a bug report nobody answered, which posts in the thread only once it has a result.
- You can click an image in a pull request's description or comments to open it large.
- Diff code blocks in a pull request's description and comments now show as colored diffs, one card per file, with line numbers when the block has them.
- Fixed: a file or image an agent names relative to a folder it moved into with `cd` now opens, instead of showing "No file".
- Fixed: the Inbox no longer jumps to a new question while you work on another item.
- Fixed: on a narrow window, Close or Escape in the Inbox brings the list back.
- Fixed: the Inbox lists questions from pinned sessions first, as the sidebar does.
- Fixed: the Inbox no longer offers End session for a session you can only watch.
- Fixed: a pull request's quick action in the Inbox keeps you in the Inbox.
- Fixed: Open on a stopped-sessions notice now opens the first session it names.
- Fixed: the Sessions tab's count now matches the Inbox, leaving out turns you already read.
- Behind the scenes: What's new now drops its oldest days on its own when the list grows too long, so new changes always fit.
- Fixed: a turn a terminal session finished stays in the Inbox when the dashboard restarts, and one it finished while the dashboard was stopped shows up once it starts again.
- The Inbox shows a session's whole conversation and message box, R puts the cursor there, and opening an item leaves it unread.
- Inbox buttons show a spinner, the 1 to 9 and 0 keys send through the message box, and the next item opens once the item is done.
- The starter kit's models match the current setup: Opus picks its own effort, Haiku 5.5 runs cheap roles, fallbacks use newer Codex models, and OpenRouter is gone.
- The starter kit's /poteto-mode now finds pstack's poteto style where the pstack plugin actually installs it, so it works on a new computer.
- Fixed: finished turns stay in the Inbox when the dashboard restarts, such as after an update, and a turn that finishes while the dashboard is stopped shows up once it starts again.
- Fixed: opening an Inbox item no longer marks the session it replaces on screen as read.
- You can dictate a prompt: press the microphone in the message box, or Cmd+Shift+M, speak, and your words land where your cursor was, ready for you to check before you send.
- The first time you dictate, the message box offers to turn dictation on, and says where your speech is turned into text.
- Settings now has an Extensions library for installed packages, marketplace catalogs, registry skills, and their contributions, with native install, update, enable, disable, and uninstall actions.
- Settings › Extensions manages plugins and registry skills and previews their files.
- Packaged workflows open read-only, with a link to manage their package.
- Settings › Agents previews new-session agents, with model overrides and execution defaults.
- Clean up omp's disk use from the disk reading in the bottom bar: review files, confirm each cleanup run, and edit the rules in Settings, Storage.
- A long folder name in the message box now ends in … instead of running past the box and under the model switch.
- /ship now plans before it builds: the agent compares up to three ways to do the work, keeps the best, and posts that plan on the Linear issue, or in the pull request when there is no issue.
- /ship no longer needs a Linear ticket: it uses the one you name or one that matches the work, and otherwise ships without one instead of creating a ticket.
- Agents now start /ship on their own when your request will end in a pull request, and say so in their first reply; say "no ship" to work without it.
- The Ship card shows the new Plan step between Ticket and Implement.
- Settings has a new omp settings section: omp's own settings in omp's tabs, with search, saved to your config.yml as you change them.
- In omp settings, a dot marks a setting changed from omp's default, Reset puts it back, and a setting this workspace sets shows locked, with a link to its file.
- The context ring now opens Compact, Shake out, Hand off, and a session-only Auto-compact switch.
- The model menu has an Advisor switch, and the session header lets you set, edit, pause, resume, or clear a goal with an optional token budget.
- You can drag a Bot in the Bots tab onto Pinned, a section, or Other Bots.
- Fixed: routines no longer start during the few seconds a sleeping Mac wakes on its own for Power Nap; they wait until you wake it, and news that came in overnight starts one run.
- Fixed: a routine's command no longer counts time the Mac spent asleep toward its 10-minute limit, and when the Mac slept during a run, the routine's message to the Bot says for how long.
- New Inbox page, at the top of the Sessions sidebar or G then I, lists everything that waits on you: sessions asking a question, finished turns with their suggested prompts, your pull request moves, Slack messages, and stopped sessions.
- You can work the Inbox from the keyboard: J and K move, 1 to 9 answer or send a suggestion, 0 sends every suggestion, R replies, D marks done, E ends the session, and the next item opens on its own.
- An Inbox notice offers the same button as the notices bell: a pull request's quick action, Merge, or Continue all.
- When a quick action cannot start because another session already works on the same pull request, issue, or todo, the note now names that session and offers Open session and End it and start again, instead of a long error.

## 2026-11-01

- Agents can now land work from a separate worktree while their session sits on main, and the landing report names the checks that passed.
- A new session no longer opens with long grey lists of the tools its connected services added; the conversation starts with your message.
- Fixed: when your first message starts with /, to call a skill or a command, the pinned skill's button now hides instead of showing its name crossed out.
- Fixed: hovering the pinned skill's greyed-out button now says why, when the folder has no skill of that name.
- Fixed: after a session or a Bot moved up or down in the sidebar, hovering, selecting, or right-clicking a row could light up the row next to it, so it looked like the wrong session was picked.
- Fixed: a click just between two sidebar rows could open a session from elsewhere in the list after the list reordered.
- Behind the scenes: the checks for "Merge on main" now pass when an agent runs them from inside a session.
- New Bot now starts on a new type, Bot designer, named Dr Eggbot with its job filled in, adapted from Lauren Tan's Dr Eggbot Grok Bot.
- A Bot designer asks you a few short questions about the Bot you want, then creates it for you, and the new Bot shows in the Bots tab.
- Switching a new Bot's type swaps the name and job that type filled in, and keeps any you typed yourself.

## 2026-10-31

- Before a session runs a project's own agent code, such as its extensions, tools, or MCP servers, the dashboard now asks you to trust it once, and asks again when a piece is new or has changed.
- Settings › Workspaces now lists the projects you trusted, with Stop trusting to have the next session there ask again.
- With the starter kit, when you say "Merge on main", the agent now merges your branch into a fresh copy of main, runs the project's checks on the result, and only then pushes.
- Agents can no longer push or merge straight into main in a project set up this way, so a change that breaks the checks never lands.
- When a check stops a merge, the agent is told which tests failed, even in a long test run, so it can fix them without running everything again.
- A PR shepherd Bot asked to merge a pull request in a project set up this way now starts a session that lands it the same way, instead of merging it on GitHub without running the checks on the result.
- Fixed: with the starter kit on the current omp, the tool agents use to edit a pull request's description loads again, instead of an error at the start of every session.
- With the starter kit, sessions in the same project now share a memory: a new session starts with the project's remembered decisions, facts, and lessons and the work that last landed, and a running one hears when another session lands work or changes the memory, starting with work that touches the same files.

## 2026-10-30

- Fixed: Remove merged in Settings › Worktrees, and ending a session, no longer delete a worktree that another running session still works in, even a session started in another project.
- The server log now names each worktree it removes and what asked for it.
- After you run the thermonuclear or interface review yourself on a pull request, the agent now ticks its review checkbox once the fixes are pushed, so marking the pull request ready is no longer blocked for a missing tick.
- When an agent builds a prototype or design screenshots, it keeps them in its own copy of the project and serves the prototype so it stays up, so they no longer disappear and get rebuilt from memory.
- Behind the scenes: the starter kit tells sessions on Cursor models how to run commands, search files, and open skills, so they stop waiting an hour on a command, failing searches, and dumping whole skills.
- When a prototype or a page change is ready, the agent now starts the app itself and gives you the pages to open, with screenshots it checked first, and "make it live" gets you that link instead of a merge.
- Behind the scenes: the pull request rebase tests build their repositories once and copy them for each test, and wait up to 30 seconds, so they pass when the machine is busy.
- Fixed: a helper agent that works on its own copy of a repository now puts its changes back only where its agent says, and the starter kit refuses to put them in your main copy while it is on main, keeping them aside for you instead.
- When an agent shows you design options, it names each one, such as Mode chip, and uses that same name in previews, Slack posts, tickets, pull requests, and suggested prompts, so a number never points at the wrong design.
- A Bot's details now have their own Routines tab, which lists its routines and counts them on the tab.
- A Bot's Details tab now shows its Usage: the tokens its conversation used and what they would cost at list price, with its requests and cache hit rate.
- Putting a pull request live from another folder now checks it in that folder, so the checks read the right pull request and its own review rules.
- Putting live a pull request of another of your repositories is refused with the folder to run it from, where it used to skip the review checks.
- A todo can name the workspace it is about, such as yampa or omp-agents: pick it from the open todo's Workspace button, and its row shows the workspace's name.
- Work on it, Plan it, Start session, and the new-session board start a todo's session in its workspace instead of the sidebar's.
- A todo an agent adds belongs to the workspace that session runs in, unless the agent names another.
- With a workspace picked at the top of the sidebar, the Todo lists and their counts show only that workspace's todos; All workspaces shows every todo.
- When a session finds its work belongs in another project, it now moves itself there once its turn ends, and the sidebar follows; before, it asked you to type /move.
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
