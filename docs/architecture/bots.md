# Bots

A Bot is a named, long-lived teammate: one conversation, a job, and a memory.
`src/shared/bots.ts` holds the model, `Bot` and `BotChange`, and `applyBot`, the reducer that the page and the server share.
`src/server/bots-file.ts` keeps the list in `bots.json` beside the access token.
A save keeps the Bot's `sessionId`, and a remove forgets the Bot but leaves its session file and its memory directory; the `Dashboard` removes the Bot's routines first.
Each Bot also keeps where it lists, `pinned` and `section`, which a save keeps and only `pin`, `move`, and `rename-section` change; a Bot saved before them reads as neither pinned nor in a section.
A section is only the name its Bots share, so `rename-section` renames it for every Bot in it, or with `to: null` moves them all out, and the section goes with its last Bot.
A Bot's `shape` and `hue`, one of `BOT_SHAPES` and `BOT_HUES`, are its avatar's look; `parseBotSpec` gives an entry saved before them the look `defaultLook` hashes from its id, so an old Bot keeps its face.
A new Bot's `job` is empty until its first conversation gives it one: the extension then tells the Bot to ask for it and call `set_job` with the answer.
A Bot's `kind`, one of `BOT_KINDS`, is its type: `routines`, or `pr-shepherd`, described in [PR shepherds](#pr-shepherds).
The page picks it when it makes the Bot, `parseBotSpec` reads an entry saved before kinds as `routines`, and `applyBot` keeps the stored kind through every later save, so a Bot never changes type.

`Bots` in `src/server/bots.ts` binds each Bot to the session its conversation runs in.
A new session whose `StartRequest` names a `bot`, or the resume of a session some Bot holds, launches omp with `-e` and the Bot extension, `src/omp/bot-extension.ts`, and the flags in `BOT_FLAGS`: the Bot's id, the `bots.json` path, the `bot-inbox/` directory beside it, its `memory.md` path, the `routines.json` path, and the `routine-inbox/` directory beside it.
Only `Bots` sets `bot`, since `parseNewSessionRequest` never reads one, so a page cannot start a Bot's session.
A PR shepherd's session also loads `src/omp/shepherd-extension.ts` with a second `-e`, and the flags in `SHEPHERD_FLAGS`: the Bot's id and the `shepherd-inbox/` directory beside `bots.json`.
Any other start launches plain, so no other session loads the extension.
Once the session is live, `Bots` saves its session id on the Bot, and follows it after a `/move` or an edited prompt (`switched`).

The extension adds to the main agent's system prompt on every turn the Bot's name, its job, its memory, and its routines, read again each turn, so a saved job or routine reaches the next turn.
Each routine of the Bot is one short line, or **None yet.**, followed by one sentence on how a run acts and which tool creates, changes, or deletes one.
The line holds the routine's id, name, `enabled`, schedules, and triggers as one JSON object in the shapes `save_routine` takes, then its task's kind and the first 80 characters of its prompt or command, its whitespace collapsed, with `…` when it was cut.
The extension parses `routines.json` with `parseRoutineSpec` and keeps the entries whose `botId` is the Bot's; a missing or unreadable file, or a session started without the `routines.json` flag, reads as no routines.
The name, job, and memory need only the Bot's id, `bots.json`, and `memory.md` flags.
Its `remember` tool appends `- YYYY-MM-DD fact` to `$XDG_DATA_HOME/omp-agents/bots/<id>/memory.md`, and nothing else writes that file.
It refuses a fact longer than `MAX_FACT_LENGTH`, 500 characters, so each fact stays one short sentence.
`readTail` in `src/read-tail.ts` reads only the file's newest whole lines within `MAX_MEMORY_BYTES`, 16 KB, of its end, so a memory that grows for months costs each turn the same; when it left older lines out, the prompt says so before the memory.

The extension's `set_job` tool replaces the Bot's own job, and never writes `bots.json`.
It takes one `job`, the whole job as Markdown, trims it, refuses one longer than `MAX_JOB_LENGTH`, 20,000 characters, the limit `parseBotSpec` holds a job the page saves to, and an empty one clears the job.
It writes one `BotJobRequest` (`src/shared/bots.ts`), the Bot's id and its job, into `bot-inbox/` the way the routine tools write theirs, and loads as `essential` and asks approval as a write.
The server's `BotInbox` in `src/server/bot-inbox.ts` reads each file with `parseBotJobRequest` and saves the Bot with only its `job` changed through the list registry's `bots` save, as the page's **Save job** does, so every page hears it and the next turn's prompt reads it from `bots.json`.
It moves aside as `<name>.invalid`, with a logged reason, a file that is no request, a job for a Bot that is gone, and a save the Bots refuse; a job the Bot already holds is done and deleted.
Only the server that owns the lock drains it, so a job waits there while the dashboard is stopped.

The extension's `save_routine` and `delete_routine` tools change only the Bot's own routines, and never write `routines.json`.
`save_routine` takes an optional `id`, `name`, `schedules` (each `every` some `minutes`, or `weekly` on `days` at a `time`), `triggers` (each `{ kind }`, one of `TRIGGER_KINDS`), `task` (a `prompt` or a `command`), and `enabled`, the fields of a `RoutineSpec` but its `botId`.
With an `id`, the id must name a routine of the Bot in `routines.json`, and every field the call leaves out keeps the routine's value, so a change names only what changes.
Without one it creates a routine with a new random id, and needs a `name`, a `task`, and at least one schedule or trigger; it runs unless `enabled` is false.
The tool merges against `routines.json` as it reads it and the request carries the whole routine, so a page edit saved between that read and the request's apply is overwritten.
`delete_routine` takes the `id` of one of the Bot's routines.
Both check the routine with `parseRoutineSpec`, so they hold the page's limits, refuse an id that is not the Bot's with an error, and otherwise write one `BotRoutineRequest` (`src/routines.ts`), the requesting Bot's id, which a saved routine's `botId` must match, and a `save` or `remove` change, into `routine-inbox/` under a `.tmp` name and rename it to `<time>-<uuid>.json`.
The server's `RoutineInbox` applies it, and checks ownership again; see [Routines](routines.md).
Both tools load as `essential` and ask approval as writes, as `remember` does.

