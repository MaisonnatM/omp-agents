# Board

The **Board** is a stored module: `BOARD_MODULE` in `src/board-module.ts` and `BOARD_PAGE` in `web/components/board/module.ts`; see [Modules](modules.md).
Sessions and you post **Board tasks** in a Workspace, a session starts on each ready one, and replies wake the session they are for.
See [The owner server runs each Board task from start to close](../decisions/2026-11-26-the-owner-server-runs-each-board-task-from-start-to-close.md), which gathers the Board's earlier decision records, and [Board tasks belong to their session](../decisions/2026-11-26-board-tasks-belong-to-their-session.md).

## The log

`board-events.jsonl` beside the access token holds one JSON event per line, appended and never rewritten.
`BoardLog` in `src/server/board-log.ts` reads it at startup and appends each change the server accepts, with its time and id; only the server that holds `server.lock` writes it, and `reload` folds the log again when a server takes the unattended work over, for what the previous owner appended since.
A line a crash cut off stays in the file, which the fold skips, and the next event starts a line of its own.
The name is not `board.json`, which an older Board kept and `src/server/project-migration.ts` renames at startup.

`templates/omp/agent/extensions/board/log.ts` holds the events, their parser `parseChange`, and the fold the server, the page, and the tool share: `applyChange` checks a change against the Board and returns it with its event, or the reason it is refused, and `readLog` folds a whole log, skipping a line it cannot read.
It imports nothing, so the starter kit can ship it.

- `post` adds a Board task in a Workspace with a title, text, labels, and the Board tasks it `needs`.
- `reply` adds a reply to its Board thread.
- `edit` replaces the text of the user's own Board task, whose title becomes its first line, or of their reply at index `reply` in `replies`, and sets its `editedAt`; only the page sends it, as the user.
- `close` marks a Board task that is not done done as the user, with a `closed` note; only the page sends it, and the runner ends the session that held it.
- `claim` lets an interactive session hold a Board task until it is done; a session the runner started holds its Board task from its `start` and never claims it.
- `done` marks a Board task done, from the session that holds it; a `quiet` done, a routine's run that found nothing to report, keeps `quiet` on its note only when a routine posted the Board task.
  That note is the one record of a quiet turn: `doneQuietly` reads it, and `LiveSessions.quietTurn` leaves a session that marked a Board task done quietly since its turn started as unread as it was before, with no notice; a refused done silences nothing.
- `start`, `woke`, `expire`, and `land` come from the server alone: a session started on a Board task, with its `branch`, or failed to, with the `error` its `start-failed` note keeps; a reply woke a stopped session; the session that held a Board task exited without marking it done; the server merged its branch on main, with an `outcome` of `landed`, `failed`, or `refused`.
  A `start` is refused unless the Board task is still ready with no start, so one that comes up after the Board task was claimed, closed, or done records nothing.
  `parseChange` refuses them from the page and the tool, and drops a `renew` line an older Board wrote while a claim lasted 15 minutes.
  It also refuses there the routine author, `{ kind: "routine", routineId, name }`, which only the server's routine runner posts and replies as; see [Routines](routines.md#the-runner).
  A post's or reply's text holds at most `MAX_TEXT` characters, and a routine's `MAX_ROUTINE_TEXT`, 128,000, so a whole run's prompt, trigger events, and command report fit.
- A change from the `board` tool carries `request`, the name of the inbox file it came in; the Board keeps the last `REQUESTS_KEPT` of them in `requests`, so a file a crash left behind after it was applied changes nothing the second time.

`statusOf` says whether a Board task is done, claimed, failed, waiting on another, or ready: `failed` when its last `start` failed, carrying that start's error, which the page shows with "Reply to try again".
`holderOf` names the session that holds it, its claimer else the session started on it.
After `MAX_EXITS`, 3, sessions in a row exit without marking it done, the fold records a failed start, so the runner starts no fourth.
`unstartedReady` lists the ready Board tasks no session was started on since they last became ready, and `wakeTarget` who a reply wakes: the claimer, else the session started on it, else a session that posted it, never the replier, and nobody on a done Board task.
A reply from the page carries the `launch` picked in its composer, which the reply keeps.
The user's reply on a done Board task reopens it in the fold: `doneAt` and `start` clear and the task takes the reply's `launch`, so `unstartedReady` lists it again; `startedOn` names the sessions started on it in earlier rounds, a resumed one again for each round it took.
`resumable` names the session the next round resumes: the one the last round started, when that round ended with it marking the Board task done; after a failed start, an exit, a close, or a done by another session it is `null`, and a new session starts.
So does the user's or a routine's reply on a Board task whose session failed to start, and the user's on one the user closed; a routine's reply never reopens a done one, since a routine's next run posts a new Board task instead.
A routine's Board task's start prompt tells its session to mark it done quietly, with one line, when it found nothing to report.
`landsOnReply` picks out the exception: the user's bare `MERGE_REPLY`, "Merge on main", on a done Board task that has a branch, which keeps it done.
A `failed` land reopens the Board task as a reply would; a `landed` one, which counts a branch with nothing left to merge, and a `refused` one, where the repository has no `.omp/land.json` or the user has not trusted the project, keep it done.
Each stays in its replies as a `landed`, `land-failed`, or `land-refused` note, which the Board thread shows.

