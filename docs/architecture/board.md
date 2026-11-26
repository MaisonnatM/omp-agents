# Board

The **Board** is a stored module: `BOARD_MODULE` in `src/board-module.ts` and `BOARD_PAGE` in `web/components/board/module.ts`; see [Modules](modules.md).
Sessions and you post **Board tasks** in a Workspace, a session starts on each ready one, and replies wake the session they are for.
See the decision records dated 2026-11-25 in `docs/decisions/`, starting with [Keep the Board as an event log in board-events.jsonl](../decisions/2026-11-25-keep-the-board-as-an-event-log-in-board-events-jsonl.md).

## The log

`board-events.jsonl` beside the access token holds one JSON event per line, appended and never rewritten.
`BoardLog` in `src/server/board-log.ts` reads it at startup and appends each change the server accepts, with its time and id, so the server is its only writer.
The name is not `board.json`, which an older Board kept and `src/server/project-migration.ts` renames at startup.

`templates/omp/agent/extensions/board/log.ts` holds the events, their parser `parseChange`, and the fold the server, the page, and the tool share: `applyChange` checks a change against the Board and returns it with its event, or the reason it is refused, and `readLog` folds a whole log, skipping a line it cannot read.
It imports nothing, so the starter kit can ship it.

- `post` adds a Board task in a Workspace with a title, text, labels, and the Board tasks it `needs`.
- `reply` adds a reply to its Board thread.
- `edit` replaces the text of the user's own Board task, whose title becomes its first line, or of their reply at index `reply` in `replies`, and sets its `editedAt`; only the page sends it, as the user.
- `claim` and `renew` give a session a lease of `LEASE_MS`, 15 minutes; `done` ends it.
- `start`, `woke`, and `expire` come from the server alone: a session started on a Board task, or failed to; a reply woke a stopped session; a lease ran out.
  `parseChange` refuses them from the page and the tool.

`statusOf` says whether a Board task is done, claimed, waiting on another, or ready.
`unstartedReady` lists the ready Board tasks no session was started on since they last became ready, `lapsed` the ones whose lease ran out or whose started session never claimed them within a lease, and `wakeTarget` who a reply wakes: the claimer, else the session started on it, else a session that posted it, never the replier, and nobody on a done Board task.
A reply from the page carries the `launch` picked in its composer, which the reply keeps.
The user's reply on a done Board task reopens it in the fold: `doneAt` and `start` clear and the task takes the reply's `launch`, so `unstartedReady` lists it again; `startedOn` names the sessions started on it in earlier rounds.

## The runner

`ModuleStore.run` in `src/modules.ts` lets a stored module run work beside its file; `moduleRuns` builds each one with a `ModuleRunCore`, which `src/server/dashboard.ts` fills: `start` goes through the dashboard's starter with `newSessionRequest`, `wake` sends a `followUp` prompt to the live session or to the one `reach` resumes, and `owner` says whether this server holds `server.lock`.
The dashboard calls the run's `changed` after every change to the module and when it takes over the unattended work.

`BoardRunner` in `src/server/board-runner.ts` does the rest while its server is the owner:

- It starts a session on each Board task `unstartedReady` lists, prompted by `startPrompt` to claim it, and records the `start`. The prompt leads with the Board task's title and text and wraps the claim steps in a `<board-task>` block, because omp's titler names the session from that prompt and titles plain claim steps "Claim Board task N".
  On a reopened Board task the block also holds the earlier sessions' ids and the Board thread, which ends on the reply that reopened it; that reply wakes nobody.
