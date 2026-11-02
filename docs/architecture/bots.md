# Bots

A Bot is a named, long-lived teammate: one conversation, a job, and a memory.
`src/shared/bots.ts` holds the model, `Bot` and `BotChange`, and `applyBot`, the reducer that the page and the server share.
`src/server/bots-file.ts` keeps the list in `bots.json` beside the access token.
A save keeps the Bot's `sessionId`, and a remove forgets the Bot but leaves its session file and its memory directory; the `Dashboard` removes the Bot's routines first.
Each Bot also keeps where it lists, `pinned` and `section`, which a save keeps and only `pin`, `move`, and `rename-section` change; a Bot saved before them reads as neither pinned nor in a section.
A section is only the name its Bots share, so `rename-section` renames it for every Bot in it, or with `to: null` moves them all out, and the section goes with its last Bot.
A Bot's `shape` and `hue`, one of `BOT_SHAPES` and `BOT_HUES`, are its avatar's look; `parseBotSpec` gives an entry saved before them the look `defaultLook` hashes from its id, so an old Bot keeps its face.
A new Bot's `job` is empty until its first conversation gives it one: the extension then tells the Bot to ask for it and call `set_job` with the answer.
A Bot's `kind`, one of `BOT_KINDS`, is its type: `bot-designer`, described in [Bot designers](#bot-designers), `routines`, `pr-shepherd`, described in [PR shepherds](#pr-shepherds), or `router`, described in [Routers](#routers).
The page picks it when it makes the Bot, `parseBotSpec` reads an entry saved before kinds as `routines`, and `applyBot` keeps the stored kind through every later save, so a Bot never changes type.

`Bots` in `src/server/bots.ts` binds each Bot to the session its conversation runs in.
A new session whose `StartRequest` names a `bot`, or the resume of a session some Bot holds, launches omp with `-e` and the Bot extension, `src/omp/bot-extension.ts`, and the flags in `BOT_FLAGS`: the Bot's id, the `bots.json` path, the `bot-inbox/` directory beside it, its `memory.md` path, the `routines.json` path, and the `routine-inbox/` directory beside it.
Only `Bots` sets `bot`, since `parseNewSessionRequest` never reads one, so a page cannot start a Bot's session.
A Bot of another kind than `routines` also loads its kind's extension with a second `-e`, with any flags it reads beyond the Bot extension's, from the per-kind table `kindExtensions` in `src/server/bots.ts`.
A PR shepherd's session loads `src/omp/shepherd-extension.ts` with the flags in `SHEPHERD_FLAGS`, the Bot's id and the `shepherd-inbox/` directory beside `bots.json`.
A Router's loads `src/omp/router-extension.ts` with the flags in `ROUTER_FLAGS`, the Bot's id, the `router-inbox/` directory, and `router-tasks.json`, all beside `bots.json`.
A Bot designer's loads `src/omp/designer-extension.ts` with no flags of its own: it registers the Bot extension's `BOT_FLAGS.bot` and `BOT_FLAGS.botInbox` too, and omp keeps one value per flag name for every extension that registers it, which `flagValue` in `src/omp/bot-extension.ts` reads.
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
The server's `BotInbox` in `src/server/bot-inbox.ts` reads each file with `parseBotInboxRequest`, which tells a `set_job`'s `{ botId, job }` from a designer's `{ botId, create }`, and saves the Bot with only its `job` changed through the list registry's `bots` save, as the page's **Save job** does, so every page hears it and the next turn's prompt reads it from `bots.json`.
It moves aside as `<name>.invalid`, with a logged reason, a file that is no request, a request from a Bot that is gone, and a save the Bots refuse; a job the Bot already holds is done and deleted.
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

The page's `#bots/<id>` shows the Bot's session through `ViewConversation`, the conversation a pane draws, and asks for it through `useShowConversation` in `web/pane-store.ts`, so while a page covers the panes the server streams only the conversations pages show this way, such as the Bot's (`watched` in `web/use-dashboard.ts`).
`useAttention` in `web/use-attention.ts` counts the open Bot's view as shown, so an unread turn of the open Bot is marked read as it would be in a pane.
`useDashboard` works out the open Bot once with `openBot` in `web/bots-model.ts` and hands it to the page, the details, and `useAttention`: its conversation's view is the live session that runs it, else its saved one, and none while the page shows the routines card, a routine editor, or a routine its address names but the Bot does not have.

## Bot designers

