# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines when you click What's new, the sparkles button at the top right.

## 2026-11-13

- The Personal and Work spaces are gone: every page shows all your workspaces, sessions, Bots, events, and accounts together, and the sidebar's Workspaces label still narrows the list to one workspace.
- Keyboard shortcuts now live in Settings › Keyboard, and ? opens it.
- The sidebar no longer has a Keyboard shortcuts link at its bottom; ? still opens Settings › Keyboard.
- End session is now called Archive session.
- The details sidebar now joins the page with no gap: one line, which you drag to resize it, sits between them.
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

## 2026-11-10

- A Claude Code session you renamed now lists under that name in the past sessions, and its transcript no longer shows Unread line warnings for Claude Code's own title and agent-name records.
- In Settings, Source control, a pull that cannot reach its remote now says why, such as a repository that cannot be read, where it used to say only "and the repository exists." A failed settings sync says the same.
- The server no longer stops when re-reading the session files fails right after a session exits, or when the search for a terminal session's subagent transcript fails.
- Get started no longer waits without end on a GitHub sign-in check that hangs: the check gives up after 20 seconds.
- Saving or removing an Anthropic API key in Settings no longer loosens the permissions of omp's models file, and no longer replaces a linked models file with a plain copy.
- The usage check no longer copies your browsers' cookie files every minute to read the Anthropic Console balance unless an API key is saved, the only case that shows that balance.
- A draft that starts with blanks before ! or $ is now treated like one that starts with the command: the note under the composer shows instead of Enter doing nothing, and Send later refuses it.
- In Settings, Activity, the Tickets page's Cmd+N command now sits under the commands that are not set up while Linear is not connected, with the other ticket commands, instead of under never used.
- The keyboard shortcuts guide now lists dictation, the number keys that answer a question, and the Sport timer's keys, and names the four pages where C does something other than create a ticket.
- In a new mail or a reply, a pasted list of recipients that ends with a comma or a semicolon now adds the people in it, instead of being marked invalid.
- In Settings, Extensions, an install or update no longer restarts its progress check each time the page redraws, and searching for "null" no longer lists every package that has no source.
- Settings, Phone access no longer shows a cancelled-read error when you come back to the section.
- In a Bot's details, a routine's "Ran 5m ago" now counts up each minute, as the routines card does.
- The Settings guide now lists Phone access among its twenty sections.
- Sport: saving an edit to a logged session no longer erases the loads of exercises the dialog does not list, such as those of a workout the plan no longer has on that day.
- Sport: with no plan, the Plan suivi chart now says the plan has not started, where it drew one empty week.
- Notes: deleting or moving another note from its right-click menu no longer closes the note you have open.
- The starter kit's ship gate, land gate, and worktree guard now see a git or gh command written after then, do, else, {, or !, which slipped past them.
- Linux: the arm64 AppImage can now update itself, since each release publishes its update feed too.
- Linux: Retry in the packaged app no longer strips the session bus and runtime directory settings from the server it restarts, and the app menu no longer shows Open at Login, which did nothing there.
- The README no longer says quitting the app stops your sessions: they keep running and show live again at the next launch.
- Tab no longer lands on the hidden rows of a collapsed sidebar group, such as past sessions.
- A note or a reminder a Personal session left while the dashboard was closed no longer lands in Work at the next launch.
- Removing the last Anthropic API key no longer deletes a setting or a comment that follows the dashboard's entry in models.yml.
- What's new no longer shows stray asterisks and backticks around names in some entries.
- The README and guides now give the keys the app uses: Cmd+Shift+Backspace stops a turn, Enter queues a message to a terminal session's subagent and Cmd+Enter steers it, and Todo and Calendar open from the header without a tab number.
- The starter kit's instructions no longer point agents at a pr skill, a Skill tool, and a browser tool address that do not exist.
- Behind the scenes: removed unused imports, a prop no row read, an option no caller passed, an unused queue member, a dead build setting, and lines that could never run; declared two editor packages the page already used; merged two test files that shared a name, so both are type-checked; the starter kit's tests now load omp's own schema library; and corrected file lists, names, counts, and descriptions across the docs.
- Ship no longer stops on a missing review checkbox: recording the stage after the interface or thermo-nuclear review ticks that review's box in the pull request description, or adds it when the description has none.
- Recording live or a fix while the pull request is still a draft now says what to do next, such as running gh pr ready, instead of failing.
- A chrome-devtools page tool called without a pageId, such as a screenshot, now runs on the first page instead of failing; close_page and select_page still need one.
- Cmd+F now finds text in the open conversation, or in the pull request the Pull requests page shows: every match is highlighted, the bar counts them, and Enter and Shift+Enter step through them.
- The sidebar's session search moved to Cmd+Shift+F.
- Fixed: a screenshot or file an agent names by its bare name, such as inline-rows.png, now opens when the agent had looked at it in another folder, instead of saying the file could not be loaded.
- A reply that lists pages to review now has a Review visuals eye button under it, beside its copy button, in place of the card that listed the pages. It shows the Browser and opens that reply's pages as tabs, so you no longer go looking for the button in the Browser's toolbar.
- Session rows in the sidebar line up again: each age shows its largest unit, such as 3h, in a fixed column, so the workspace chips sit at the same place on every row.
- Long agent replies read more easily: their text keeps the conversation's full width with more space between paragraphs and bullets, and bullets that open with a bold word line up as a two-column table, keys on the left. A narrow conversation keeps the key inline.
- Clicking a subagent opens it in the same pane as its session again, so a split stays as it is instead of gaining a pane. Cmd-click opens it in a split beside its session.
- In the composer, type $ to pick a skill or command, and @ to mention a file or anything else. Typing / no longer opens the list. A price such as $5 stays plain text.
- Skills, files, tickets and other references in a prompt show as an icon and a label in their own color, without a badge around them. A command or skill reads as its name, such as Poteto Mode, with the text it runs in its tooltip.
- Long agent replies read more easily: their text keeps a narrower line length with more space between paragraphs and bullets, and bullets that open with a bold word line up as a two-column table, keys on the left. A narrow conversation keeps the key inline.
- Clicking a subagent now opens it in a split beside its session, at full height, instead of in place of the session. Cmd-click opens it in place, as a click did before.
- The sidebar marks the sessions of a split with a two-column icon, and highlights a session while one of its subagents is open.
- Hovering a suggested prompt under the composer now shows its keys: send, edit, and mark. Its pencil button puts the prompt in the composer so you can edit it before sending.
- Get started's fourth step is now Tools and workflows: connect GitHub, Linear, Slack, Google Calendar, and Gmail right there, see whether pstack is loaded, and find what still needs you under Action needed, with Go to Starter kit when pstack is missing.
- Installing the omp Starter Kit on a new computer now makes the pstack skills work, such as arena and technical writing, which ship plans with. Before, omp skipped all of them, so ship stopped at its plan step.
- The omp Starter Kit now brings the two poteto helpers that ship and poteto mode hand work to, one on Claude and one on Codex.
- Behind the scenes: the starter kit's agent rules now include the newer ship steps, the rule to set pull request descriptions with the checked tool, and the rule to retake pull request screenshots after each push.
- Code in a pull request's Code tab, the changes view, and messages is a size larger and colored like a code editor: types, functions, properties, tags, and comments each get their own color, in light and dark mode.
- A pull request's ⋯ menu, and its row's right-click menu, offer Explain this PR and Ask a question. Each opens a new session in the pull request's repository with a draft that names it: Explain asks for a walk through its purpose, changes, and risks, and Ask leaves room for your question. Neither changes code.
- A pull request's Summary and Timeline are easier to read: descriptions and comments are larger, section titles stand out, and the timeline's names, dates, and file paths are a size larger, with collapsed comment groups less faded.
- New Bot offers three more templates for a Routines Bot: Memory curator keeps each repository's project memory up to date, Bot coach proposes how to improve your other Bots, and Review requests drafts the reviews teammates ask you for. Each one sets up its own routine in its first conversation.
- The model menu has an Extra usage switch. On, a full Claude allowance stays on Claude instead of moving to a fallback such as Cursor. Off puts the fallback list back. It applies to every session.
- Fixed: Connect in Integrations failed, such as with "Google Calendar has no server to sign in to", when the service's server was turned off. Connect now turns it back on. It skips the sign-in page while the old sign-in still works.
- A link to an agent's test server, such as one in its reply or listed under Review visuals, now opens signed in, in an omp agents window of its own, instead of a page saying to open the app.
- The Todos card is back on the right of the conversation, with its todos, subagents, files, images, and sources in view, instead of a line you click open. In a narrow conversation it sits above the messages.
- Click a file chip above a prompt you sent, such as Pasted text.txt, to read the text it carried. The Copy button copies it.
- Hover or focus the speech bubble count on a pull request, in the sidebar, the table, or the board, to read its five latest comments and reviews without opening it. The card leaves out what the Comments filter hides and says how many it left out.
- When an agent sets two or more subagents on the same task, the Todos card's Subagents section shows them side by side in an Arena box.
- Once the agent picks, the runner it kept says Base, and the others say Graft, with what it took, or Not used.
- The agent records its arena with the new arena tool: install the updated omp Starter Kit to get it.
- Todo moved from the sidebar's tab bar to the top right of the header, between Calendar and Sport. Email now sits after Sport. A saved tab order moves Todo there too.
- Behind the scenes: agents now follow the code when an instruction disagrees with it, and say so.
- Behind the scenes: the starter kit's maintainer setup now tells agents to save a pasted secret right away.
