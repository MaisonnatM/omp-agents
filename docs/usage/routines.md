# Routines

- A routine belongs to one [Bot](bots.md), and on one or more schedules it messages that Bot or runs a shell command in the Bot's workspace.
  Every routine has a Bot; deleting a Bot deletes its routines.
- Click a Bot's name at the top of its page to see its **Routines**: each with its last run's dot, its name, and its schedules, or **Paused**.
  Click one to open it in place of the conversation, at `#bots/<Bot id>/routines/<routine id>`.
- Routines run only while the dashboard runs; a time missed while it was down, or while the Mac was off or asleep, starts one run once it is back.
  In the desktop app, **Open at Login** keeps it running from the moment you log in.
- **New routine**, under **Routines** in the Bot's details, opens the editor in place of the conversation: a name, its task, and its schedules.
  The task is **Send a message**, a message that goes into the Bot's conversation each run, as if you wrote it there, or **Run a command**, a shell command.
  Each schedule repeats every so many minutes, hours, or days, counted from the last run, or runs at a time of day on the days you pick.
  **Weekdays** and **Every day** pick those days at once.
  **Add schedule** adds another.
  The routine runs at the earliest of them, and a missed time still starts one run.
- A message reaches the Bot the way your own does: it follows the Bot's running session, resumes its saved one, or starts its first.
  A routine starts no session of its own, so the Bot keeps one conversation, and its answers show there.
- A command runs with `sh` in the Bot's workspace, without an omp session.
  The command runs with your user's full permissions, and nothing asks before it acts: a file it deletes is gone.
  It stops after 10 minutes, and its run keeps the last 64 KB of what it printed, stdout and stderr together.
  When it ends, the dashboard posts into the Bot's conversation which routine ran what, how it ended, and its output, which the Bot reads as data rather than as instructions.
  If the Bot cannot take that message, the run keeps the output anyway and lists why among its errors.
  A command routine whose last command still runs records an error instead of running a second one.
  Its runs read **Running…**, **Succeeded**, **Failed (exit n)**, **Stopped at the time limit**, **Stopped with the dashboard**, or **Could not start**, and anything but a success also counts as an error.
- A routine's page shows its message or command in full, then its last 10 runs, newest first, each with its dot, its command's output, and its errors; beside them, its status, **Active** or **Paused**, schedules, and next run.
  The dot is green when the run went fine, red when it had an error, blue while its command runs, and amber while it waits to start.
  A message's run reads **Sent to the Bot** once it went into the conversation.
  Output longer than 20 lines folds behind **Show output**.
  **Run now** runs it at once whatever its schedules, and shows progress until the server sends the message or starts the command, not until it finishes.
  Its **⋯** menu has **Pause** or **Resume**, **Edit**, and **Delete**, which asks first.
  **Back to** and the Bot's name returns to the conversation.
- Routines run only while the dashboard runs.
  A slot missed while the dashboard was closed runs once when it starts again, however many slots it missed.
  Quitting the dashboard stops a running command, and the next start does not run it again; its run reads **Stopped with the dashboard**.
- Routines made before every routine had a Bot move to Bots as the dashboard starts.
  A routine that messaged a Bot stays with that Bot.
  Every other one goes to one Bot named **Routines**, made once, which works in the first such routine's workspace, else your home directory.
  A command that ran in another workspace now starts with `cd` into it, and a prompt that did starts by naming it; a prompt's skill moves into the message as `/skill:` and its name.
  Pinning a finished session is gone, since a Bot keeps its one conversation.
- When more than one dashboard runs, such as a second one on another port, only one runs the routines and takes the todos that agents add; it is the first one started, and the server on another port says so in its log when it starts.
  If that one quits, another takes over within a minute.
- The server keeps the routines in `routines.json` beside its access token, so every window of the app shows the same ones.
  While the page has lost the server, the routines cannot be changed.
