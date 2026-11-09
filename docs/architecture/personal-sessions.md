# Personal sessions

A personal session has no field of its own: a session is personal exactly when its directory is in the Personal space, as `spaces` in `src/shared/workspaces.ts` answers, the one rule the server, the personal extension, and the page share.
`spaces` takes the `personal` list of `workspaces.json`, which Settings › Workspaces sets, and the personal directory as a `Workspace`, and returns `isPersonalDir` and `of`.
`of` takes a directory and the workspace it counts in, the main checkout for a linked worktree as `WorkspacePlacement` in `src/workspace-placement.ts` finds it, else the directory itself.
The directory is Personal when `isPersonalDir` holds for it, or when its workspace is in the `personal` list; every other directory is Work, a subdirectory of either included.
`isPersonalDir` holds for `personalDir` in `src/paths.ts`, `<data dir>/personal`, named by its path or by its `cwdDisplay`, the `~` path the page shows and may send, with any trailing `/`.
The personal directory is always Personal, so the workspaces route refuses to move it to Work and Settings › Workspaces offers no picker for it; both read `isPersonalDir`.
See [Workspaces](http-api-workspaces.md) for the list.
Its memory is `personalMemoryFile`, `<data dir>/personal-memory.md`, a plain Markdown file shaped as a Bot's `memory.md`, beside the directory so omp never reads it as one of that directory's files.
For what the user sees, see [Personal sessions](../usage/personal-sessions.md).

## The extension

`personalJoin` in `src/server/personal.ts` makes a `SessionJoin` for the dashboard's `#joinFor` from how to tell a Bot's start, so every session the dashboard launches that is not a Bot's loads it with `-e` and the flags in `PERSONAL_FLAGS`: the personal directory, `workspaces.json`, the memory file, `sport.json`, and the sport inbox.
A Bot's session launches without it, so a Bot whose workspace is in the Personal space keeps only its own memory.
A private session loads it as any other, so a private personal session reads and writes the shared memory.

The extension decides per turn from the hook's `ctx.cwd`, not at load, so a session that moves in or out, or whose workspace Settings › Workspaces moves to the other space, follows.
`personalIn` reads the flags once omp has set them, reads `workspaces.json` with `readWorkspaces` from `src/workspace-list.ts` each time, asks git which workspace `ctx.cwd` counts in through its own `WorkspacePlacement`, once per directory, and then applies `spaces`.
The extension imports nothing from `src/server/`, since it runs inside omp, not in the dashboard.
Its `before_agent_start` returns nothing for a subagent or a directory in the Work space; otherwise it appends a framing and `memoryLines` of the memory file, the file's newest whole lines within `MAX_MEMORY_BYTES`, as a Bot's prompt carries its memory.
The framing makes the agent the user's personal assistant in the personal directory itself, and tells it a Personal repository is part of the user's own life, not their job, anywhere else.
When the Sport module has a plan, it then appends one line for today, under 300 characters, from `todayLine` in `src/omp/sport-tool.ts`: the phase and whether it is a deload week, the day's workouts with their log status, and the pain flags that hold.
The `personal` list is compared by exact string equality with the paths the dashboard keeps, as omp reports `ctx.cwd`.

`remember`, and `sport` when the dashboard passed both sport flags, are registered only once a session is personal, the first time `session_start` or `before_agent_start` sees it in the Personal space, so every other session's tool list stays as it was.
`session_start` alone is not enough: omp sets extension flags only after every extension loads (see [omp modules](omp-modules.md)), and a session can move in later.
A tool registered inside `before_agent_start` changes the turn's base system prompt, which omp answers by preparing the turn once more, so the tool is in the first personal turn.
Each tool's `execute` checks the space again and refuses outside the Personal space, which covers a session that moved out, or whose workspace moved to Work, after the tool was registered.
`remember` itself is `rememberTool` in `src/omp/extension-kit.ts`, shared with the Bot extension: it trims and collapses the fact, refuses an empty one or one over `MAX_FACT_LENGTH`, and appends `- YYYY-MM-DD <fact>`.
No inbox and no server writer stand between `remember` and the file, as with a Bot's memory.

## The sport tool

