# Routines

- A routine belongs to one Workspace, and on its schedules, its triggers, or both, it posts a Board task on that Workspace's [Board](board.md), or runs a shell command in the Workspace and posts its report.
  The Board starts a session on that Board task as it does on any other, in its own worktree, with the routine's model if it has one; see [Board](board.md).
  While the routine's last Board task is not done, a run replies on it instead, which wakes its session, so one open Board task gathers a routine's runs until a session marks it done.
- Each Workspace's Board has a **Routines** tab, at `#board/routines?workspace=<cwd>`, which lists that Workspace's routines; click one to open its row in place, at `#board/routines/<routine id>?workspace=<cwd>`.
  A Board task a routine posted shows the routine's name as its author, which opens the routine's row; once the routine is deleted, the name stays as plain text.
  A routine's address under another Workspace's tab opens it in its own Workspace's tab; one no Workspace has reads **No such routine**.
- Routines run only while the dashboard runs; a time missed while it was down, or while the Mac was off or asleep, starts one run once it is back.
  In the desktop app, **Open at Login** keeps it running from the moment you log in.
- Routines also wait through the few seconds the Mac wakes on its own while asleep, for Power Nap or the network, since a run started then would stall when it sleeps again.
  What came due starts once the Mac fully wakes, and the news a trigger saw meanwhile starts one run.
- **New routine**, at the top of the **Routines** tab, opens the editor: a name, its Workspace, its model, its task, its schedules, and its triggers.
  The Workspace is the Board it posts on; the tab's Workspace starts picked.
  The model, effort, and skill are those the session that takes each Board task starts with; the Board's defaults when none is picked.
  A routine's saved effort stays while the model list loads or fails to load.
  The task is **Post instructions**, the text the Board task carries, or **Run a command**, a shell command, with optional instructions the Board task carries above the command's report.
  Each schedule repeats every so many minutes, hours, or days, counted from the last run a schedule or **Run now** started, or runs at a time of day on the days you pick.
  **Weekdays** and **Every day** pick those days at once.
  **Add schedule** adds another.
  The routine runs at the earliest of them, and a missed time still starts one run.
  With a trigger checked, **Remove** can take its last schedule, so the routine runs only on its triggers.
- **Triggers** also start a run when something new happens:
  - **When a Slack message waits on you**: a mention or direct message you have not answered, once Slack is signed in under **Settings › Integrations**.
    What already waits when you sign in starts nothing.
  - **When a pull request waits on you**: one of yours, or one waiting on your review, comes to wait on you, such as a review asked of you, its checks failing, a conflict, comments to address, or it becoming ready to merge.
    A draft, checks still running, or a session at work on it, such as one pushing a fix, starts nothing until it ends waiting on you.

  They watch what the bell already reads: Slack and pull requests every 2 minutes.
  Everything that happened between two checks starts one run, and the run gets what the trigger saw: a Board task gets it after the routine's instructions, as data rather than as instructions, and a command gets it as a JSON list in `$ROUTINE_TRIGGERS`, which is `[]` when a schedule or **Run now** started it.
  What happened while the dashboard was quit starts nothing when it comes back, nor does what was already there when it started.
  A triggered run leaves the schedules alone: an hourly routine still runs on the hour.
- A session that takes a routine's Board task and finds nothing to report marks it done quietly, with one line, which raises no notification and leaves the Board task read.
- A command runs with `sh` in the Workspace's main checkout, without an omp session.
  The command runs with your user's full permissions, and nothing asks before it acts: a file it deletes is gone.
  It stops after 10 minutes, not counting the time the Mac sleeps, and its run keeps the last 64 KB of what it printed, stdout and stderr together.
  When it ends, the dashboard posts a Board task, or a reply on the routine's open one, with which routine ran what, how it ended, how long the Mac slept while it ran, if it did, and its output, which the session reads as data rather than as instructions.
  A command that ends while the Mac sleeps posts once the Mac fully wakes.
  **Post the report** picks when a run posts: **Every run**; **Only when it fails**, where a command that exits 0 keeps its output on the run, in the routine's open row, and posts nothing; or **When it fails or its output changes**, which also posts a run that exits 0 with output other than the last run's, so a cheap check reaches the Board only on news. A non-zero exit, a stop, or a failure to start always posts.
  A command routine whose last command still runs records an error instead of running a second one.
  Its runs read **Running…**, **Succeeded**, **Failed (exit n)**, **Stopped at the time limit**, **Stopped with the dashboard**, or **Could not start**, and anything but a success also counts as an error.
