# Personal sessions

- A personal session is your own assistant for everyday life, such as meals and recipes, shopping, plans, habits, and family logistics, rather than a coding agent on a project.
  A session is personal exactly when it runs in the personal directory, `personal` in the dashboard's data directory: `$XDG_DATA_HOME/omp-agents/personal`, else `~/.local/share/omp-agents/personal`.
  The dashboard creates that directory when it starts; it is not a git repository and holds no agent code, so starting there never asks you to [trust project code](per-project-agent-setup.md#trusting-a-projects-code).
- To start one, click **Personal** under **New session** in the sidebar, or press Cmd+Shift+P (Ctrl+Shift+P elsewhere).
  A personal draft's page asks "What can I help with?" and lists no starters under the composer; its composer asks about meals, plans, and errands.
  Neither the directory pickers, on a new session, a conversation's move, and a Bot's workspace, nor the sidebar's workspace picker list it.
- The page calls that directory **Personal** wherever it names a workspace: the badge on a row under all workspaces, a directory picker's button on a personal session, and the command palette.
  An untitled session's row still reads as its directory's name, `personal`, until omp titles it.
- Every turn of a personal session's main agent starts with the assistant's framing and what it remembers about you; its subagents get neither.
  It keeps any file it makes in the personal directory, which the [file dialog](changed-files-and-images.md) can open.
- When you tell it something about yourself worth keeping, such as a preference, an allergy, or a household fact, it calls `remember` with one short sentence of at most 500 characters.
  `remember` adds the fact, dated, as one line of `personal-memory.md` beside the personal directory, which every personal session shares; a later fact overrides an earlier one.
  It never keeps secrets such as passwords or card numbers.
  A [private](starting-ending-resuming-and-forking.md) personal session reads and writes the same memory, since you asked for what it keeps.
- The [session details sidebar](session-details-sidebar.md) of a personal session adds a **Memory** tab, which lists every fact with the day it was kept.
  The page only lists the facts; to change or forget one, edit `personal-memory.md` itself.
- A personal session also has a `sport` tool for your training: it reads your week with each day's workouts and loads, a metric's history as a chart, and the whole training file, logs a workout, records a test result, and sets your plan and targets.
  When you have a plan, each turn also starts with one line for today: the phase, the day's workouts, and any pain flag.
  The dashboard saves each change the tool leaves; while it is stopped, the change waits and the tool already reads it.
  The tool never changes or removes what you entered yourself, and removing an entry stays on the Sport page.
- A session started in the personal directory stays there: its agent has no `move_session` tool.
  If you move one out yourself, its next turns lose the framing, the memory, and the line for today, and `remember` and `sport` refuse.
- A Bot whose workspace is **Personal** stays a Bot: it keeps its own memory, not the personal one.