## The runner

`ModuleStore.run` in `src/modules.ts` lets a stored module run work beside its file; `moduleRuns` builds each one with a `ModuleRunCore`, which `src/server/unattended-work.ts` fills: `start` goes through the dashboard's starter with `newSessionRequest`, `wake` sends a `followUp` prompt to the live session or to the one `reach` resumes, and `owner` says whether this server holds `server.lock`.
The dashboard calls the run's `changed` after every change to the module, and `takeOver` in `src/server/unattended-work.ts` calls it when the server takes over the unattended work.

`BoardRunner` in `src/server/board-runner.ts` does the rest while its server is the owner:

- It starts a session on each Board task `unstartedReady` lists and records the `start`.
  `boardCheckout` in `src/server/board-checkout.ts`, through the core's `checkout`, first gives the Board task its branch `board/<id>` (`taskBranch`) and worktree `<repository>-wt/board-<id>`.
  It reuses the worktree that has the branch, or adds one, from the branch or else the default branch; then it asks project trust to admit the worktree, and only then runs the `setup` commands of the repository's `.omp/land.json`.
  A worktree whose admission or setup failed is removed again, so the next try sets it up anew.
  The session runs in that worktree; a Workspace outside git runs it in the Workspace.
  A checkout that fails records a failed `start` with the reason.
- `startPrompt` is the session's whole contract: where it works and on which branch, `converse`, and `finish`. It leads with the Board task's title and text and wraps the rest in a `<board-task>` block, because omp's titler names the session from that prompt.
  On a reopened Board task the block also holds the earlier sessions' ids and the Board thread, which ends on the reply that reopened it or the merge that failed; that reply wakes nobody.
- On a reopened Board task that `resumable` names a session for, `#start` makes the checkout as for a new session, then resumes that session through the core's `wake` with `resumePrompt`: the thread since its `done`, less its own words, then `converse` and `finish`. It records the `start` with that session's id, so the sweep ends it again after its next `done` turn. A session that does not resume, such as one whose file is gone, leaves the round to a new session with `startPrompt`. See [A reply on a done Board task resumes its session](../decisions/2026-11-27-a-reply-on-a-done-board-task-resumes-its-session.md).
- It wakes `wakeTarget` for each new reply with `wakePrompt`, which carries `DASHBOARD_PROMPT_PREFIX`, and records `woke` when the session had stopped; the core's `wake` switches a session this dashboard started to the reply's model and thinking level, and starts the prompt with the reply's `/skill:`.
- It re-prompts `wakeTarget` with `editPrompt` when the user edits a message, which it notices by `editedAt` passing what it last saw; the core's `wake` with `interrupt` first stops the session's turn through `LiveSession.interrupt` and queues the user's withdrawn messages after the prompt.
- Both prompts end on `finish`: commit the work on the session's branch and never land it, or open a draft PR where the repository has no `.omp/land.json`; mark the Board task done with a message ending on a `Suggestions:` block, which suggests "Merge on main" only where the repository has a `.omp/land.json`. The thread's reply box lists those suggestions under its action bar, as a session's composer does, each of which sends itself as the user's reply. See [Board sessions end on suggestions, and a reply starts a new session](../decisions/2026-11-25-board-sessions-end-on-suggestions-and-a-reply-starts-a-new-session.md).
- On a reply `landsOnReply` picks out, it starts no session: through the core's `land`, `landBoardBranch` in `src/server/board-checkout.ts` lands the branch from the worktree that has it checked out, else from a detached checkout of its tip it removes after, so it neither adds a session's worktree nor runs its setup. It refuses a repository without `.omp/land.json` and a project trust does not admit, else runs `land` from `templates/omp/agent/extensions/land/lander.ts` off the event loop, and records the outcome as a `land` event. See [Board tasks belong to their session](../decisions/2026-11-26-board-tasks-belong-to-their-session.md).
- `startPrompt` and `wakePrompt` also carry `converse`: a session builds right away when the user's last message is clear, naming the exact step, such as "Merge on main" or a picked suggestion, or plainly saying what to change.
  When it is unclear, because it could mean changes that differ in what the user gets or leaves out something the code and thread do not answer, or when the user says the session missed the point, it changes nothing.
  It marks the Board task done with what it understood, the change it would make, and its open questions, with the likely answers as suggestions, and ends; the user's answer starts the session that builds. See [Board sessions ask before they build](../decisions/2026-11-26-board-sessions-ask-before-they-build.md).
