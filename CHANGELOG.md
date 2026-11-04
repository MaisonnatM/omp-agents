# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines when you click What's new, the sparkles button at the top right.

## 2026-11-04

- Settings › Storage can now prune the uv, pnpm, and bun package caches. Packages no project needs are deleted and download again when a project installs them, while the files running tools such as MCP servers use are kept.
- A Bot can now end a run quietly when it found nothing for you, so a routine run with nothing new no longer notifies you or marks the Bot unread. The PR shepherd's starting job asks for this; add "When a run finds nothing for me, call stay_quiet." to an existing Bot's job.
- Behind the scenes: the design reviewer agent now checks that a page's title and header buttons stay visible at every width with the sidebars open.
- Bots can now message each other: one Bot hands work to another, which wakes up, does it, and can answer back. The message shows as a card with the sender's face in the other Bot's conversation, and as Messaged and the other Bot's name in the sender's. One Bot can send another at most 20 messages an hour, so two Bots cannot keep answering each other forever.
- A new personal session no longer shows Your assistant under the composer, with what it remembers and your recent personal sessions. Its memory stays in a personal session's Memory tab, and past personal sessions stay in Past sessions.
- The starter kit sends every interface change through a design workflow: agents look at your app's own screens and at reference designs before the first edit, offer five structurally different options for a redesign, and have a separate reviewer screenshot and measure the result before you see it.
- Replay from here and Compare replay are gone from the trajectory and the pane header.
- Behind the scenes: the starter kit no longer includes the request log, which saved every request sent to a model so a turn could be replayed.
- Ask about this is gone. Selecting text in a conversation, a past session, or a pull request's code no longer offers a side discussion.
- Bots no longer offer the Router type or its Tasks tab. A Router you saved before this update no longer shows, and your other Bots load as before.
- Settings › Files now lists your omp files as folders, the way they sit on disk, so skills from different places no longer look alike and big folders such as commands and skills stay closed until you open them. Each skill shows the start of its description under its name. omp memory's stored files use the same folders.
- Settings › Files now shows Markdown files such as skills and AGENTS.md formatted, with their name, description, and other header values listed on top; Source shows the raw text. Config files show with line numbers and colors, and long lines wrap instead of running off the edge.
- The starter kit's project memory tool can now read and write another repository's memory, so one session, such as a Bot that reviews every project's sessions, keeps each repository's memory up to date.
- When updating omp from its notice installs omp's standalone app but leaves behind the copy your sessions run, the notice now says so and names the command that updates that copy, instead of omp's own success message.
- Personal no longer shows up among your workspaces, in the directory picker or in the sidebar's workspace picker. Open a personal session from **Personal** in the sidebar or with Cmd+Shift+P.
- New session now keeps the composer at the bottom of the page, as in a running session, under the omp logo and a question naming the folder you work in. Starters for work you start often, such as Run the dev server, Ship ENG-2722, or Shepherd my PRs, show inside the composer as the same numbered list a session suggests after a reply. Press a starter's number or click it to put its prompt in the composer, where you can edit it before you send.
- Agents can now add reminders to the Calendar page, such as a time to check how a change performed, and you get a notice 10 minutes before each one. Clicking a reminder, on the Calendar page or in its notice, opens the session that added it.
- New session now puts the composer near the top of the page, with the directory and branch just above it, and a row of starters under it for work you start often, such as **Run the dev server**, **Ship ENG-2722**, or **Shepherd my PRs**, the best fit for now first. Hover a starter to see its full prompt, and click it to put that prompt in the composer, where you can edit it before you send.
- The New session page no longer shows the board of todos, past sessions, and pull requests. Your todos stay on the Todo page, past sessions in the sidebar, and pull requests on the Pull requests page.
- The starter kit now has agents open each reply with the answer in bold, then add a Needs you, Not verified, or Done line only when it has something to say, instead of fixed sections that often read "None".
- Settings › Storage now lists sandboxes of ended tasks with leftover changes, with the most space they can take, and can remove them.
- Their row starts unchecked, and Clean up warns that edits omp did not bring back to your checkout are lost.
- You can zoom an image opened large, an expanded chart or diagram, and an image opened from a file path, as you zoom a web page: the − and + buttons or keys, a pinch, or Cmd or Ctrl with the scroll wheel. Click the zoom level or press 0 to fit it again, and drag to move around.
- The images in a message, in place or as thumbnails under it, now open large, and the arrows or the Left and Right keys step through the message's other images.
- Private is now a pill at the top right of the New session page. Turned on, it fills dark and the page says what ending the session deletes and what stays.
- A private session's sidebar row and header now show a dark Private chip, easier to spot than the old lock.
- The sidebar has a Personal item under New session, also on Cmd+Shift+P. It opens a page that shows what your assistant remembers and your recent personal sessions.
- The starter kit now sends agents to the review steps before they mark a pull request ready or merge it, so they stop running into the review check first.
- The starter kit now tells agents to write out the full address of any server they start for you, ready to click, instead of only its port number.

## 2026-11-03

- /ship no longer holds back a pull request over an unchecked Browser proof box when the change touches none of the project's interface files. Projects that list their interface files still need the box checked for changes to them, and a worktree reads that list from the main checkout, so you can keep it out of a shared repository.
- The starter kit tells agents how to sign in the omp browser with saved cookies, and that its page object is Puppeteer, not Playwright.
- When Rebase on main stops at a conflict, its message now names the first conflicting files. Resolve conflicts and Fix CI and conflicts sessions also get clear steps for each commit that stops, so they no longer retry a step that a project's own setup rejects.
- Update dashboard now also updates the omp starter kit files you never changed, so new omp sessions get the kit's latest fixes. Files you edited keep your version, and installing the starter kit again works the same way.
- Sessions started by Fix CI, Fix CI and conflicts, Resolve conflicts, and Address comments now end themselves once the fix is pushed. A session that could not finish stays open and says what is left.
- The starter kit tells agents to present a plan as a short decision card: what you asked, their answer, and what you decide, then at most three bullets, with a flow diagram when the plan changes a workflow. The card is the whole reply, with no summary or evidence list around it.
- /ship plans now list the existing code they reuse, and a large change gets a pass that swaps rebuilt pieces for the ones the project already has before the draft PR opens.
- New session can start a private session: turn on Private, the lock beside the skill toggle, and the session is deleted with everything it wrote when it ends. It never shows in Past sessions or History, and omp memory does not learn from it.
- Pick Personal in a new session's directory menu for help with your own life, such as meals or plans. Personal sessions share a memory: tell one something about yourself and every later personal session knows it. The session's details show what it remembers.
- The paid Cursor fallback patch for omp now applies to omp 18.16.0.
- omp-agents is now tested with omp 18.16.0.
- Context sources in Analytics recount their tokens from the session files after each omp update, since a new omp may count tokens differently.
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
- Rebase on main now shows its progress at once: a toast with a spinner and a running clock says it is queued or rebasing and which step it is on, such as fetching or pushing through the checks, then turns into how it ended, and the pull request's badge reads Queued, Rebasing, or Starting while a rebase or a quick action is under way, instead of nothing until the end.
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
- Settings has a new omp memory section: pick where omp keeps what it learns across sessions, switch Auto-learn, and see what a new session gets.
- In omp memory, read and edit what omp remembers in this folder, forget one memory or all of them, and rebuild the summary.
- New: omp memory in Settings.
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
