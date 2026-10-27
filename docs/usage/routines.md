# Routines

- A routine belongs to one [Bot](bots.md), and on its schedules, its triggers, or both, it messages that Bot or runs a shell command in the Bot's workspace.
  Every routine has a Bot; deleting a Bot deletes its routines.
- Click a Bot's name at the top of its page to see its **Routines** in its details: each with its last run's dot, its name, and its schedules and triggers, or **Paused**.
  Click the **Routines** heading to open the Bot's routines card in place of the conversation, at `#bots/<Bot id>/routines`, or click one routine to open the card with its row open, at `#bots/<Bot id>/routines/<routine id>`.
- Routines run only while the dashboard runs; a time missed while it was down, or while the Mac was off or asleep, starts one run once it is back.
  In the desktop app, **Open at Login** keeps it running from the moment you log in.
- **New routine**, under **Routines** in the Bot's details or at the top of its routines card, opens the editor in place of the conversation: a name, its task, its schedules, and its triggers.
  The task is **Send a message**, a message that goes into the Bot's conversation each run, as if you wrote it there, or **Run a command**, a shell command.
  Each schedule repeats every so many minutes, hours, or days, counted from the last run a schedule or **Run now** started, or runs at a time of day on the days you pick.
  **Weekdays** and **Every day** pick those days at once.
  **Add schedule** adds another.
  The routine runs at the earliest of them, and a missed time still starts one run.
  With a trigger checked, **Remove** can take its last schedule, so the routine runs only on its triggers.
- **Triggers** also start a run when something new happens:
  - **When a Slack message waits on you**: a mention or direct message you have not answered, once Slack is signed in under **Settings › Integrations**.
    What already waits when you sign in starts nothing.
  - **When a pull request waits on you**: one of yours, or one waiting on your review, comes to wait on you, such as a review asked of you, its checks failing, a conflict, comments to address, or it becoming ready to merge.
    A draft, checks still running, or a session at work on it, such as a Bot pushing a fix, starts nothing until it ends waiting on you.
  - **Before a calendar event starts**: a timed event on this Mac's calendars or a signed-in Google Calendar comes within 10 minutes of its start.
  - **When unread mail comes in**: a new message, unread, in the inbox of a Gmail account signed in under **Settings › Integrations**, in a new conversation or an old one.

  They watch what the bell and the Email page already read: Slack, pull requests, and Gmail every 2 minutes, calendars every minute.
  Everything that happened between two checks starts one run, and the run gets what the trigger saw: a message gets it after the routine's text, as data rather than as instructions, and a command gets it as a JSON list in `$ROUTINE_TRIGGERS`, which is `[]` when a schedule or **Run now** started it.
  What happened while the dashboard was quit starts nothing when it comes back, nor does what was already there when it started.
  A triggered run leaves the schedules alone: an hourly routine still runs on the hour.
- A message reaches the Bot the way your own does: it follows the Bot's running session, resumes its saved one, or starts its first.
  A routine starts no session of its own, so the Bot keeps one conversation, and its answers show there.
- A command runs with `sh` in the Bot's workspace, without an omp session.
  The command runs with your user's full permissions, and nothing asks before it acts: a file it deletes is gone.
  It stops after 10 minutes, and its run keeps the last 64 KB of what it printed, stdout and stderr together.
  When it ends, the dashboard posts into the Bot's conversation which routine ran what, how it ended, and its output, which the Bot reads as data rather than as instructions.
  If the Bot cannot take that message, the run keeps the output anyway and lists why among its errors.
  A command routine whose last command still runs records an error instead of running a second one.
  Its runs read **Running…**, **Succeeded**, **Failed (exit n)**, **Stopped at the time limit**, **Stopped with the dashboard**, or **Could not start**, and anything but a success also counts as an error.
- The routines card lists every routine of the Bot under how many of them are on schedule, with **New routine** at the top.
  Each row shows the routine's name, **Run now** while you point at the row or tab into it, and a switch that pauses or resumes the routine.
  Under the name are its schedules and its next run, counting down by the second in its last hour, or **Paused**, and its last run's mark and time.
  The last line shows the logos of its triggers, its message or command, and its last 10 runs as ticks, oldest on the left; pointing at a tick, or focusing it, shows how the run went, when, how long its command took, and what started it.
  The mark and the tick are green when the run went fine, red when it had an error, blue while its command runs, and amber while it waits to start.
  While a run is under way, the row reads **Running…** over a moving line, which holds still when your system asks to reduce motion.
  On a narrow card, **Run now** shows only its icon and the last run's time leaves the row.
  Click a row to open it in place, which closes the one open before; click a tick to open the row on that run.
  The arrow keys move between the routines' names, and between the ticks of a strip.
- An open row shows the run it picked, the latest one at first, with what triggered it, its command's output, and its errors.
  A message's run reads **Sent to** and the Bot's name, a link to its conversation, once it went in.
  A triggered run lists each thing it saw, linked to the Slack message, pull request, mail, or event when it can.
  Output longer than 20 lines folds behind **Show output**.
  Then it shows the routine's instructions, its message or command in full, and its schedule: **Hourly**, **Daily**, **Weekdays**, or **Weekly**, with its time and, for **Weekly**, its day, each saved as you change it.
  A routine whose schedules fit none of these lists them with no choice picked, and picking one replaces them; its triggers stay.
  **Edit** opens the full editor, and **Delete** asks first, then closes the row.
  **Run now** runs it at once whatever its schedules, and shows progress until the server sends the message or starts the command, not until it finishes.
  **Back to** and the Bot's name returns to the conversation.
- Routines run only while the dashboard runs.
  A slot missed while the dashboard was closed runs once when it starts again, however many slots it missed.
  Quitting the dashboard stops a running command, and the next start does not run it again; its run reads **Stopped with the dashboard**.
- Routines made before every routine had a Bot move to Bots as the dashboard that runs the routines starts or takes over.
  Each one goes to one Bot named **Routines**, made once, which works in the first routine's workspace, else your home directory.
  A command that ran in another workspace now starts with `cd` into it, and a prompt that did starts by naming it; a prompt's skill moves into the message as `/skill:` and its name.
  Pinning a finished session is gone, since a Bot keeps its one conversation.
- When more than one dashboard runs, such as a second one on another port, only one runs the routines and takes the todos that agents add; it is the first one started, and the server on another port says so in its log when it starts.
  If that one quits, another takes over within a minute.
- The server keeps the routines in `routines.json` beside its access token, so every window of the app shows the same ones.
  While the page has lost the server, the routines cannot be changed.