The page fills a new designer's name with `DESIGNER_NAME`, **Dr Eggbot**, and its job with `DESIGNER_JOB` from `src/shared/bot-designer.ts`, adapted from Lauren Tan's Dr Eggbot Grok Bot; the server does not, so the job stays one the user can edit.
`BOT_KIND_START` in `web/bots-model.ts` holds each kind's starting name, job, Job hint, and templates.
`pickKind` and `pickTemplate` swap a name or job the form filled, blank or as the kind or one of its templates filled it, and keep one the user typed.
The designer extension adds its rules to the main agent's system prompt and registers one tool, `CREATE_TOOL` from `src/shared/bot-designer.ts`, `create_bot`, which loads as `essential` and asks approval as a write.
It takes a `name`, a `job` of at most `MAX_JOB_LENGTH` characters, an optional `kind`, `routines` when left out, and an optional `cwd`, the session's own workspace when left out, and refuses an empty name, a longer job, an unknown kind, or a workspace that is not the absolute path of a directory.
It writes one `BotCreateRequest` (`src/shared/bots.ts`), the designer's id and `create`, the new Bot's `id`, a fresh `randomUUID()`, its `kind`, `name`, `job`, and `cwd`, into `bot-inbox/` as `set_job` does.
`parseBotInboxRequest` reads `create` with `parseBotSpec`, so a create the page would refuse, or one with no `cwd`, is no request and moves aside.
`BotInbox` sets aside a create from a Bot that is not a `bot-designer` as misrouted; it guards against a request in the wrong place and is no permission, since only a designer's session has the tool.
A Bot that already has the id is the request applied already, so the file is done and deleted, and a create never edits another Bot.
Otherwise it saves the Bot, with no model or skill and the look `defaultLook` gives its id, through the list registry's `bots` save, the page's own path, so a new PR shepherd gets its routine too.

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
When the repository's first workspace commits `.omp/land.json` (`configAt` in the starter kit's `extensions/land/gate.ts`) and the pull request's base is its target, the inbox starts a session on the pull request's branch with `landPrompt` instead, since the `land` tool is the only way an agent reaches that branch; a pull request into another branch is still queued.
A refusal, a failed start, and any error post `The dashboard did not … : <why>.` into the shepherd's conversation through `Bots.message`, and delete the file, so the Bot can tell you instead of asking again.
See `2026-10-30-pr-shepherd-is-a-bot-type-over-quick-actions-and-the-merge-queue` and `2026-10-30-a-shepherd-merges-only-a-head-with-an-approved-commits-patch-id` in [decisions](../decisions/).

## Routers

A Router hands real work to tasks, background sessions the dashboard starts and tracks for it, after DeepSeek's Super-agent.
The page fills a new Router's name with `ROUTER_NAME`, **Atlas**, and its job with `ROUTER_JOB` from `src/shared/router.ts`, its rules: delegate, answer at once, stay quiet on events that need nothing, and ask only for decisions.
`src/shared/router.ts` also holds the task model, `RouterTask` and `TaskFollow`, a pull request, Slack thread, or Linear issue a task listens to, with `followKey`, which names the same thing the same way however it is cased.

`src/omp/router-extension.ts` registers `start_task`, `follow`, and `finish_task`, `essential` tools with `write` approval.
`start_task` takes a `title`, a `prompt`, and optional `cwd`, the Router's workspace when left out, `follows`, and `quiet`; it mints the task's id with `randomUUID`, so a request read twice starts one session, and returns it at once.
Each tool writes one `RouterRequest` into `router-inbox/`, as the shepherd's tools write theirs.
On every main-agent turn, `before_agent_start` appends the tools' rules and the Router's open tasks, read from the tasks file, one JSON line each with its id, title, status, and follow keys.

`Router` in `src/server/router.ts` wires the Router parts once, for `Dashboard`: it builds `RouterTasks`, `RouterInbox`, `RouterEvents`, and `RouterSupervisor` over one set of dependencies, starts and stops the inbox and the supervisor's loop, reloads the tasks and drains the inbox when the server takes over the owner lock, adds `RouterTasks.join` to each session's join, and takes the live sessions' exits, switches, and turns.

`RouterInbox` in `src/server/router-inbox.ts` drains the inbox on the server that owns the lock, and sets aside a file that is no request, or one from a Bot that is gone or is not a Router.
A start adds the task as `working`, then starts `newSessionRequest` in its directory with its prompt, and the first pull request or Linear issue it follows as its subject, through the same `startSession` the shepherd uses; it then binds the task to the session and renames the session after the task, so the Sessions tab shows it by name.
A failed start marks the task `stopped` with the error as its note.
That failure, and a `follow` or `finish_task` for a task that is not the Router's, post `The dashboard did not … : <why>.` into the Router's conversation through `Bots.message`.