`sportTool` in `src/omp/sport-tool.ts` reads `sport.json` and folds in the requests still waiting in `sportInboxDir`, with `withAgentChanges` from `src/sport-agent.ts`, so a session sees its own change before the dashboard applies it.
`read` gives that state, `week` gives `weekPlan` with each exercise's load and the day's `painFlags`, and `history` gives a metric's measurements as a `chart` block's JSON.
These three run on omp's `read` approval and the four that leave a request on `write`, since the kit's `approval` may be worked out from a call's arguments.
`log` and `measure` add an entry in the session's name, the id omp's `ctx.sessionManager.getSessionId()` gives, or edit one the same session wrote with only the fields given, which the dashboard merges over the entry as it stands when it applies them.
`set_plan` and `set_targets` replace their part whole, and `set_plan` refuses a plan over `MAX_PLAN_BYTES`, 64 KB as JSON.
Each takes an optional `metrics` list, merged by id into the state's metrics before the change, since a fresh state holds no metric for a load rule, a target, or a measurement to name.
The tool checks its request with `agentSportChanges` as the dashboard will and leaves nothing when it is refused, so the agent reads the reason.
It then leaves the request, its session id, its metrics, and its change, as one file with `inbox` from `templates/omp/agent/extensions/inbox/client.ts`, whose names rise strictly within a process, so the dashboard applies them in order and each call applies whole or not at all.
The description lists the workout kinds from `WORKOUT_KINDS` and tells the agent to state each workout's `kind`, the one a mixed session leads with, since a plan without it is refused.
It also tells the agent to check a video through YouTube's oEmbed address before it writes one, and never to invent an id.

## Extension kit

`src/omp/extension-kit.ts` holds what the omp-agents extensions share: `ExtensionApi`, the slice of omp's extension API they use, whose hooks may answer with a promise, `ToolContext`, `PromptChange`, `flagValue`, `readText`, `reply`, `memoryLines`, and `rememberTool`, whose memory path may be worked out asynchronously from the call's directory.
The Bot, designer, shepherd, and personal extensions import from it; `BOT_FLAGS` stays in `src/omp/bot-extension.ts`.
Their tools reach their inboxes through `inbox` in `templates/omp/agent/extensions/inbox/client.ts`, the starter kit's `user_note`, `user_todo`, and `user_event` tools' too, so one copy names the inbox files.
`inbox<T>(dir)` types the changes an inbox takes: its `leave` writes one as a JSON file through a temporary name and a rename, under a name that sorts after the one before it, and its `waiting` reads those the dashboard has not applied yet, oldest first, leaving out a file that is not a JSON object.

## The server

The dashboard creates `personalDir` in `start()`.
It is outside git and holds no agent code, so `ProjectTrustFile.admit` passes for it without a trust; see [Project trust](project-trust.md).
The server builds `spaces` from its workspaces and `personalWorkspace` in `src/server/personal.ts`, the personal directory as the page shows it.
`SessionMoves` takes `staysPut`, true for a Bot's conversation or a session started in the personal directory itself, and gives neither the `move_session` tool; the join is decided at launch, so a session that moves into the directory keeps the tool, and a session on a Personal repository keeps it too.

The page learns the directory and the memory from the read-only list message `personal`, `{ cwd, cwdDisplay, memory }`, which `personalMessage` builds and every socket gets on open.
The dashboard pushes it again after a personal session's turn ends and when one exits, since that turn may have remembered something, as it pushes `bots` for a Bot's memory; it tells a personal session with `spaces` once `WorkspacePlacement.workspaceOf` has placed the session's directory, so a worktree git had not placed yet counts in its Personal workspace.

## The page

`web/dashboard-state.ts` keeps the directory as `personal`, one object while it stays the same, and the memory text as `personalMemory`.
`PersonalContext` in `web/components/dashboard-context.tsx` provides the directory, and `workspaceName` in `web/labels.ts` names it **Personal**, from the directory as shown, for the workspace pickers, the roster's new-session button, a row's workspace badge, and the command palette.
`DirectoryPicker` lists it first.
`SessionDetails` adds a **Memory** tab for a session `spaces` places in the Personal space, given the focused session's directory, its workspace from the roster, and the `personal` list of the `workspaces` message, with `MemoryList` from `web/components/memory-list.tsx`, which a Bot's details also use.
