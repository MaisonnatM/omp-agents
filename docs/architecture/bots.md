# Bots

A Bot is a named, long-lived teammate: one conversation, a job, and a memory.
`src/shared/bots.ts` holds the model, `Bot` and `BotChange`, and `applyBot`, the reducer that the page and the server share.
`src/server/bots-file.ts` keeps the list in `bots.json` beside the access token.
A save keeps the Bot's `sessionId`, and a remove forgets the Bot but leaves its session file and its memory directory; the `Dashboard` removes the Bot's routines first.
A Bot's `shape` and `hue`, one of `BOT_SHAPES` and `BOT_HUES`, are its avatar's look; `parseBotSpec` gives an entry saved before them the look `defaultLook` hashes from its id, so an old Bot keeps its face.
A new Bot's `job` is empty until its first conversation gives it one: the extension then tells the Bot to ask for it and `remember` the answer.

`Bots` in `src/server/bots.ts` binds each Bot to the session its conversation runs in.
A new session whose `StartRequest` names a `bot`, or the resume of a session some Bot holds, launches omp with `-e` and the Bot extension, `src/omp/bot-extension.ts`, and the flags in `BOT_FLAGS`: the Bot's id, the `bots.json` path, and its `memory.md` path.
Only `Bots` sets `bot`, since `parseNewSessionRequest` never reads one, so a page cannot start a Bot's session.
Any other start launches plain, so no other session loads the extension.
Once the session is live, `Bots` saves its session id on the Bot, and follows it after a `/move` or an edited prompt (`switched`).

The extension adds to the main agent's system prompt on every turn the Bot's name, its job, and its memory, read again each turn, so a saved job reaches the next turn.
Its `remember` tool appends `- YYYY-MM-DD fact` to `$XDG_DATA_HOME/omp-agents/bots/<id>/memory.md`, and nothing else writes that file.
It refuses a fact longer than `MAX_FACT_LENGTH`, 500 characters, so each fact stays one short sentence.
`readTail` in `src/read-tail.ts` reads only the file's newest whole lines within `MAX_MEMORY_BYTES`, 16 KB, of its end, so a memory that grows for months costs each turn the same; when it left older lines out, the prompt says so before the memory.

A `bot` socket message carries one `BotChange`.
`save` and `remove` go through the list registry, so every socket hears the new list as a `bots` message, with as much of each Bot's memory as the prompt carries, so the message stays as small as the prompt's.
The same message carries each Bot's last words, which `lastMessage` reads from the end of its session file, and the server sends it again as each turn of a Bot's conversation starts and ends, so the sidebar's previews and times follow the conversation.
`Bots.msg` keeps each Bot's memory and last words as it read them, and reads one Bot's files again only when its conversation moved to another session or its session started or ended a turn or exited (`changed`), so a push reads one Bot's files, not every Bot's.
`message` calls `Bots.message`, which answers once omp took the text: a follow-up in the live session, else a resume of the Bot's session followed by the text, else a new session in the Bot's workspace that starts with it.
Messages to one Bot wait on one another, so two at once never start two conversations.

Every routine belongs to one Bot through its `botId`; see [Routines](routines.md).
A prompt routine sends its prompt through `Bots.message` and records a `sent` outcome with the session id, and a command routine runs in the Bot's workspace, then posts how it ended the same way; the routine neither tracks nor ends that session.
The details in the right sidebar, `BotDetails`, list its routines, `#bots/<id>/routines` shows the card of them all, `RoutinesCard`, in place of the conversation, `#bots/<id>/routines/<routine id>` the same card with that routine's row open, `#bots/<id>/routines/<routine id>/edit` its editor, and `#bots/<id>/routines/new` the editor of a new one.

The page's `#bots/<id>` shows the Bot's session through `ViewConversation`, the conversation a pane draws, and the server streams only that view while the page covers the panes (`watched` in `web/use-dashboard.ts`).
`useAttention` in `web/use-attention.ts` counts that view as shown, so an unread turn of the open Bot is marked read as it would be in a pane.
`useDashboard` works out the open Bot once with `openBot` in `web/bots-model.ts` and hands it to the page, the details, `watched`, and `useAttention`: its conversation's view is the live session that runs it, else its saved one, and none while the page shows the routines card, a routine editor, or a routine its address names but the Bot does not have.
