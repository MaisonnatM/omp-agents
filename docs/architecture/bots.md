# Bots

A Bot is a named, long-lived teammate: one conversation, a job, and a memory.
`src/shared/bots.ts` holds the model, `Bot` and `BotChange`, and `applyBot`, the reducer that the page and the server share.
`src/server/bots-file.ts` keeps the list in `bots.json` beside the access token.
A save keeps the Bot's `sessionId`, and a remove forgets the Bot but leaves its session file and its memory directory.

`Bots` in `src/server/bots.ts` binds each Bot to the session its conversation runs in.
A new session whose `StartRequest` names a `bot`, or the resume of a session some Bot holds, launches omp with `-e` and the Bot extension, `src/omp/bot-extension.ts`, and the flags in `BOT_FLAGS`: the Bot's id, the `bots.json` path, and its `memory.md` path.
Only `Bots` sets `bot`, since `parseNewSessionRequest` never reads one, so a page cannot start a Bot's session.
Any other start launches plain, so no other session loads the extension.
Once the session is live, `Bots` saves its session id on the Bot, and follows it after a `/move` or an edited prompt (`switched`).

The extension adds to the main agent's system prompt on every turn the Bot's name, its job, and its memory, read again each turn, so a saved job reaches the next turn.
Its `remember` tool appends `- YYYY-MM-DD fact` to `$XDG_DATA_HOME/omp-agents/bots/<id>/memory.md`, and nothing else writes that file.

A `bot` socket message carries one `BotChange`.
`save` and `remove` go through the list registry, so every socket hears the new list as a `bots` message, with each Bot's memory file's text.
The same message carries each Bot's last words, which `lastMessage` reads from the end of its session file, and the server sends it again as each turn of a Bot's conversation starts and ends, so the sidebar's previews and times follow the conversation.
`Bots.msg` keeps each Bot's memory and last words as it read them, and reads one Bot's files again only when its conversation moved to another session or its session started or ended a turn or exited (`changed`), so a push reads one Bot's files, not every Bot's.
`message` calls `Bots.message`, which answers once omp took the text: a follow-up in the live session, else a resume of the Bot's session followed by the text, else a new session in the Bot's workspace that starts with it.
Messages to one Bot wait on one another, so two at once never start two conversations.

A routine whose task is `{kind: "bot", botId, prompt}` sends its prompt through `Bots.message` and records a `bot` outcome with the session id; the routine neither tracks nor ends that session.

The page's `#bots/<id>` shows the Bot's session through `ViewConversation`, the conversation a pane draws, and the server streams only that view while the page covers the panes (`watched` in `web/use-dashboard.ts`).
`useAttention` in `web/use-attention.ts` counts that view as shown, so an unread turn of the open Bot is marked read as it would be in a pane.
The page and both hooks find that view with `botView` and `openBotView` in `web/bots-model.ts`: the live session that runs the Bot's conversation, else its saved one.
