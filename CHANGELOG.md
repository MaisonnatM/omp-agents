# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines in Settings › What's new.

## 2026-11-24

- The Board is gone: its page, channels, threads, and the board tool agents used to post there.
- Projects keep working on their own: the Projects page, the brief each session in a project gets, and the project_list and project_update tools agents use.
- Your existing projects move over by themselves the first time the dashboard starts, with their plan, decisions, and messages as log lines.
- Agents can add a whole project plan, with its sub-steps, in one project_update call.
- The eval set's 11 tasks that failed the same way in every run now tell the agent the interface their checks expect, such as an exact error message, a dependency's name, or an output's shape, so a run is no longer failed for guessing a name differently.
- The eval runner takes `--jobs N` to run N tasks at once; each run and its recorded result stay the same, only the wall time drops.
- A done Board thread with messages you have not read now stays in its channel's list, and in the channel's unread badge, until you open it; before, the badge counted it while the list hid it.
- The eval set now scores what its tickets ask for: each run sees the pull request's description, only the tests that the change made pass decide the score, and a new column shows the share of those tests that passed. Runs can now use git, uv, and vitest inside their clone.
- When a land stops because an existing test changed, its message now says exactly how to mark the change as intended, or to put new tests in a new file instead.
- A new Friday routine receipt, off until you turn it on, lists what each routine did and cost this week and says which to keep, slow down, or retire.
- Each routine now shows what its runs cost: the row adds up the Bot's turns over the kept runs, and an open run shows its own tokens and cost.
- A Bot now ends a routine run that found nothing new quietly by default, with no notification and no unread dot, so only runs with news reach you.
- New routines, whether you or a Bot create them, now start with New conversation each run checked, so each run no longer re-reads the Bot's whole earlier conversation. Your existing routines keep their setting.
- A routine that runs a command can now post its output to the Bot only when the command fails or prints something different from last time: pick When it fails or its output changes in the routine's editor. A cheap check can then run often and wake the Bot only on news.
- Wake-up messages the dashboard sends a session no longer show in its conversation: a watched pull request's change, a Board mention, and a follow-up the agent scheduled for itself. The agent still reads and acts on each one. Messages you schedule yourself still show.
- New conversation each run now works for routines that run a command too: when the command's output is posted to the Bot, it opens a new conversation. A run that posts nothing leaves the conversation alone.
- A routine that sends a message can now start a new conversation on each run: check New conversation each run in the routine's editor. When the Bot is busy, the run's message joins the current conversation as before.
- A Bot or session that answers you in a Board thread now ends its post on suggested prompts when it leaves you a next step, so the reply box offers them as it does under a session's "finished" post.
- A Bot whose conversation stopped still offers the prompts its last reply suggested under its composer.
- Settings › Sync can now carry your Board projects between machines: each project's name, goal, decisions, archive, and plan steps with their state arrive on every machine, while its sessions and messages stay where they happened.

## 2026-11-23

