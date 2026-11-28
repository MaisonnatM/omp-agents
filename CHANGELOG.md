# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines in Settings › What's new.

## 2026-11-28

- A Board task that could not start because you have not trusted its project's agent code now says Review and trust to try again.
- Its thread has a Review and trust button that opens the trust dialog; once you trust the code, the Board task starts again on its own.
- With omp 19.1 or newer, refreshing an MCP server's tools, or changing its settings, asks the server again instead of showing the list omp kept from earlier.

## 2026-11-27

- The left sidebar no longer has a Pull requests row; open pull requests from a Workspace's Board, where its Pull requests tab stays.
- Threads is now the first row of the left sidebar, as in Slack: it lists every Board thread with replies across all Workspaces, newest reply first, with a count of those you have not read. Click one to open its thread beside the list and reply there.
- Each Workspace's Board has quick links, as a Slack channel's bookmarks: a row under the tabs where **Add a quick link** saves a web address with a name, a click opens it in your browser, and a right-click edits, copies, or removes it.
- Fixed: a pull request no longer shows Fix CI when its only red check is an older run that a newer run already replaced, such as a cancelled run of a workflow that ran again and passed. Its checks list also shows just the latest run of each check, like GitHub does.
- The Memory page has a **Glossary** tab: pick a repository to see the terms its `GLOSSARY.md` defines in a table, by section, with the words to avoid for each, search them, and click one to read it in full.
- A Workspace's Routines tab now lists its routines in a column on the left and shows the one you click on the right, with its runs, task, schedule, Run now, and switch. New routine and Edit open their form on the right too, beside the list.
- A Workspace's Sessions tab now lists its sessions in a column on the left and shows the one you click on the right, like a mail app, instead of leaving the Board to open it. With none picked, it shows the latest session. The list shows only sessions: projects stay in their own tab, so a project's sessions list with the others, and the Workspace's folder is gone since the tab already names it.
- The "New session in …" row at the top of the left sidebar and the + New session button on each Workspace are gone; the New session keyboard shortcut still opens a new session.
- Fixed: when a Board task's session asks you something, such as whether to put a pull request live, the Board thread now shows the question with its answer buttons above the reply box, so you can answer it there instead of opening the session's tab.
- In the `general` Workspace's Sessions tab, each session shows the folder it ran in, such as `~/code`, `~/tmp`, or `~`, beside its name.
- The tabs across the top of the window are gone: one page shows at a time, and Back and Forward walk the window's history again. The details sidebar keeps its tabs. Cmd+W, Cmd+T, Cmd+1 to 9, Ctrl+Tab, and the other tab keys no longer do anything in the dashboard.
- In the `general` Workspace's Sessions tab, each session shows the folder it ran in, such as `~/tmp` or `~`, beside its name; sessions run in `~/code` itself show none.
- The Board is now the left sidebar's only view: the Sessions | Board switch is gone. The page rows and your pinned sessions sit above the Workspaces, and with no session open the window shows the Board.
- Each Workspace's Board has a Sessions tab with its live, interrupted, waiting, and past sessions, search, and Resume all. Opening a session marks its Workspace in the sidebar, and next and previous session stay in that Workspace.
- With the Board turned off, the sidebar lists the sessions as before.
- On Pull requests, a row whose CI fails now names the failing checks, such as "failing: pytest, lint", instead of only "checks failing". Hover to read the full list.
- New: a `general` Workspace, pinned first on the Board, gathers every session you ran outside a repository, in `~/code`, `~/tmp`, or your home folder. Posting there starts the session in `~/code`, with no worktree or branch.
- Fixed: right after the dashboard starts, a session that ran in a Board task's or other worktree folder, such as `board-61` or `home-design-fixes`, no longer shows that folder as a Workspace of its own until every past conversation has been read; it counts in its repository from the first list.
- On the Board, a blue pill at the top or bottom edge says how many unread threads sit out of view, as Slack does. Click it to jump to the nearest one, or press Mark all read.
- In a Board thread, replies that come while you read further up show a blue "new replies" pill at the bottom. Click it to jump to them.
- Settings › Resources now names a session no dashboard lists by its title, as Past does, with its port beside it, instead of only its port.
- Memory pressure now reads high only when less than a fifth of memory is free or the Mac is swapping, not whenever macOS raises its own early warning, so Board tasks and routines no longer wait with plenty of memory left.
- Settings › Resources' chart now has a legend and a scale up to the Mac's full memory, and its always-zero Builds and tests figure is gone.
- Settings › Resources now shows what each session really holds, counting memory macOS compressed or moved to swap; an idle session used to look ten times smaller than it is.
- A Board task or routine run that waits because memory is low now says so on the Board, with the reason, until it starts.
- Sessions a dashboard can no longer list, such as old Bot conversations, now end on their own 10 minutes after the dashboard starts, instead of holding memory forever. Their conversation stays under Past.
- Idle private sessions now stop after the same hours as other idle sessions. A notification says so 5 minutes before, because ending a private session deletes it.
- When the Mac runs low on memory, the dashboard stops idle things one at a time, cheapest first, until memory is fine again. Board tasks and routine runs wait meanwhile. Busy sessions are never stopped, and a session you start yourself is never refused.
- Settings › Resources shows memory pressure and swap over the last 24 hours, what each session uses with a Stop button, what would stop next, and every automatic stop. The sidebar's foot shows the pressure at a glance.
- MCP servers now start in a session only when it first uses one of their tools, and stop after 10 idle minutes.
- On the Board tab, drag a Workspace up or down the sidebar to put the list in your own order, as in Slack, or focus it and press Alt+Shift+↑ or ↓. The order follows you to every machine through Settings › Sync, and a new Workspace shows at the bottom.
- Each routine has its own face again, a colored shape with two eyes like the old Bots had, on its Board messages and in the Routines tab, so you can tell routines apart at a glance.
- A routine copied into every Workspace now follows the original: editing the original's name, instructions, triggers, or model updates every copy, while each copy keeps its own schedule and on/off switch. Press Detach on a copy, or change its instructions, to make it your own again. Copies that still match their original start following it on the next restart.
- The blue count beside a workspace now says everything waiting on you there: its sessions that need you plus its Board threads with replies you have not read. The Sessions tab, the Board tab, and the Dock badge all show the same count.
- The Board tab's sidebar shows the count of what waits on you instead of ready Board tasks, marks each Workspace with a # as the Board's header does, and no longer lists sessions under each Workspace; they stay on the Sessions tab and in each Board thread.
- The Dock badge no longer counts sessions the sidebar hides, such as ones in `/tmp` or a hidden workspace.
- Your agents now keep a short list of your own words and what you mean by them, and add to it whenever you correct one, so every new session understands you the same way.
- A new routine, Learn my words, reads what you typed each day at 7 pm and adds the words you use your own way to that list, with words that only hold in one Workspace under its name.
- Notifications has a Clear all button beside Mark all as read: click it, then Clear N? within three seconds, to clear every notification the tab, filters, and search show.
- Pull requests has a Merge N ready button: it puts every pull request of yours that is ready to merge, or will be once its checks pass, into the merge queue, stacks bottom first, and each one merges once GitHub allows it.
- On Pull requests, each repository under Display, Repositories… has a Keep rebased switch: while it is on, the dashboard rebases your pull requests there once they fall behind, within a couple of minutes and even with the page closed, and a notification says when one conflicts or fails.
- On the Board, a long message a routine posted now shows its first lines only, with Show more to read the rest.
- On the Board, a message whose thread has replies you haven't read now has a light blue background.

