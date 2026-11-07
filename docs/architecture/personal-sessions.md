# Personal sessions

A personal session has no field of its own: a session is personal exactly when its directory is `personalDir` in `src/paths.ts`, `<data dir>/personal`.
Its memory is `personalMemoryFile`, `<data dir>/personal-memory.md`, a plain Markdown file shaped as a Bot's `memory.md`, beside the directory so omp never reads it as one of that directory's files.
For what the user sees, see [Personal sessions](../usage/personal-sessions.md).

## The extension

`personalJoin` in `src/server/personal.ts` makes a `SessionJoin` for the dashboard's `#joinFor` from how to tell a Bot's start, so every session the dashboard launches that is not a Bot's loads it with `-e` and the flags in `PERSONAL_FLAGS`: the personal directory, the memory file, `sport.json`, and the sport inbox.
A Bot's session launches without it, so a Bot whose workspace is the personal directory keeps only its own memory.
A private session loads it as any other, so a private personal session reads and writes the shared memory.

The extension decides per turn from the hook's `ctx.cwd`, not at load, so a session that moves in or out follows.
Its `before_agent_start` returns nothing for a subagent or a directory other than the dir flag; otherwise it appends the framing and `memoryLines` of the memory file, the file's newest whole lines within `MAX_MEMORY_BYTES`, as a Bot's prompt carries its memory.
When the Sport module has a plan, it then appends one line for today, under 300 characters, from `todayLine` in `src/omp/sport-tool.ts`: the phase and whether it is a deload week, the day's workouts with their log status, and the pain flags that hold.
The comparison is exact string equality with the path the dashboard passed, as omp reports `ctx.cwd`.

`remember`, and `sport` when the dashboard passed both sport flags, are registered only once a session is personal, the first time `session_start` or `before_agent_start` sees the personal directory, so every other session's tool list stays as it was.
`session_start` alone is not enough: omp sets extension flags only after every extension loads (see [omp modules](omp-modules.md)), and a session can move in later.
A tool registered inside `before_agent_start` changes the turn's base system prompt, which omp answers by preparing the turn once more, so the tool is in the first personal turn.
Each tool's `execute` checks the directory again and refuses outside it, which covers a session that moved out after the tool was registered.
`remember` itself is `rememberTool` in `src/omp/extension-kit.ts`, shared with the Bot extension: it trims and collapses the fact, refuses an empty one or one over `MAX_FACT_LENGTH`, and appends `- YYYY-MM-DD <fact>`.
No inbox and no server writer stand between `remember` and the file, as with a Bot's memory.

## The sport tool

`sportTool` in `src/omp/sport-tool.ts` reads `sport.json` and folds in the changes still waiting in `sportInboxDir`, with `withAgentChanges` from `src/sport-agent.ts`, so a session sees its own change before the dashboard applies it.
`read` gives that state, `week` gives `weekPlan` with each exercise's load and the day's `painFlags`, and `history` gives a metric's measurements as a `chart` block's JSON.
`log` and `measure` add an entry in the session's name, the id omp's `ctx.sessionManager.getSessionId()` gives, or edit one an agent wrote by merging the given fields over it.
`set_plan` and `set_targets` replace their part whole, and `set_plan` refuses a plan over `MAX_PLAN_BYTES`, 64 KB as JSON.
`set_plan`, `set_targets`, and `measure` take an optional `metrics` list, merged by id into the state's metrics and left as a `set-metrics` before the change, since a fresh state holds no metric for a load rule, a target, or a measurement to name.
The tool checks every change with `agentSportChange` against the state the ones before it leave, and leaves none when one is refused, so the agent reads the reason.
It then leaves each change in the inbox with the kit's `leave`, whose names rise strictly within a process, so the dashboard applies them in order.
The description tells the agent to check a video through YouTube's oEmbed address before it writes one, and never to invent an id.

## Extension kit

`src/omp/extension-kit.ts` holds what the omp-agents extensions share: `ExtensionApi`, the slice of omp's extension API they use, `ToolContext`, `flagValue`, `readText`, `reply`, `leave`, `waiting`, `memoryLines`, and `rememberTool`.
`leave` writes a change as a JSON file in an inbox directory, through a temporary name and a rename, for the dashboard to apply, and `waiting` reads the changes an inbox still holds, oldest first.
The Bot, designer, shepherd, and personal extensions import from it; `BOT_FLAGS` stays in `src/omp/bot-extension.ts`.

## The server

The dashboard creates `personalDir` in `start()`.
It is outside git and holds no agent code, so `ProjectTrustFile.admit` passes for it without a trust; see [Project trust](project-trust.md).
`isPersonalDir` in `src/server/personal.ts` resolves a `~` path through `absoluteDir` in `src/paths.ts` before comparing, since the page sends directories as shown.
`SessionMoves` takes `staysPut`, true for a Bot's conversation or a session started in the personal directory, and gives neither the `move_session` tool; the join is decided at launch, so a session that moves into the directory keeps the tool.

The page learns the directory and the memory from the read-only list message `personal`, `{ cwd, cwdDisplay, memory }`, which `personalMessage` builds and every socket gets on open.
The dashboard pushes it again after a personal session's turn ends and when one exits, since that turn may have remembered something, as it pushes `bots` for a Bot's memory.

## The page

`web/dashboard-state.ts` keeps the directory as `personal`, one object while it stays the same, and the memory text as `personalMemory`.
`PersonalContext` in `web/components/dashboard-context.tsx` provides the directory, and `workspaceName` in `web/labels.ts` names it **Personal**, from the directory as shown, for the workspace pickers, the roster's new-session button, a row's workspace badge, and the command palette.
`DirectoryPicker` lists it first.
`SessionDetails` adds a **Memory** tab for a session whose `cwd` is the personal directory, with `MemoryList` from `web/components/memory-list.tsx`, which a Bot's details also use.