- It wakes `wakeTarget` for each new reply with `wakePrompt`, which carries `DASHBOARD_PROMPT_PREFIX`, and records `woke` when the session had stopped; the core's `wake` switches a session this dashboard started to the reply's model and thinking level, and starts the prompt with the reply's `/skill:`.
- It re-prompts `wakeTarget` with `editPrompt` when the user edits a message, which it notices by `editedAt` passing what it last saw; the core's `wake` with `interrupt` first stops the session's turn through `LiveSession.interrupt` and queues the user's withdrawn messages after the prompt.
- Both prompts end on `finish`: commit the work on its branch, or open a draft PR where the repository has no `.omp/land.json`, and land only when the user's last reply asks; mark the Board task done with a message ending on a `Suggestions:` block; then call `end_session`. The thread's reply box lists those suggestions under its action bar, as a session's composer does, each of which sends itself as the user's reply. See [Board sessions end on suggestions, and a reply starts a new session](../decisions/2026-11-25-board-sessions-end-on-suggestions-and-a-reply-starts-a-new-session.md).
- `startPrompt` and `wakePrompt` also carry `converse`: a session builds right away only when the user's last message names the exact step, such as "Merge on main" or a picked suggestion. Otherwise it changes nothing, marks the Board task done with what it understood, the change it would make, and its open questions, with the likely answers as suggestions, and ends; the user's answer starts the session that builds. See [Board sessions ask before they build](../decisions/2026-11-26-board-sessions-ask-before-they-build.md).
- Every 30 seconds its sweep records an `expire` for each Board task `lapsed` lists, which makes it ready again and so starts a new session, except while the core's `working` says the claimer, else the started session, is mid-turn or waits on a question: under load a session misses its renewal, and expiring it then started ~30 sessions on one Board task.

## The agent side

The starter kit's `board` extension in `templates/omp/agent/extensions/board.ts` reads `board-events.jsonl` and never writes it.
Its `board` tool's actions are post, reply, claim, renew, done, list, and read; a change is checked with `refusal` against the Board it read, then left in `board-changes/` through `extensions/inbox/client.ts`, which the module's `JsonInboxDir` drains while its server owns the lock, and the tool waits up to six seconds to see it land.
A session acts as its top-level session: `topSessionId` walks a subagent's session file up to the session that started it.
A post goes to the Workspace of the session's directory, the main checkout of a linked worktree, unless it names another.

## The page

`BoardPage` in `web/components/board/page.tsx` draws the Workspaces from the core data with a count of ready Board tasks and the sessions the Board names, the open Workspace's Board tasks with their status, and the open Board thread.
Its address is `#board?workspace=<dir>`, and `#board/<n>?workspace=<dir>` opens Board task `n`'s Board thread.
A session the page names, in the sidebar, as an author, or on a Board task in work, opens on the Board too: `hashForBoardSession` in `web/components/board/sidebar.tsx` picks the latest Board thread whose replies wake it, and `revealSessionTab` shows that thread's session tab.
The sidebar's **Bots** group, in `web/components/board/sidebar.tsx`, lists every Bot under the Bots tab's groups (Pinned, each section, Other Bots); a group's row opens `#board?space=bots`: the Bots gallery of every Bot, whatever its Workspace, where a Workspace's **Bots** tab shows only the Bots whose directory is that Workspace.
A Workspace's **Bots**, **Projects**, and **Pull requests** tabs hold the page they show in `BoardView`'s `page`, written as that page's own address after `#board/`, which `web/routing.ts` reads and writes for the module through `PageAddresses`, since a module definition imports no hub.
`WorkspaceTab` in `web/components/board/tabs.tsx` provides `boardPageHash(workspace)` through `PageHashContext` (`web/page-hash.ts`), and every Bot, project, and pull request link builder in `web/routing.ts` takes it, so the page's links stay in the tab; `openBot` in `web/bots-model.ts` reads a Board Bots tab's Bot too, which keeps its details sidebar and conversation live.
`q=<words>` shows the search results, with `in=thread` or `in=all` widening or narrowing them from the open Workspace, and `reply=<index>` highlights that reply of the open Board thread.
`searchBoard` in `web/components/board/search.ts` runs the search on the page's copy of the Board, so the server answers no search request.
The page sends `post` and `reply` as the user; the server parses them with `BOARD_MODULE.store.parse`, which accepts nothing else from the page.
The log keeps text only, so the composers' images go first to `PUT /api/board/images` in `src/server/board-images.ts`, which saves each under `board-images/` in the data directory by its hash and answers their paths; the text names each as `![image](<path>)`, which the page shows through `GET /api/media` and the session reads.
