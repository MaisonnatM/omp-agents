# Personal sessions

- A personal session is a session in your Personal space: your own assistant for everyday life, such as meals and recipes, shopping, plans, habits, and family logistics, or an agent on a project of your own life rather than your job.
  A session is personal exactly when it runs in a workspace in the Personal space, or in a worktree of one.
  The personal directory, `personal` in the dashboard's data directory (`$XDG_DATA_HOME/omp-agents/personal`, else `~/.local/share/omp-agents/personal`), is always in the Personal space.
  To place a repository there, open Settings › Workspaces and pick **Personal** beside it; every workspace starts in **Work**, and a directory you open inside a Personal workspace, rather than a worktree of it, stays in **Work**.
  The dashboard creates the personal directory when it starts; it is not a git repository and holds no agent code, so starting there never asks you to [trust project code](per-project-agent-setup.md#trusting-a-projects-code).
- A session takes its space from where it runs, so a resumed or forked session in a Personal workspace is personal too, and placing a workspace back in **Work** turns its sessions back into work sessions from their next turn.
- To start one in the personal directory, switch to **Personal** with the switch at the top of the window, or press Cmd+Shift+P (Ctrl+Shift+P elsewhere), then click **New session in Personal**, or press Cmd+N, with no workspace picked in the sidebar; see [Sessions sidebar](sessions-sidebar.md).
  A personal draft's page asks "What can I help with?"; its composer asks about meals, plans, and errands.
  In Personal the directory pickers, on a new session and a conversation's move, and the sidebar's workspace picker list the personal directory first, then the Personal workspaces.
  To start one on a Personal repository, pick that workspace in Personal, or in the new session's directory picker, and start a session as usual.
- The page calls that directory **Personal** wherever it names a workspace: the badge on a row under **All of Personal**, a directory picker's button on a personal session, and the command menu.
  An untitled session's row still reads as its directory's name, `personal`, until omp titles it.
- Every turn of a personal session's main agent starts with a framing and what it remembers about you; its subagents get neither.
  In the personal directory the framing makes it your assistant for everyday life; in a Personal repository it tells the agent the project is part of your own life, not your job.
  A session in the personal directory keeps any file it makes there, which the [file dialog](changed-files-and-images.md) can open.
- When you tell it something about yourself worth keeping, such as a preference, an allergy, or a household fact, it calls `remember` with one short sentence of at most 500 characters.
  `remember` adds the fact, dated, as one line of `personal-memory.md` beside the personal directory, which every personal session shares, in whichever Personal workspace it runs; a later fact overrides an earlier one.
  It never keeps secrets such as passwords or card numbers.
  A [private](starting-ending-resuming-and-forking.md) personal session reads and writes the same memory, since you asked for what it keeps.
- The [session details sidebar](session-details-sidebar.md) of a personal session adds a **Memory** tab, which lists every fact with the day it was kept.
  The page only lists the facts; to change or forget one, edit `personal-memory.md` itself.
- A personal session also has a `sport` tool for your training: it reads your week with each day's workouts and loads, a metric's history as a chart, and the whole training file, logs a workout, records a test result, and sets your plan and targets.
  When you have a plan, each turn also starts with one line for today: the phase, the day's workouts, and any pain flag.
  The dashboard saves each change the tool leaves; while it is stopped, the change waits and the tool already reads it.
  The tool never changes or removes what you entered yourself, and removing an entry stays on the Sport page.
- A session started in the personal directory stays there: its agent has no `move_session` tool.
  A session on a Personal repository keeps `move_session`.
  If a session moves out of the Personal space, its next turns lose the framing, the memory, and the line for today, and `remember` and `sport` refuse.
- A Bot whose workspace is **Personal** stays a Bot: it keeps its own memory, not the personal one.