`RouterTasks` in `src/server/router-tasks.ts` keeps the tasks in `router-tasks.json` through its own private `RouterTasksFile`, a `ReducerFile` over `applyRouterTask`, so its collaborators read and change tasks through it alone, and moves each as its session reports to `Dashboard`'s live updates.
It finds a session's task by the instance it was bound to: the inbox binds a task's new session at start, and `join`, like `Bots.join`, binds the resume of a task's session, whether the supervisor's, a passed-through event's, or `reattachAll`'s after a restart; it follows an edited prompt's new session file (`switched`).
A turn that ends, or a session that exits, while its task is `working` moves the task to `review`, which the Tasks tab shows as **Needs you**, and, unless the task is `quiet`, posts `Task "<title>" finished: <last line of the reply>` into the Router's conversation; a turn that starts on a task in `review` moves it back to `working`.
Only the server holding the owner lock moves tasks, so two servers never tell a Router twice.
The pages hear every task through the list registry's `router-tasks` entry, a `router-tasks` ServerMsg, and send a `router-task` ClientMsg, **Mark done** or **Stop**.
That message and a Router's `finish_task` carry the same `RouterTaskChange`, which `RouterTasks.change` applies; `stopped` ends the task's session.
Deleting a Bot deletes its tasks, in the registry's `bots` entry, before the Bot itself.
`RouterTasks.following` lists the open tasks that follow a given pull request, Slack thread, or Linear issue, for routing what happens there to the task that owns it.

A new `router` Bot's save, in the list registry's `bots` entry, also saves `routerRoutine` from `src/shared/router.ts`: routine `<bot id>-events`, **Team events**, with `slack` and `pull-request` triggers and a prompt task, so the routine runner wakes the Router with the Slack messages that wait on you and the pull requests that became your move, failing checks and comments to address among them.
`RouterEvents` in `src/server/router-events.ts` is the runner's `screen`, which sees each Bot's trigger events once per check, the events any of its routines watches, before its routines claim runs, so a Router with two routines on the same triggers counts and passes each event once; it lets any other Bot's events through.
For a Router's routine it first drops the events `needsNothing` in `src/shared/router-rules.ts` matches, rules in code and no model call: a Slack message with no words once emoji codes, links, and mentions are gone, or with at most `MAX_CHATTER_WORDS`, three, words, no `?`, and no word that asks for something or reports a problem.
The Slack check already leaves out your own messages, bots', and Slack's own, and reports neither reactions nor edits, and a pull request event is always kept.
It counts the dropped events per Router in memory.
It then reads each event's `TaskFollow` with `followOf`: the pull request a pull request event's link names, or, for a Slack permalink, the channel and the `thread_ts` it carries, else the message's own timestamp.
Each open task of that Router that `RouterTasks.following` finds with a session gets the events it follows in one `passThroughText` message, sent as a follow-up through `reach`, the live session else its resume, and the task's `heard` edit, which moves it from `review` back to `working` and stamps `updatedAt`; no Router turn runs for them.
The rest go to the Router, with any a task's session refused, so a routine whose events all dropped or passed through claims no run, and one check's remaining events, up to `MAX_TRIGGER_EVENTS`, reach the Router as one run and one message.
As the run sends, the screen's `prompt` adds to a triggered run's prompt each event's follow as JSON, from `followsText`, for `start_task` or `follow`, and, once, `droppedLine`, such as `3 team messages didn't need anything.`, which the run card shows under its prompt.
`ROUTER_JOB` tells the Router to start a quiet task that follows the thread for a bug report nobody answered, and to tell it to post there only once it has a result.

`RouterSupervisor` in `src/server/router-supervisor.ts` looks at every `working` task each `SUPERVISOR_TICK_MS`, two minutes, on `repeat`, while the dashboard runs; only the server holding the owner lock acts, and the others forget what they saw.
It reads the end of the task's session file through `readTaskTail`: the newest entry's id, the tool call the file ends on and how many times in a row it ran since the last prompt, the newest message's tool call that has no result yet, and the newest failed tool result.
A live session whose turn runs is stuck when that call repeated `LOOP_REPEATS`, four, times, or when neither its newest entry nor its running subagents' activity changed for `STALL_CHECKS`, three, looks in a row, or `LONG_CALL_CHECKS`, fifteen, while a tool call it made still has no result, such as a long build; a session waiting on you, or idle, is not.
A session that no longer runs here counts as died only once its file stays still for those looks too, so a session another server still runs is left alone.
A restart, through `RouterTasks.restart`, marks the task so the turn it stops ends without moving it to review, stops the turn with `interrupt`, and sends `The supervisor restarted you: <reason>. Last error: <error>. Continue the task.` as a follow-up, with the messages the stop took back, to the session, resumed through `reach` when it died.
Only once that follow-up is sent does the restart count in the task's `restarts` and set its `note` to the reason through the `restart` edit.
A restart that fails, such as a session that does not resume, counts nothing: it stops the task with `The supervisor could not restart it: <error>` as its note, which ends its session, and posts `The supervisor stopped task "<title>": it could not restart it: <error>.` into its Router's conversation.
A task that is not `quiet` posts `FYI: the supervisor restarted task "<title>": <reason>.` into its Router's conversation.
After `MAX_RESTARTS`, two, restarts, the next stuck look stops the task with the reason as its note, which ends its session, and posts `The supervisor stopped task "<title>" after 2 restarts: <reason>.` whether the task is quiet or not.

