# Starting, ending, resuming, and forking

- To start a session, click **New session** at the top of the **Sessions** tab.
  The page shows a new-session draft, its header reading `New session`; the directory picker above the composer shows the directory that omp will run in.
  No omp process starts and no row appears in the sidebar until you send the first message, so leaving an empty draft leaves nothing running.
  The page shows the omp logo over the question "What should we work on in" and the folder's name, and keeps the composer at its bottom, the directory and branch pickers just above it.
  While the draft is empty, the composer lists seven starters under its buttons, numbered, as it lists a reply's suggested prompts: work you start often, such as **Run the dev server**, **Ship ENG-2722**, or **Sum up my week**, the best fit for now first.
  They fill in what the page knows: the branch picked above the composer, your Linear issue in progress or up next, and your one open pull request when you have only one.
  Running the dev server ranks first on a feature branch, shipping an issue when one is in progress, shepherding your pull requests when some wait on your move, and a summary of what you merged on Monday morning and at the end of the week.
  Pressing a starter's number, or clicking it, puts its full prompt in the composer without sending it, so you can edit it first; 0 or **All of them** puts the starters there as a list. With no issue to name, **Ship a Linear issue** puts `/ship ` there for you to paste the issue's or the view's link after.
  A personal draft lists none, and a private draft shows what ending it deletes there instead, as **Private** below says.
  A scheduled start keeps its pickers inside the composer and lists no starters.
  The directory is the selected workspace, else the open session's workspace, else the newest live session's, else the newest past session's, so a session in a linked worktree hands its repository's main checkout to the draft, where the branch picker can pick a worktree.
  To start in another directory, under **All workspaces** or not, pick it in the directory picker, or press Cmd+Alt+P.
  It lists the workspaces the sidebar lists, and **Use** takes any directory typed into its search field.
  The message you typed stays in the composer.
  Sending the first message starts omp there and sends it the message.
  The message stays in the composer while omp starts, and also if the start fails, with the error above it.
  A start or resume of a task another session already works on in the same repository is refused before anything is checked out: the error names that task, links the session that has it, and gives its dashboard port and directory.
  A task is a ticket, a pull request, or a todo that the start names: through a quick action, a Linear or pull request URL that leads the message, or the argument of `/ship`, `/ticket`, `/review`, or `/fix-pr`; a ticket mentioned anywhere else in the message is not one.
  Reviewing a pull request is a different task from working on it, so a **Review** session can run beside the one that implements it.
  Focus or end that session first; once it ends, the task is free again.
  When omp is ready, the dashboard opens the session in the focused pane.
  The draft is in the URL hash, `#new` or `#new/<encoded directory>`, and leaves the panes behind it, as **Settings** does.
  A session that you start or fork in another workspace than the selected one switches the workspace picker to that workspace, so the sidebar lists it.
- A session that the dashboard started has the directory picker in its composer too; other sessions show their directory's name there.
  Picking a directory moves the session there, as omp's `/move` does: the transcript stays, and the header and the session's tools follow the new directory.
  The sidebar's workspace picker switches to the new directory's workspace, as for a session you start there, unless it shows all workspaces.
  The picker is disabled while a turn runs or waits on a question, since omp moves only an idle session.
  A typed `/move <path>` works the same way; in a session with no reply yet, the dashboard follows the move once omp writes the first reply.
  A session's agent can ask for the move itself: when it finds the work belongs in another directory, its `move_session` tool queues the move, and the dashboard sends `/move <path>` once the turn ends, so the session, its header, and the sidebar's workspace picker follow as they do for the picker.
  A turn that a queued message starts at once keeps the move waiting for the next idle end, and a move omp refuses shows its reason as a note in the conversation.
  Only a session the dashboard started has the tool, except a Bot's conversation, whose directory stays fixed; a session in a terminal still asks you to type `/move`.
