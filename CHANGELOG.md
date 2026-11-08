# What's new in omp-agents

Each update to omp-agents adds a few lines here, newest first, in everyday words.
The dashboard shows the same lines when you click What's new, the sparkles button at the top right.

## 2026-11-08

- Behind the scenes: the dashboard now keeps your training plan, test results, targets, and workout log together and works out each week's workouts and loads, ready for the coming Sport page.
- Your personal assistant can now read your training week, with each day's loads.
- It can log a workout, record a test result, and set your plan and targets. The dashboard saves each change for it.
- It never changes or deletes a workout or test result you entered yourself.
- Installing the starter kit, or Update dashboard, now removes the kit files the kit stopped shipping, unless you edited them, so old extensions stop running in your sessions.
- With the starter kit, helper agents that a session starts no longer carry the tools only your own session uses, such as ending the session, landing, and your todos, notes, and reminders, so each of their requests costs less.
- Fixed: with the starter kit, helper agents in poteto mode no longer look for a skill under an old name that always failed.
- Behind the scenes: a token cost report prices recent omp requests by agent, cache use, and tool, and the developer docs map where the money goes, with ranked proposals to spend less.
- Behind the scenes: the developer docs gain a harness map, five diagrams of how the dashboard, omp, and the starter kit fit together, so contributors find their way faster.
- The Sessions tab has a Waiting on subagents group for sessions whose subagents still work while the main agent waits for them.
- Rows in it show no blue dot, so Idle lists only sessions that are done and Running only sessions that work.
- A turn that ends while its session's subagents still work no longer counts on the Dock badge, and notifies once they stop.
- The starter kit now includes the grill-with-docs design interview: type /skill:grill-with-docs and a plan, and the agent asks rounds of numbered questions, each with its recommended answer, writing agreed words to the project's glossary as you go.
- Decisions settled during that interview go into the project's usual decision records, not a second folder.
- The starter kit also includes grill-me, the same interview for plans outside a project, such as a trip or a career move: type /skill:grill-me and your plan.
- Fixed: with the starter kit, telling the ship tracker a pull request was merged now works for each pull request you name, even right after another one was marked merged, and it still refuses one that is not merged yet.
- With the starter kit, a session whose Google Calendar or Gmail sign-in has run out now tells you to sign in again in Settings › Integrations, instead of trying again.
- The bell now shows a notice when Google Calendar or Gmail is signed out, under a new Integrations tab, and opening it takes you to Settings › Integrations; it goes away once you sign in again.
- The four omp patches, paid Cursor fallback, tool documentation, Cursor tools, and the credit patch, now apply to omp 18.18.1, and the credit patch now applies on its own.
- omp-agents is now tested with omp 18.18.1.
- Settings › Providers now lists a provider's signed-in accounts in the order omp tries them, each with its place number.
- Up and down arrows beside each account change which one omp uses first, for example your work Anthropic account before your personal one.
- The new order is saved at once in omp's settings, and omp follows it without a restart.
- Fixed: the dashboard no longer freezes when your skill and instruction files sit both under your home folder and elsewhere, such as `/tmp`.

## 2026-11-07

- Fixed: the daily cleanup and Settings › Storage now check a subagent's copy of your repository for edits and live sessions even when omp keeps that copy outside the task's folder.
- Fixed: removing a leftover task's folder now also deletes that outside copy, instead of leaving it behind.
- Fixed: a Bot page's model menu now lists the models, instead of staying on Loading models.
- The API credits row at the bottom of the window turns red and reads used up when Anthropic refuses requests because the key's credit ran out, and the bell's alert now reads Out of credit: API credits.
- Fixed: with the new omp 18.18.0 credit patch applied, a session whose Anthropic API key runs out of credit moves to the next model in its fallback list and stays off that key, instead of stopping or going back to it.
- Fixed: sessions on a Cursor model now find the dashboard's tools, such as landing on main, ending the session, and moving it to another folder, instead of saying they are missing.
- The API credits row in the bottom bar now shows the dollars left on your Console balance when you have no monthly grant, in red once it runs out, instead of only its name.
- The paid Cursor fallback patch and the tool documentation patch for omp now apply to omp 18.18.0, together with the Cursor tools patch.
- omp-agents is now tested with omp 18.18.0.