A `bot` socket message carries one `BotChange`.
`save`, `remove`, `pin`, `move`, and `rename-section` go through the list registry, so every socket hears the new list as a `bots` message, with as much of each Bot's memory as the prompt carries, so the message stays as small as the prompt's.
The same message carries each Bot's last words, which `lastMessage` reads from the end of its session file, and the server sends it again as each turn of a Bot's conversation starts and ends, so the sidebar's previews and times follow the conversation.
`Bots.msg` keeps each Bot's memory and last words as it read them, and reads one Bot's files again only when its conversation moved to another session or its session started or ended a turn or exited (`changed`), so a push reads one Bot's files, not every Bot's.
`message` calls `Bots.message`, which answers once omp took the text: a follow-up in the live session, else a resume of the Bot's session followed by the text, else a new session in the Bot's workspace that starts with it.
Messages to one Bot wait on one another, so two at once never start two conversations.

Every routine belongs to one Bot through its `botId`; see [Routines](routines.md).
A prompt routine sends its prompt through `Bots.message` and records a `sent` outcome with the session id, and a command routine runs in the Bot's workspace, then posts how it ended the same way; the routine neither tracks nor ends that session.
The details in the right sidebar, `BotDetails`, list its routines in their own tab and its conversation's usage, `GET /api/analytics/session`, in **Details**; `#bots/<id>/routines` shows the card of them all, `RoutinesCard`, in place of the conversation, `#bots/<id>/routines/<routine id>` the same card with that routine's row open, `#bots/<id>/routines/<routine id>/edit` its editor, and `#bots/<id>/routines/new` the editor of a new one.

The page's `#bots/<id>` shows the Bot's session through `ViewConversation`, the conversation a pane draws, and the server streams only that view while the page covers the panes (`watched` in `web/use-dashboard.ts`).
`useAttention` in `web/use-attention.ts` counts that view as shown, so an unread turn of the open Bot is marked read as it would be in a pane.
`useDashboard` works out the open Bot once with `openBot` in `web/bots-model.ts` and hands it to the page, the details, `watched`, and `useAttention`: its conversation's view is the live session that runs it, else its saved one, and none while the page shows the routines card, a routine editor, or a routine its address names but the Bot does not have.

## PR shepherds

A new `pr-shepherd` Bot's save, in the list registry's `bots` entry in `src/server/dashboard.ts`, also saves `shepherdRoutine` from `src/shared/shepherd.ts`: routine `<bot id>-pull-requests`, with a `pull-request` trigger and a prompt task, so the routine runner wakes the shepherd with the pull requests that became your move.
The page fills a new shepherd's job with `SHEPHERD_JOB` and its name with `SHEPHERD_NAME`; the server does not, so the job stays one the user can edit.
The shepherd extension adds its rules to the main agent's system prompt and registers two tools, which load as `essential` and ask approval as writes.
`fix_pull_request` takes `owner`, `repo`, `number`, and an `action` from `SHEPHERD_FIXES`, the repairing quick actions of `PULL_REQUEST_ACTIONS` (`src/pull-request-actions.ts`).
`queue_merge` takes `owner`, `repo`, `number`, and an optional `method`, `squash` when left out.
Each checks the pull request's name with `parsePullRequest` and writes one `ShepherdRequest` into `shepherd-inbox/` as the routine tools write theirs.

`ShepherdInbox` in `src/server/shepherd-inbox.ts` drains it on the server that owns the lock, one request at a time, as every `JsonInboxDir` applies its files, so a second ask for the same fix sees the session the first one started.
It sets aside a file that is no request, or one from a Bot that is gone or is not a shepherd.
It reads the pull requests fresh with `loadPullRequests` over the known workspaces, finds the one the request names, and asks `shepherdRefusal`, which refuses a pull request you did not write, a draft or a merged one, one that is not approved, and one a running session works on (`agentOn`).
A fix is refused too when its action no longer applies (`pullRequestActions`), or once it started `MAX_FIXES_PER_PULL_REQUEST`, 2, times on that pull request since the server started; otherwise the inbox starts `newSessionRequest` in the repository's first workspace with the action's prompt, its branch as a `work` branch, and the pull request as its subject, as the page's quick action does.
A merge is refused unless `readyToMerge` or `readyOnceChecksPass` holds, and unless `unapprovedChange` in `src/pull-request-approval.ts` finds the head's stable `git patch-id` equal to an approved review's commit's; it then adds the pull request to the merge queue with `head: null`, so the queue pins the head it reads.
A refusal, a failed start, and any error post `The dashboard did not … : <why>.` into the shepherd's conversation through `Bots.message`, and delete the file, so the Bot can tell you instead of asking again.
See `2026-10-30-pr-shepherd-is-a-bot-type-over-quick-actions-and-the-merge-queue` and `2026-10-30-a-shepherd-merges-only-a-head-with-an-approved-commits-patch-id` in [decisions](../decisions/).