- Every 3 seconds its sweep ends each session whose `done` turn has ended, and the session of a Board task the user closed, through the core's `end`, so a Board session never calls `end_session`.
  It also records an `expire` for a Board task whose holder the core's `alive` has not seen for `GONE_MS`, 30 seconds, which makes it ready again and so starts a new session, up to `MAX_EXITS` in a row; the wait covers a restarted server that has not yet attached to its sessions.

## The agent side

The starter kit's `board` extension in `templates/omp/agent/extensions/board.ts` reads `board-events.jsonl` and never writes it.
Its `board` tool's actions are post, reply, claim, done, list, and read; a change is checked with `refusal` against the Board it read, then left in `board-changes/` through `extensions/inbox/client.ts`, which the module's `JsonInboxDir` drains while its server owns the lock, passing each file's name as the change's `request`, and the tool waits up to six seconds to see it land.
A post's `workspace` must be an absolute path; the tool resolves one against the session's directory.
A session acts as its top-level session: `topSessionId` walks a subagent's session file up to the session that started it.
A post goes to the Workspace of the session's directory, the main checkout of a linked worktree, unless it names another.

## The page

`BoardPage` in `web/components/board/page.tsx` draws the Workspaces from the core data with a count of ready Board tasks, `readyIn` in `web/components/board/work.ts`, and the sessions the Board names, the open Workspace's Board tasks with their status, and the open Board thread.
`workOf` in `web/components/board/work.ts` says what a Board task in work shows: a session starting, working, or waiting on the user, or the error of a start that failed. `BoardNoteLine` in `web/components/board/board-note.tsx` draws the notes a thread shows, the ones `isThreadNote` picks: merges, a failed start, and a close.
Its address is `#board?workspace=<dir>`, and `#board/<n>?workspace=<dir>` opens Board task `n`'s Board thread; `session=<id>` picks which session's tab the thread shows, which `threadSession` honors when the Board task names that session and else replaces with the one a reply wakes.
A session the page names, in the sidebar, as an author, or on a Board task in work, opens on the Board too: `hashForBoardSession` in `web/components/board/sidebar.tsx` picks the Board thread whose tabs show it, else the latest that names it, adds `session=<id>`, and `revealSessionTab` shows that session's tab.
A Workspace's **Routines** tab, `RoutinesTab` in `web/components/routines/routines-tab.tsx`, lists the routines whose `workspace` is that Workspace, and a run row links to the Board thread its run posted or replied on.
A Workspace's **Routines**, **Projects**, and **Pull requests** tabs hold the page they show in `BoardView`'s `page`, written as that page's own address after `#board/`, which `web/routing.ts` reads and writes for the module through `PageAddresses`, since a module definition imports no hub.
`WorkspaceTab` in `web/components/board/tabs.tsx` provides `boardPageHash(workspace)` through `PageHashContext` (`web/page-hash.ts`), and every routine, project, and pull request link builder in `web/routing.ts` takes it, so the page's links stay in the tab.
`q=<words>` shows the search results, with `in=thread` or `in=all` widening or narrowing them from the open Workspace, and `reply=<index>` highlights that reply of the open Board thread.
`searchBoard` in `web/components/board/search.ts` runs the search on the page's copy of the Board, so the server answers no search request.
The page sends `post`, `reply`, `edit`, and `close` as the user; the server parses them with `BOARD_MODULE.store.parse`, which accepts nothing else from the page.
The log keeps text only, so the composers' images go first to `PUT /api/board/images` in `src/server/board-images.ts`, which saves each under `board-images/` in the data directory by its hash and answers their paths; the text names each as `![image](<path>)`, which the page shows through `GET /api/media` and the session reads.