## 2026-11-06

- Fixed: the composer model menu now lists Anthropic API credits after you save the key, without restarting the dashboard.
- With the starter kit, saying "council" now asks Claude Opus, GPT Sol, and Gemini Pro for their review or advice side by side, with a score out of 10 for each round of a code review.
- Behind the scenes: the list of outside tools an agent sees is now names grouped by service, instead of every tool's description, so sessions spend far less of their context on it.
- Fixed: subagents that edit for a session on `main` are now told to write in its worktree by full path, instead of using an option omp does not have, so their edits stop being refused.
- Fixed: poteto agents now open the poteto mode file in one step instead of failing on its name and searching folders.
- Fixed: the design critic now calls the browser tools by their real names.
- Behind the scenes: each group of API routes now lives in its own file, so a mail change and a session change are no longer the same edit.
- Behind the scenes: a change to one part of the dashboard no longer has to be read together with another part that only shared a type with it.
- Behind the scenes: agents can list shared project memory even when their provider supplies empty fields for unused options.
- Behind the scenes: the saved runtime fixes let agents read selected lines of tool help without losing the tool or flooding the conversation with its inventory.
- Behind the scenes: historical consults now explain when an exact session file is needed, and the Memory curator uses it when working across projects.
- Fixed: Claude extra usage now appears automatically in the account's billing currency, including euros, in the bottom bar and model menu.
- Fixed: a note or todo you edit while the dashboard is reconnecting is now saved once it reconnects, instead of being dropped, and the reconnect no longer replaces the text you typed.
- Fixed: after a failed write to disk, such as a full disk, later changes are saved again once the disk has room, instead of only at the next clean stop.
- Fixed: a routine run cut off by a server stop while sending its message now shows as failed, saying the message may not have arrived, instead of "Running…" until the next run. A run being sent reads "Sending…", and **Run now** waits while the last run is still under way.
- Fixed: a failed storage cleanup now says it failed, not that it was stopped.
- Fixed: a worktree removal or rebase that hits an error no longer blocks every later one until you reload the page, and a worktree removal cut short by a stop is finished at the next start.
- Fixed: two quick actions started in a row now both open their session or show their failure.
- Fixed: dictation no longer stays blocked for every page after a capture that never reported its end.
- Fixed: on the Extensions tab, a failed progress read keeps checking instead of stopping, and approving clears the old error.
- Fixed: when a pull request comment posts but closing it fails, retrying only closes it, so the comment is not posted twice.
- Fixed: pressing an action button twice quickly in Settings and other panels now runs it once.
- Fixed: settings sync drops a result from a remote you changed during the sync, and the desktop app still stops its server when you quit during startup and says when an update did not install.
- Fixed: a session move waiting on a turn that ends with a question now goes, a prompt to a session whose omp has exited is refused with a plain message, and unread marks saved before a restart survive it.
- Fixed: an auto-continue scheduled while the usage limit was being read survives a restart.
- Fixed: a terminal tab you open after its shell exited shows the exit at once, instead of waiting forever.
- Fixed: a sign-in row no longer shows an old failure beside a fresh sign-in link.
- Fixed: when an update fails to download in the desktop app, it now says so, and a background update check no longer answers the one you asked for.
- Fixed: code highlighting and Markdown now still show if their extra code fails to load.
- Fixed: a hover card such as the CPU card opens on a pen or touch tap after it closed, and pressing Attach in the Browser twice captures once.
- Fixed: Settings › Worktrees no longer stays on "Reading" after you leave the tab mid-read, and Escape on a pull request edit throws away the draft text.

## 2026-11-05