- Behind the scenes: a ship run on a Linear ticket now records which ticket its plan came from, and refuses a plan that names a different ticket or none.
- Behind the scenes: ship now refuses to open or mark ready a pull request that changes files its plan did not list, and names those files, unless the plan says why the change grew.
- A Board thread now offers the prompts a session's reply suggests under its reply box, as the session's own composer does; pick one to send it in the thread, which reaches the session.
- Board thread cards keep an even height: the latest message's preview stops at two lines, and a claimed thread's chip reads "claimed · 53m left", with the session's name on hover.
- A Board thread's reply box stays at the bottom of the thread, as a session's composer does, instead of rising above an open notice.
- A message you write in a new Board thread now starts a session on it, and your replies in that thread reach the session; before, a message that mentioned no one went nowhere.
- While a Board thread's next message starts a session, its reply box shows a directory picker for where that session runs, set to the folder you picked last.
- Agents can now add a whole project plan, with its sub-steps, in one board call: the step and project actions take a list of steps.
- A session watching a pull request is now woken only when it has something to do: checks failing, new unresolved review threads, changes requested, or a merge or close. Checks passing and approvals no longer wake it, unless it asked to merge once the pull request is ready.
- A pull request change now wakes a session only once it has lasted a minute, so a check that fails and passes again wakes nothing, and the message names only the net change.
- Only one session watches a pull request, the one that last asked to, so the same change no longer wakes two sessions.
- A project is now a Board channel: its plan steps are task threads you tick by marking them done, its log is the channel's messages, and your existing projects move there once when the dashboard starts.
- Agents now manage projects with the board tool's projects, project, goal, decide, join, leave, step, rename, archive, restore, and reopen actions, which replace project_list and project_update.
- A session in a project now posts its questions and finished turns in the project's channel, and its brief shows the channel's 10 newest messages.
- Fixed: on a wide window you can now close an open Board thread, with the X at the top right of the thread or Esc.
- You can step through the Board's threads with the up and down arrows beside the thread title, or with J and K, or the arrow keys.
- An open Board thread now has a Mark done button beside its title, which settles it as /done does.
- A channel's thread list is tidier: it no longer repeats the channel's name on every thread, and it shows the people row only for a task or a thread with several people in it.
- A channel's thread list now hides done threads; type in Filter threads to find one again.
- The sidebar's plan usage now shows every account when two share an email, such as a work and a personal Claude organization, and names each one's organization instead of drawing a single row.
- Behind the scenes: an eval run now deletes its copy of the repository even when scoring it fails, so a long decay check no longer fills the disk with leftover copies.
- The Board's thread list now shows each last message as plain words, without Markdown such as `**` or link addresses.
- Behind the scenes: the metrics report's first-pass rate for a GitHub repository now counts only the checks a pull request must pass to merge, so gates like `human-review` no longer pull it down, and it says how many pull requests had no required checks.
- Behind the scenes: after a model upgrade, one command now reruns the eval set with each skill and the ship flow turned off in turn, says which ones still make agents pass more often and which could go, and can first print how many runs that takes and what it would cost.
- In the Board's #sessions threads, each post now opens with a "Waits on you" or "Finished" chip instead of repeating your @name, and a reply cut off mid-bold no longer shows stray `**`.
- Behind the scenes: the metrics report can now also measure a GitHub repository's merged pull requests week by week: what each one cost, how often its checks passed the first time, how many review rounds it took, and how often a person added a commit.
- Behind the scenes: the eval set can now also replay merged yampa pull requests, each started from its Linear ticket and passed only when that pull request's own tests pass, run 3 times to show how often a task passes at least once; the first yampa set has 18 of its planned 20 tasks.
- Behind the scenes: eval runs can no longer copy each other's work, post to Slack or Linear, or pick up the session they were started from, and their task prompts now spell out the exact names the tests expect; a first 5-task trial passed 1 to 2 of 5 for about $4 a round.
- The Board's reply box is now the same composer as a session's, so its `@` and `/` lists look and work the same way, and a member you mention or a workflow you start shows as a chip.
- Board messages now show Markdown, such as **bold**, *italic*, lists, and links.
- A Board mention now counts when a comma or other punctuation follows it, such as `@Maxence,`, in any case, and `@Max` no longer wakes `@Maxence`; the composer's chips match exactly what wakes.
- Behind the scenes: the Board composer and the session composers share one completion list core, `useCompletionMenu`, and the Board reads mentions and commands with one grammar in its shared module.
- A Board command such as `/schedule` or `/claim` now saves all its changes together or none of them, and a schedule keeps its member's name even after that member leaves.
- Behind the scenes: the Board drops its unused pull request, finding, question, blocked, and label surfaces; its page is split into list, thread view, attachments, and composer files; and the dashboard server runs the Board through a module `run` hook instead of naming it.
- The safety check now lets an agent keep the dashboard token in a shell variable when it only goes into a request header, and /ship now counts `astro check` and `playwright test` as test runs.
- The Weekly harness review now saves the five failures it picks so you can replay them once its proposed change lands, and the next week it tells you whether that change fixed each one.
- The Weekly harness review now also counts pull requests in every repository whose fixes ran out of rounds or stalled, grouped by cause.
- If you never edited the Weekly harness review's instructions, it now gets the newest ones by itself; ones you edited stay yours.
- A new eval set replays 20 real past tasks to check that harness changes help, and can switch off one part at a time to see which parts still matter.
- The safety checks are now tested against 50 real past commands, so a rule change that blocks the wrong thing shows up; this caught a way around the git hooks check and a missed warning when reading pull request text in a loop, both now fixed.
- The dashboard now opens on the Board's Inbox.
- Each session now posts on the Board, in its own thread in #sessions, when it asks you something or finishes a turn you did not see, so your Inbox lists what waits for you.
- A new Board page in the docs explains channels, threads, tasks, and how messages reach sessions.
- /ship now skips the plan contest and both code reviews for a small change, up to 50 changed lines in 3 files that touch no shared or schema file, so quick fixes ship faster and cost less.
- Edits the plan already spelled out now go to a cheaper worker agent, while planning, design calls, and reviews stay on the strongest model.
- Behind the scenes: the note about a session's todos now comes as a message instead of changing the agent's standing instructions, so those instructions stay the same in every session and are read from the cache, which costs less.
- Behind the scenes: a Bot's name, job, memory, and routines now come as a message whenever they change, instead of rewriting the Bot's standing instructions every turn, so those instructions are read from the cache, which costs less.
- Behind the scenes: a new metrics report shows, week by week, what each landed change cost, how often /ship steps pass, how often asking for help was worth it, and how often a person had to fix agent work afterwards.
- /ship now checks that each step left the details the next step needs, and it reuses an existing pull request, Linear link, or Slack post instead of making a second one.
- Independent checks and reviews now run side by side, and agents get a simple rule for how many helpers to start for a task.
- Text from issues, pull request comments, and web pages is now read by a helper that cannot run any tools, so instructions hidden in that text cannot make an agent act.
- Board: you can now create channels, with the + beside Channels in the sidebar, and threads, with New thread at the top of a channel; before, an empty Board had nothing to post in.
- Board: the `board` tool can now open a thread in a channel, with an optional first message, so agents can start threads too.
- A new Board starts empty, with one `general` channel, instead of demo channels, threads, and members.
- /ship now refuses to open or ready a pull request until the agent has run the tests after its last edit, and for a bug fix, until the failing test was committed before the fix.
- Reviewers now answer with one "blocking" or "approve" line per goal of the change, then at most five short findings.
- Agents can now watch a pull request: the dashboard wakes the session once when its checks, reviews, or comments change, or when it merges, instead of the agent checking again and again.
- Once a day the dashboard warns you about routines that failed, stopped early, or missed their time, and a new weekly routine, off by default, suggests one improvement to how agents work.
- /ship now asks the agent to write down, before coding, the goal, the files it will change, and how it will know it is done, and it refuses to start coding without that.
- /ship now remembers approaches you or a reviewer turned down, and reminds the agent of them and of the plan after its memory is compacted or the session resumes.
- Agents are now stopped before risky shell commands, such as pushing straight to main, skipping git hooks, stopping the dashboard, using a default server port, or reading secret files.
- Behind the scenes: the always-loaded agent instructions are about half as long; rare rules moved into skills that load only when needed.
- Behind the scenes: `bun run test:agent` prints a one-line test summary and one line per failure, so agents read results faster.
- Board: a new page of channels and threads where you, your sessions, and remote agents post; the dashboard saves it in `board.json`, and a message that mentions a session wakes it, resuming it if it ended.
- Board: every session gets a `board` tool to read threads, post, claim or settle a task, and report workflow steps.
- Board: the left sidebar has a Sessions | Board switch at its top; on Board it lists your inbox, schedules, channels, people, agents, and sessions, and each has its own address, such as `#board/channel/<id>`; an open thread adds `?thread=<id>`.
- Board: the reply box moves up while a toast shows instead of hiding under it, and an expired task lease now reads "lease expired".
- Board: your Bots are members too; they list under Agents, the @ menu offers them, and mentioning one wakes its conversation, starting it if it has none, so it answers in the thread.
- /ship now stops a session after five rounds of fixing failed checks or review comments, or sooner when the count stops going down, and asks you before trying again.
- /ship now writes one line per step with the model, tokens, and cost to a log in your omp-agents settings folder, so you can see what each pull request cost.
- Behind the scenes: landing now refuses a change that edits an existing test unless a commit explains why, so an agent cannot make tests pass by rewriting them.
- Behind the scenes: a code checker now runs before every landing, and three mistakes agents repeated are now caught by tests instead of notes.
- Projects: a new session started from a project now shows that project above its question and in its header, where its close mark starts the session in no project; editing a scheduled project start keeps its project.
- Fixed: the counts beside Notifications, Bots, and Pull requests in the sidebar now sit centered on their row instead of slightly low.
- Artifacts: documents in the Artifacts tab use a wider reading column, so less space sits empty around the text.
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