- The **Routines** tab lists every routine of the Workspace under how many of them are on schedule, with **New routine** at the top.
  Each row shows the routine's name, **Run now** while you point at the row or tab into it, and a switch that pauses or resumes the routine.
  Under the name are its schedules and its next run, counting down by the second in its last hour, or **Paused**, and its last run's mark and time.
  A routine another machine runs, as [Settings sync](settings-sync.md) carries it, reads **Runs on** and that machine's name, with its switch off; turning the switch on moves it to this machine, and its schedules count from then.
  The last line shows the logos of its triggers, its instructions or command, and its last 10 runs as ticks, oldest on the left; pointing at a tick, or focusing it, shows how the run went, when, how long its command took, and what started it.
  Beside the ticks, the row shows what the sessions on its kept runs' Board tasks cost together, such as **$0.31 over 8 runs**, and an open run shows its own tokens and cost, such as **12.3k tokens · $0.04**; a command run that posts nothing costs nothing.
  The mark and the tick are green when the run went fine, red when it had an error, blue while its command runs or it posts, and amber while it waits to start.
  While a run is under way, the row reads **Running…** over a moving line, which holds still when your system asks to reduce motion.
  On a narrow card, **Run now** shows only its icon and the last run's time leaves the row.
  Click a row to open it in place, which closes the one open before; click a tick to open the row on that run.
  The arrow keys move between the routines' names, and between the ticks of a strip.
- An open row shows the run it picked, the latest one at first, with what triggered it, its command's output, and its errors.
  A run that posted reads **Posted Board task #** and its number, a link to its Board thread.
  A triggered run lists each thing it saw, linked to the Slack message or pull request when it can.
  Output longer than 20 lines folds behind **Show output**.
  Then it shows the routine's instructions or command in full, and its schedule: **Hourly**, **Daily**, **Weekdays**, or **Weekly**, with its time and, for **Weekly**, its day, each saved as you change it.
  A routine whose schedules fit none of these lists them with no choice picked, and picking one replaces them; its triggers stay.
  **Edit** opens the full editor, and **Delete** asks first, then closes the row.
  **Run now** runs it at once whatever its schedules, and shows progress until the server posts the Board task or starts the command, not until it finishes.
- A session the dashboard started can also save or delete the routines of its own Workspace, the main checkout of its worktree, with its `save_routine` and `delete_routine` tools; a routine it makes posts on that Workspace's Board.
- **Add to every new Workspace**, in a routine's editor, copies the routine into each Workspace you work in that lacks it: every visible one that is a repository's main checkout when you turn it on, and each new one as you start working there.
  Each copy is its own routine, enabled or paused as the original was when copied, which later edits of the original do not change; its editor says which routine it was copied from.
  A copy you delete stays deleted, and turning the switch off stops new copies without removing any.
- Routines run only while the dashboard runs.
  A slot missed while the dashboard was closed runs once when it starts again, however many slots it missed.
  Quitting the dashboard stops a running command, and the next start does not run it again; its run reads **Stopped with the dashboard**.
- Once a day, and as it starts, the dashboard that runs the routines checks the runs of the last day and raises one notification, under **Routines** in [Notifications](notifications.md), for the runs that exited early.
  A run exited early when it errored, its Board task's session ended with no reply and without marking it done quietly, it took less than a quarter of the routine's usual time, or it started an hour or more after its schedule said.
  A routine whose next run is an hour or more overdue counts as missing its schedule too.
- The dashboard adds two routines of its own, each once, each paused until you turn it on, and each in the omp-agents checkout's Workspace.
- **Friday routine receipt** runs on Fridays at 17:00 once on.
  It reads the week's runs and their cost from `routines.json` and replies with one table: each routine's runs, useful runs (not marked done quietly, skipped, or failed), tokens, cost, and a verdict to keep it, slow it down, or retire it. It changes no routine.
- **Weekly harness review** is paused; turn it on to run it on Mondays at 9:00.
  Each run first says whether last week's proposed change fixed the failures it named, from the replay of them you ran once that change landed, or says in one line that the replay was never run.
  It then reads the last week of `ship-trace.jsonl` beside the access token, for every repository, `LEARNINGS.md`, the failed merges, and the failed routine runs.
  It groups by cause the failures and the pull requests whose fixes hit the round limit or stalled, proposes exactly one harness change as a decision for you, and lists five past failures to replay to test that change.
  It saves those five as replay tasks, and its reply, in `~/.cache/omp-harness-review/`, and ends with the command that replays them on the worker model once the change lands.
  It edits no repository and writes nothing outside that folder.
  If you delete it, it does not come back.
- Routines that belonged to a Bot move to that Bot's directory as their Workspace as the dashboard that runs the routines starts or takes over, with the Bot's model, and with the Bot's job and memory added to their instructions under **Job** and **Memory**; a routine whose Bot is gone is dropped.
  The routines file from before is kept as `routines.json.before-board`, and the Bots file as `bots.json.migrated`; if a routine cannot move, both stay as they are and the log says which.
- When more than one dashboard runs, such as a second one on another port, only one runs the routines; it is the first one started, and the server on another port says so in its log when it starts.
  If that one quits, another takes over within a minute.
- The server keeps the routines in `routines.json` beside its access token, so every window of the app shows the same ones.
  While the page has lost the server, the routines cannot be changed.