- A session the dashboard started can wait on another running session: name that session with an `@session:` mention and ask it to wait, such as waiting for the session that builds the importer, then reviewing its branch.
  Its `wait_for_session` tool holds its turn until that session ends its turn with no subagent it waits on still running, asks you a question, or no longer runs, then hands it what happened and that session's last reply.
  It stops waiting after 60 minutes unless you ask for another limit, up to 240 minutes, and stopping its turn stops the wait.
  A session cannot wait on itself, and a Bot's conversation has no such tool.
- The draft's composer has the model menu at its bottom left, as a running session's does, without its Fast row.
  Until you pick one, it names the `default` role's model, such as **Opus 5.5**, which is the model omp starts on without `--model`.
  It reads **Default model** only when no `default` role names a model you are connected to.
  Context and the model search work as in a running session, and the curated models come from the draft directory's config.
  The effort choices come from the selected model's omp catalog entry.
  **Default** leaves omp's configured thinking level unchanged.
  Choosing a level starts the session at that level, for the model it was chosen on: choosing another model, or a directory whose `default` role names another model, resets the effort to **Default**.
  Models without selectable thinking levels offer only **Default**.
  Cmd+. opens the model search here too, and Cmd+J cycles the supported thinking levels after the catalog loads.
- A skill pinned in **Settings** shows as a toggle after the model picker, with the skill's name.
  While it is on, the first message goes through the skill, as if you had typed `/skill:<name>` before it, and the transcript shows the skill's pill.
  Click it to start this one session without the skill.
  It is greyed out when the directory has no skill of that name, and the session then starts without it.
  A first message that starts with `/` keeps its own skill or command and skips the pinned skill, so the toggle hides while the message starts that way.
- **Private**, the pill at the right of the page header, starts a session that is deleted with everything it wrote when it ends: its transcript, its subagents, its prompts in omp's history, its title, and its pins.
  It never shows under the past sessions, never resumes, and cannot be forked, and omp's memory and autolearn stay off for it.
  While it is on, the pill fills dark, the composer gets a dark outline, and the starters give way to what ending deletes and what stays: files it changes and commits it makes stay in the project, and a personal one keeps its memory.
  A private session shows a dark **Private** chip in its sidebar row and its header.
  It ends when its omp process stops, whether through **End session**, `end_session`, or a crash; a dashboard that was not running then deletes it at its next start.
  The pill hides on a draft that starts from a todo, since nothing may link to a private session.
- When the directory is in a git checkout, a branch picker sits after the directory picker.
  The picker lists the local branches, the checked-out one first, then the most recently committed to, each with where it would run: `here`, the worktree that has it checked out, or `new worktree`.
  Picking the checked-out branch keeps the directory as it is.
  Picking another branch runs omp in the worktree that has it checked out, or adds a worktree for it when none has.
  Type a name that no branch has to create that branch from the branch picked before it, as GitHub's branch menu does; a new branch always gets its own worktree.
  A new worktree goes beside the repository's main worktree, named after both with each run of characters other than letters, digits, `.`, `-`, and `_` turned into `-` (`~/code/webapp-fix-login` for `fix/login`).
  Hovering the workspace in the header then shows the directory omp will run in, after the draft's own.
  The worktree is added only when you send the first message, and a branch or worktree that git refuses shows git's reason above the composer.
- omp titles a session that the dashboard started from its first message, as it does in a terminal, within a few seconds and while the first turn still runs.
  omp's RPC mode titles no prompt by itself, so once omp holds a message of an untitled session, the dashboard sends it a bare `/rename`, which makes omp title the session from the conversation so far.
  Until the title arrives, the sidebar and the header show the workspace's name.
  A conversation of greetings or acknowledgements only, such as `hi`, stays untitled until a later message.
  omp counts that title as one that you set, as it counts a `/rename` in a terminal.
- Click a session's title in its pane header to rename it, while the dashboard runs it or once it is a past omp session.
  Enter, or clicking away, saves the title; Escape keeps the old one, and an empty or unchanged title changes nothing.
  omp keeps the title as one that you set, so its automatic title never replaces it.
  A session running in a terminal takes `/rename` there, and a Claude Code or Codex session keeps its own title.
  A past session that another omp is writing to, such as one resumed in a terminal, keeps its title and says to rename it there with `/rename`.
