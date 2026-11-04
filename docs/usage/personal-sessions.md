# Personal sessions

- A personal session is your own assistant for everyday life, such as meals and recipes, shopping, plans, habits, and family logistics, rather than a coding agent on a project.
  A session is personal exactly when it runs in the personal directory, `personal` in the dashboard's data directory: `$XDG_DATA_HOME/omp-agents/personal`, else `~/.local/share/omp-agents/personal`.
  The dashboard creates that directory when it starts; it is not a git repository and holds no agent code, so starting there never asks you to [trust project code](per-project-agent-setup.md#trusting-a-projects-code).
- To start one, click **Personal** under **New session** in the sidebar, press Cmd+Shift+P (Ctrl+Shift+P elsewhere), or pick **Personal**, the first item of the new session's directory picker.
  A personal draft's page asks "What can I help with?" and shows **Your assistant** under the composer, in place of the starters, with the newest facts it remembers and the personal sessions you can resume; its composer asks about meals, plans, and errands.
  The same picker on a conversation's move and a Bot's workspace lists it first too.
- The page calls that directory **Personal** wherever it names a workspace: the sidebar's workspace picker and its **New session in Personal** button, the badge on a row under all workspaces, the directory pickers, and the command palette.
  An untitled session's row still reads as its directory's name, `personal`, until omp titles it.
- Every turn of a personal session's main agent starts with the assistant's framing and what it remembers about you; its subagents get neither.
  It keeps any file it makes in the personal directory, which the [file dialog](changed-files-and-images.md) can open.
- When you tell it something about yourself worth keeping, such as a preference, an allergy, or a household fact, it calls `remember` with one short sentence of at most 500 characters.
  `remember` adds the fact, dated, as one line of `personal-memory.md` beside the personal directory, which every personal session shares; a later fact overrides an earlier one.
  It never keeps secrets such as passwords or card numbers.
  A [private](starting-ending-resuming-and-forking.md) personal session reads and writes the same memory, since you asked for what it keeps.
- The [session details sidebar](session-details-sidebar.md) of a personal session adds a **Memory** tab, which lists every fact with the day it was kept.
  The page only lists the facts; to change or forget one, edit `personal-memory.md` itself.
- A session started in the personal directory stays there: its agent has no `move_session` tool.
  If you move one out yourself, its next turns lose the framing and the memory, and `remember` refuses.
- A Bot whose workspace is **Personal** stays a Bot: it keeps its own memory, not the personal one.
