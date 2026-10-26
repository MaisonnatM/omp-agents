# Routines

- A routine starts sessions, or runs a shell command, on one or more schedules.
  **All** under the **Calendar** tab, or a `#routines` address, lists them in place of the panes, and the sidebar lists each routine by name, a paused one muted.
  `#routines/<id>` opens one routine.
- Routines run only while the dashboard runs; a time missed while it was down, or while the Mac was off or asleep, starts one run once it is back.
  In the desktop app, **Open at Login** keeps it running from the moment you log in.
- **New routine** opens the editor: a name, the workspace it runs in, its task, its schedules, and its skill.
  The task is a prompt you write, or a shell command.
  A prompt task can also **Pin the session when it finishes**.
  Each schedule repeats every so many minutes, hours, or days, counted from the last run, or runs at a time of day on the days you pick. **Weekdays** and **Every day** pick those days at once. **Add schedule** adds another. The routine runs at the earliest of them, and a missed time still starts one run.
  The skill starts as the one pinned in **Settings › Preferences**, and **None** starts the sessions without one.
- A command routine runs its command with `sh` in its workspace, without an omp session, so it takes no skill and the editor hides that field.
  The command runs with your user's full permissions, and nothing asks before it acts: a file it deletes is gone.
  It stops after 10 minutes, and its run keeps the last 64 KB of what it printed, stdout and stderr together.
  A command routine whose last command still runs records an error instead of running a second one.
  Its runs read **Running…**, **Succeeded**, **Failed (exit n)**, **Stopped at the time limit**, **Stopped with the dashboard**, or **Could not start**, and anything but a success also counts as an error.
- Each row shows the routine's schedules and task, when it runs next or **Paused**, and what its last run did: how many sessions it started, how many errors it had, and **Queued** while its session waits for a free slot.
  Its **⋯** menu has **Run now**, which runs it at once whatever its schedules, **Pause** or **Resume**, **Edit**, and **Delete**, which asks first.
  **Run now** shows progress until the server starts or queues the run, not until its prompt or command finishes.
- A routine's page shows its settings and its last 10 runs, newest first, each with the sessions it started, its command's output, and its errors.
  Output longer than 20 lines folds behind **Show output**.
  Click a session to open it, live while it runs, else its transcript (Cmd-click, or Ctrl-click off macOS, opens it in a new pane).
  A run still opens a session in `/tmp`, which the sidebar does not list.
- At most 3 routine sessions run at once, and a queued run starts as one of them finishes.
  Commands do not count toward that limit.
  A prompt routine whose last session still runs records an error instead of starting a second one.
- A routine session runs unattended: its prompt tells it not to ask questions.
  Once its turn finishes, the dashboard ends it, so it moves to the past sessions with its transcript, and **Resume** continues it.
  With **Pin the session when it finishes** on, the session is pinned as its turn finishes, before it ends, so it shows under **Pinned** rather than **Past**.
  That pin replaces the one on the routine's previous session, and your other pins stay.
  A session that has not begun its turn 10 minutes after it started is ended, and its run records that as an error.
  Such a session is not pinned.
  A routine session keeps running when the dashboard restarts, still counts toward the 3, and ends, pinned when the routine asks, once its turn finishes.
- Routines run only while the dashboard runs.
  A slot missed while the dashboard was closed runs once when it starts again, however many slots it missed.
  Quitting the dashboard stops a running command, and the next start does not run it again; its run reads **Stopped with the dashboard**.
- When more than one dashboard runs, such as a second one on another port, only one runs the routines and takes the todos that agents add; it is the first one started, and the server on another port says so in its log when it starts.
  If that one quits, another takes over within a minute.
- The server keeps the routines in `routines.json` beside its access token, so every window of the app shows the same ones.
  While the page has lost the server, the routines cannot be changed.
