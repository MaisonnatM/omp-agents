# Personal sessions

A personal session has no field of its own: a session is personal exactly when its directory is `personalDir` in `src/paths.ts`, `<data dir>/personal`.
Its memory is `personalMemoryFile`, `<data dir>/personal-memory.md`, a plain Markdown file shaped as a Bot's `memory.md`, beside the directory so omp never reads it as one of that directory's files.
For what the user sees, see [Personal sessions](../usage/personal-sessions.md).

## The extension

`personalJoin` in `src/server/personal.ts` is a `SessionJoin` in the dashboard's `#joinFor`, so every session the dashboard launches that is not a Bot's loads it with `-e` and the flags in `PERSONAL_FLAGS`, the personal directory and the memory file.
A Bot's session launches without it, so a Bot whose workspace is the personal directory keeps only its own memory.
A private session loads it as any other, so a private personal session reads and writes the shared memory.

The extension decides per turn from the hook's `ctx.cwd`, not at load, so a session that moves in or out follows.
Its `before_agent_start` returns nothing for a subagent or a directory other than the dir flag; otherwise it appends the framing and `memoryLines` of the memory file, the file's newest whole lines within `MAX_MEMORY_BYTES`, as a Bot's prompt carries its memory.
The comparison is exact string equality with the path the dashboard passed, as omp reports `ctx.cwd`.

`remember` is registered only once a session is personal, the first time `session_start` or `before_agent_start` sees the personal directory, so every other session's tool list stays as it was.
`session_start` alone is not enough: omp sets extension flags only after every extension loads (see [omp modules](omp-modules.md)), and a session can move in later.
A tool registered inside `before_agent_start` changes the turn's base system prompt, which omp answers by preparing the turn once more, so the tool is in the first personal turn.
Its `execute` checks the directory again and refuses outside it, which covers a session that moved out after the tool was registered.
The tool itself is `rememberTool` in `src/omp/extension-kit.ts`, shared with the Bot extension: it trims and collapses the fact, refuses an empty one or one over `MAX_FACT_LENGTH`, and appends `- YYYY-MM-DD <fact>`.
No inbox and no server writer stand between the tool and the file, as with a Bot's memory.

## Extension kit

`src/omp/extension-kit.ts` holds what the omp-agents extensions share: `ExtensionApi`, the slice of omp's extension API they use, `flagValue`, `readText`, `reply`, `memoryLines`, and `rememberTool`.
The Bot, designer, shepherd, router, and personal extensions import from it; `leave` and `BOT_FLAGS` stay in `src/omp/bot-extension.ts`.

## The server

The dashboard creates `personalDir` in `start()`.
It is outside git and holds no agent code, so `ProjectTrustFile.admit` passes for it without a trust; see [Project trust](project-trust.md).
`isPersonalDir` in `src/server/personal.ts` resolves a `~` path before comparing, since the page sends directories as shown.
`SessionMoves` takes `staysPut`, true for a Bot's conversation or a session started in the personal directory, and gives neither the `move_session` tool; the join is decided at launch, so a session that moves into the directory keeps the tool.

The page learns the directory and the memory from the read-only list message `personal`, `{ cwd, cwdDisplay, memory }`, which `personalMessage` builds and every socket gets on open.
The dashboard pushes it again after a personal session's turn ends and when one exits, since that turn may have remembered something, as it pushes `bots` for a Bot's memory.

## The page

`web/dashboard-state.ts` keeps the directory as `personal`, one object while it stays the same, and the memory text as `personalMemory`.
`PersonalContext` in `web/components/dashboard-context.tsx` provides the directory, and `workspaceName` in `web/labels.ts` names it **Personal** for the workspace pickers, the roster's new-session button, a row's workspace badge, and the command palette.
`DirectoryPicker` lists it first.
`SessionDetails` adds a **Memory** tab for a session whose `cwd` is the personal directory, with `MemoryList` from `web/components/memory-list.tsx`, which a Bot's details also use.