- Behind the scenes: a check that deletes a private session now passes after another check has already saved a session title, so the full test run no longer stops there.
- The model menu shows an API credits group beside Anthropic before you search, for an Anthropic API key saved in Settings. A session you start from that group bills the key. A session on Anthropic still uses your Claude plan.
- An API key that an older version saved on Anthropic moves to that group the next time the dashboard starts.
- Fixed: an Anthropic API key added in Settings now shows as API credits in the bottom bar, even while you stay signed in to a Claude plan.
- Starting a new session while several conversations are open shows that new session alone.
- Ending a session that is open beside another one leaves a single conversation, instead of filling the empty side with the next session.
- Esc on a split closes the pane that was added last. Esc on a maximized pane still brings the other panes back.
- The Sessions tab now lists running Bot conversations in a **Bots** group, under each Bot's name, so every open session shows somewhere; the CPU card names them the same way.
- A Bot's conversation idle for a day, with nothing written to it, now ends by itself so it holds no omp process; your next message to the Bot resumes it.
- Fixed: a session whose omp exits before it is ready no longer leaves its socket file behind, which blocked the next start on that session.
- The model menu now lists models from a provider you configured with an API key, such as API credits.
- The bottom bar names that provider beside the plan windows. It has no percent, because the plan report has no balance for it.
- When Firefox or Zen is signed in to the Claude Console, the API credits row shows the dollars spent of the monthly grant, such as $11.13 / $200.00. A Chrome-only sign-in stays a name.
- Behind the scenes: installing the starter kit now adds a headless Chrome DevTools connection for agents that check pages in the browser, and ships the interface review skills so pull request interface reviews can run without a separate install.
- Behind the scenes: the starter kit's maintainer profile adds rules for sessions aimed at another project, Linear tickets, docs and changelog edits, plan replies, and headless test windows, and `/ship` plans now include how the code works today plus a second-model critique before coding starts.
- Settings › Providers can add or replace an Anthropic API key in a masked field, so you do not paste it into a conversation.
- Saving that key keeps your subscription sign-ins.
- Fallback routing stays as it is.

## 2026-11-04

- Behind the scenes: `/ship` plans now open with how the code works today and end with what is out of scope, and the chosen plan goes to a fresh critic on a different model, which has not seen the conversation and must back each finding with evidence, before any code is written.
- Picking a project for a new session from the keyboard now puts the cursor back in the message box, so you can type right away.
- Fixed: ending a session whose folder holds many installed packages no longer leaves a half-deleted folder behind, which made Resolve conflicts and other starts on that branch fail with "already exists".
- Behind the scenes: agents checking the dashboard page now use Chrome DevTools' tools, which also show page errors, failed requests, and load times.
- Settings › Storage can now prune the uv, pnpm, and bun package caches. Packages no project needs are deleted and download again when a project installs them, while the files running tools such as MCP servers use are kept.
- Behind the scenes: agents now run the interface review alongside the thermonuclear one when a pull request changes UI files, attach PR screenshots without the body edit the guard refuses, and open the test browser with the right call shape.
- A Bot can now end a run quietly when it found nothing for you, so a routine run with nothing new no longer notifies you or marks the Bot unread. The PR shepherd's starting job asks for this; add "When a run finds nothing for me, call stay_quiet." to an existing Bot's job.
- Deleting worktrees in Settings › Worktrees now works like Rebase behind on Pull requests: click Delete, Delete N worktrees, or Remove N merged twice instead of going through a dialog, and they are removed one at a time in the background while one toast counts them, even after you leave the page. Each row says Queued, then Removing, and leaves the list once it is gone.
- Behind the scenes: the design reviewer agent now checks that a page's title and header buttons stay visible at every width with the sidebars open.
- The Todos card is now one line above the messages, such as Live review · step 8 of 9 · 7 Files · 1 Image · 1 Source, or the task the agent is on when there is no /ship. Click it to open the whole card over the messages, and click outside or press Escape to close it. The messages keep their full width, and the counts drop off as the pane narrows.
- Closing a file's changes or an image you opened puts the focus back on the row or thumbnail you opened it from, instead of the top of the page.
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
- A key or password you paste into a session no longer stays in the saved session. Once the agent finishes its turn, the starter kit replaces it with a note saying what kind of secret it was, so save it where it belongs in that same turn.
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