- The Routines notification now appears only when a routine run errors.
- A routine run that was shorter than usual, started late, or ended with no reply no longer raises a notification.
- Replying on a done Board task, or picking one of its suggestions, now goes back to the session that did the work, with its whole conversation, instead of starting a new session that re-reads the thread. A new session still starts when that one cannot come back, or after you closed the task.
- Settings › Providers can now order two sign-ins of the same email, such as a team and a personal organization; omp tells them apart by organization.
- Suggested prompts above the composer now use the row's full width. The send, edit, and mark keys show over the end of the hovered row instead of cutting every prompt short.
- A routine's run no longer posts long replies on its Board thread. It finishes like a /ship report: a bold outcome line, a few short bullets, then Needs you, Not verified, and Done lines when they apply.
- A Workspace's Board tabs now run Messages, Pull requests, Projects, Routines, Memory, Settings.
- Fixed: the ship workflow no longer refuses a session's draft or ready step when the session started outside the pull request's folder. It now checks the folder where the session ran its tests.

## 2026-11-26

- Interrupted sessions no longer show under their workspace in the sidebar. **Resume all** in the Workspaces header still brings them back.
- A failed check in a pull request's checks list now says why under its name, such as the failing test's error, so you see what broke without opening GitHub.
- A routine's run now reports in a few short lines; when it has more to say, the details go in a reply on its Board thread first.
- Terminal sessions you can only watch no longer show in the sidebar or anywhere else; one appears once it grants you control.
- A routine can now be added to every Workspace: turn on **Add to every new Workspace** in its editor, and it is copied into each repository you work in that lacks it, now and as you start working in new ones. Each copy is its own routine, and one you delete does not come back.
- The Board's tests now catch it if two quick replies to a stopped session ever start waking it at the same time again.
- Bots are gone. Each routine now belongs to one Workspace, and every run posts a Board task there, so a fresh session does the work on its own branch and you can merge it from the Board.
- A routine whose last Board task is still open replies on it instead of posting a new one.
- A run that finds nothing to report closes its Board task quietly, without a notification.
- Each Workspace on the Board has a Routines tab, in place of the Bots tab, where you make and edit its routines and pick their model.
- Your Bots' routines moved to their Workspaces, each carrying its Bot's job and memory in its prompt. The Bots gallery, Bot designer, PR shepherd, and Bot messages are removed.
- Any session can now create and edit the routines of its own Workspace.
- A Board task whose session could not start now says why, with "Reply to try again", instead of "Starting a session…" forever; a session that keeps crashing stops after three tries the same way.
- **Close task** on a Board task stops it: its session ends and no new one starts until you reply.
- The Board no longer loses a reply or an edit you send while its session is still starting, and a dashboard restart no longer leaves a finished Board session running, starts a second session on the same task, or forgets a **Merge on main** you sent.
- **Merge on main** with nothing new to merge now reads as merged instead of failing and starting a session; it no longer reinstalls the task's folder first.
- The Board asks you to trust a repository before it runs that repository's setup or merge checks.
- A smoke server or a second dashboard can no longer add Board tasks with a number already taken, and a dashboard that crashes mid-save no longer loses the next Board change.
- A project's page is now built around its plan: a large progress bar, an Up next box with Mark done and Start session for the next step, and the plan grouped by step, each group folding open with its sub-steps and their count.
- On a project's page, Hide done hides finished steps, Expand all opens every group, and the bar with Select stays at the top while you scroll the plan.
- A project's page no longer shows the strip of four figures or the To do, Done, and All tabs; Sessions, Decisions, and Recent activity now sit under the plan, and New session in its header is now a plain outlined button.
- On Pull requests, a pull request whose only failing checks wait on someone's approval, such as a workflow GitHub holds for approval or a `human-review` gate, now shows an **Approval** badge under Waiting on others instead of **Fix CI**.
- The Todo page is gone, along with its list, the todo picker in new sessions, todo links in messages, and the todo tool sessions used to add items to it. Settings › Sync no longer carries a todo list.
- A new branch or Board task in a repository whose origin was added by hand, not cloned, now starts from its main branch instead of failing with a git usage message.
- **Merge on main** on a Board task now merges right away from the server, without starting a session; a session starts only if the merge fails.
- Each Board task now has its own branch, `board/<id>`, and every session on it starts in that branch's folder, so no session has to look for it.
- A Board session ends itself when it marks its task done, and no longer renews a 15-minute hold on it. Marking done first runs the quick merge checks, so a missing changelog line or an unexplained test edit is fixed by the session that made it.
- Screenshot checks sign in to the page without printing your access token into the session.
- An ended session now reads as finished in the archive instead of interrupted.
- A Board Workspace's **Projects** tab now lists its projects in a resizable column with search, **All projects**, and **New project**, as the **Bots** tab does; a project you pick opens on the right, beside the list.
- Each reply in a Board thread has a **Mark unread** button, as in Slack: it closes the thread and its blue unread count comes back, counting from that reply, until you open the thread again.
- The Board looks calmer: reply counts and unread counts use the app's own colors instead of bright blue, names drop the **SESSION** tag and use one size, the open Board task is marked in gray instead of yellow, the last reply's time no longer turns into "View thread" on hover, and messages line up with the Board's title.
- An empty Board reads "Each message here becomes a Board task, and a session starts working on it", its message box reads "Message <Workspace> to start a session", and the Board shows gray placeholder rows while it loads.
- Each reply in a Board thread has a **Mark unread** button, as in Slack: it closes the thread and its unread count comes back, counting from that reply, until you open the thread again.
- A Board task's message in the channel has **Mark unread** too, which counts its whole thread as unread again.
- **Notifications** and **Settings** in the Board's sidebar now open with the sidebar still on the Board, instead of switching it to Sessions.
- The Board's **Bots** page and its sidebar group now list only the Bots that work across projects, those whose folder holds your projects, such as `~/code`. A Bot that belongs to one project shows in that project's **Bots** tab on the Board.
- A Board thread now shows what each session did right under that session's reply, instead of in one **Actions** card at the bottom, without the "Actions" heading: each line is just the Git, GitHub, or Linear logo and the branch, pull request, or issue name, with what the session did with it on hover.
- A Board Workspace's **Bots** and **Settings** tabs now look like the Sessions side's pages: the Bots tab lists its Bots in a resizable column with search, and the Settings tab lists its sections with **Search settings**. The **Memory** tab now fills the width, with the open memory beside the list.
- A Board session now asks first only when your message is unclear, such as when it could mean two different changes. A clear request, such as "Merge on main" or a plain "make the button blue", runs right away.
- Behind the scenes: the agent's always-loaded instructions shrank from about 6,000 tokens to about 900. Rules only some tasks need, such as design handoff, pull-request reviews, and subagent worktrees, now live in skills that load when the task needs them.
- Behind the scenes: the Escape key that closes a Board thread, a link preview, or an inline confirm now goes through the shortcut table, and two more large source files are split under the size limit.
- Behind the scenes: a new lint rule keeps page-wide keyboard shortcuts in the one shortcut table, and the two largest source files are split under the size limit.
- A Bot, a project, or a pull request you open from a Board Workspace's tab now opens inside that tab, with the Workspace and its tabs still showing, instead of jumping to the Sessions side's page. Its links, a Bot's routines and a pull request's files included, stay in the tab, and a Bot in the Board sidebar opens in its own Workspace's **Bots** tab.
- A Board session now talks before it builds. Unless your message names the exact step, such as "Merge on main", it first replies in the thread with what it understood, the change it would make, and its questions, and starts work only once you answer.
- Behind the scenes: every lint rule now has a sample file it must flag, so a rule that quietly stops working fails the checks, and a new rule can start with its old findings listed and only ever shrink them.
- Notifications now appear at the top center of the window, and every one, including those still working, has a close button.
- The Board's tabs are back under the Workspace's name: Messages, Bots, Pull requests, Memory, Projects, and Settings.
- Board threads no longer suggest ending the session, which a Board session does by itself.
- A Board thread now ends with an **Actions** card listing what its sessions did, the Linear issues they saved, the branches they worked on, and the pull requests they opened, so you see it before you merge.
- Behind the scenes: an eval run now stops when a task's hidden tests could not run, such as with Docker down, instead of scoring every run after it as the model's failure.
- The comment count on each Pull requests row now counts only unresolved review threads, and hides when none are left open.
- Opening a Board thread from the message list now always shows its Thread tab first, not the session's conversation.
- The Board no longer starts a second session on a task while the session working on it is still busy. Under heavy load a session could miss renewing its claim, and the Board then kept starting new sessions on the same task, about 30 for one task, each stopping because another held it.
- Each Workspace in the Board sidebar now has a chevron that hides or shows the Board sessions listed under it; clicking the Workspace's name still opens its Board.