- A running session shows **End session** in its header, unless its room is read-only: a stop icon, whose tooltip names it and its Cmd+W shortcut.
  **End session** stops its omp process: one that the dashboard started stops with every process it started, its background jobs, kernels, and subagents included, and a terminal session gets `SIGTERM`, as when its terminal closes, so its terminal returns to the shell.
  A session the dashboard started that exits on its own takes those processes with it too.
  omp records the exit in the session file, and the session moves to the past sessions, where **Resume** continues it.
  The dashboard then removes the linked git worktree the session works in, the one whose branch its header names, with the checks of **Settings → Worktrees**, and keeps its branch; **Resume** then reports that the directory no longer exists until you check the branch out there again.
  A worktree that those checks keep, such as one with uncommitted changes or one another session uses, stays in **Settings → Worktrees**, whose **Delete** applies the same checks; a session in a main checkout or outside git leaves its directory as it is.
  The header shows **Ending…** until the process stops and the worktree check finishes.
  Each pane that showed the session, or one of its subagents, moves to the next running session the sidebar lists, else the previous one, skipping sessions already open in a pane.
  With none left, the pane closes and the dashboard shows its empty state.
  On a private session, **End session** in the header and in the row's menu asks again in place, since ending deletes it; Cmd+W ends it without asking.
- An agent ends its own session through the `end_session` tool, when you ask it to, for example "Merge on main, then end the session".
  It comes from `~/.omp/agent/extensions/end-session.ts`, which `bun run omp-template` installs.
  The session ends once the agent's turn is over, so its last reply stays in the transcript, and it moves to the past sessions as with **End session**, not as interrupted, its worktree removed the same way.
  The tool leaves its request as `<session id>.json` in `end-inbox/` beside `todos.json`; a message sent before the dashboard acts withdraws it, and a request waits while the dashboard is down.
- **Resume** in a past session's header starts omp on that session's file from the dashboard, as `omp --resume <session id>` does in a terminal.
  The pane then shows the live session, which carries on in the same file and moves to the running sessions.
  A session whose omp process exited mid-turn, for example because the computer restarted, resumes too: omp records the interrupted turn first, as it does in a terminal.
  If another omp process still writes the file, omp writes the resumed session's entries to a new file instead of mixing the two.
  The past sessions then list both files, and **Resume** on the older one opens the newer one, which holds its whole conversation and what came after, as `omp --resume` does; it says the session is already running while the newer one runs.
  **Fork from here** reads the file the pane shows.
- Every commit an omp session makes carries an `Omp-Session: <session id>` trailer, from `~/.omp/agent/extensions/session-trailer.ts`, which `bun run omp-template` installs.
  `git log --format='%h %(trailers:key=Omp-Session,valueonly)'` lists each commit's session, and `omp -r <session id>` or **Resume** on that session reopens it.
- Click **Fork from here** under a prompt or a turn's last reply to start a dashboard session that holds the conversation up to that point, as omp's `/branch` does.
  A fork from a prompt leaves that prompt out of the history and puts it in the composer, so you can edit and resend it.
  omp writes the fork to a new session file and does not change the original.
  A session whose omp process exited mid-turn cannot be forked until you resume it once, with **Resume** or in omp, because opening it would make omp append an abort record to the original.
- In a session started from the dashboard, double-click your last message, or click its pencil, to edit it in place.
  Enter resends it and Esc, or clicking away, cancels; Shift+Enter starts a new line.
  While the server rewinds and resends, the editor keeps your text and shows **Resending…**; it closes only after the server answers, and a failure leaves the text and error in place.
  The session then rewinds to just before that message and runs the edited one, in the same pane and omp process, stopping a running turn first.
  omp moves the session to a new file, as `/branch` does, so the conversation before the edit stays under the past sessions.
  Only a plain text message that omp has saved can be edited: not a skill prompt, one with images or files, or a message in a terminal session.
