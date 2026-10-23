# Projects

A project is a coordinator session that plans the work and starts worker sessions, which all share one notes directory, and the user's notes, which every project shares; see [Projects](../usage/projects.md) for what the user sees.
`src/shared/projects.ts` holds what the page reads and sends: `Project`, `Worker`, `ProjectUpdate`, `ProjectEdit`, `DEFAULT_PROJECT_NAME`, and `workerPhase`, which turns a worker's live status, or its absence and whether it was interrupted, into `working`, `asking`, `idle`, `interrupted`, or `ended`.
The rules only the server applies live in `src/server/projects-file.ts`: `ProjectChange`, the page's `ProjectEdit` plus the runner's changes, `applyProject`, which returns the same array for a change that changes nothing, `ProjectRole`, and `ProjectsFile.roleOf`, which finds a session's project and role by its session id.

`ProjectsFile` keeps the projects in `projects.json` beside the access token, as `{ projects }`, and moves a file that holds anything else to `projects.json.invalid`.
A project holds its `id`, `name`, workspace `cwd`, `createdAt`, `archived`, `coordinator.sessionId`, `workers`, in id order, `updates`, the ones not yet delivered, oldest first, and `nextWorker`, the number the next worker's id takes.
A worker holds its id (`w1`, `w2`, …), `title`, `sessionId`, `cwd`, `startedAt`, and `lastReply`, `{ at, text }`, with empty text for a turn that ended on none, or `null` before its first turn ends.
An update holds its id, worker id, time, and one `kind`: `finished`, whose reply is the worker's `lastReply`, `asked` with the request id and the question, or `stopped`.
The `update` change keeps one `finished` per worker: a later one replaces the earlier, since both would quote the same last reply.
The servers are the file's only writers.
The page sends `rename`, `archive`, `unarchive`, `max-workers`, `watch`, and `review-cadence` in a `project` socket message (`ProjectEdit`), and creates a project with `project-create`, `{ reqId, name, cwd, prompt, model, thinking }`, which the server answers with the same `started` reply a `start` gets; `ProjectRunner` in `src/server/project-runner.ts` makes every other change.
Every socket hears the projects after each change as a `projects` message on the roster topic, also sent when a socket opens; an edit that changes nothing sends them back to its own socket alone.
An older version kept the workspace list under the same name, so the `Dashboard` constructor first calls `adoptOldWorkspaces` from `src/server/workspaces-file.ts`, which moves a `projects.json` in that shape to `workspaces.json`, and only then builds `ProjectsFile`.
omp's `projects` extension reads the file too, and cannot import `src/`, so it declares the fields it reads by hand.

A session belongs to a project by its session id, which the file keeps, so a resume finds its role again.
The runner tracks each live project session by instance id, with its role and its current session id.
When a dashboard session reports `switched`, after a `/move` or an edited prompt, the runner applies `relink`, which points every reference to the old session id at the new one.

The starter from `src/server/start.ts` takes a `StartRequest`, which is what the page sends, and a server-only `ProjectLaunch`, which only the runner passes: `create` for a new project's coordinator, `new-worker` for a worker with its title, or `rejoin` with a role; a page's start passes `null`.
It asks the runner's `launchFor(request, launch)` how to start, which for `null` finds a `resume`'s role by its session id (`rejoin`), and none for a `new` or a `fork`.
`launchFor` answers a `ProjectJoin`: the `RpcLaunch` to spawn omp with, `PLAIN_LAUNCH` for no project, and `attach`, which the starter calls once the session is in the registry and before its first prompt.
A project session's `RpcLaunch` holds `projectsExtensionArgs()` and, for a coordinator, the four host tools of `src/server/project-tools.ts`, bound to its project.
`projectsExtensionArgs()`, in `project-runner.ts`, is `-e` with this repository's `templates/omp/agent/extensions/projects.ts` while `~/.omp/agent/extensions/projects.ts` does not exist, and nothing once it does, since omp would load the same extension at two paths twice.
Every spawn of a coordinator gets its tools, a resume included, since the process that serves host tools hands them to omp as it starts; a coordinator resumed in a terminal has none.
`attach` saves what the launch makes: `create` saves the project, its workspace the session's directory, and seeds its notes, and `new-worker` applies `add-worker`, which takes the worker out of the queue, gives it the project's next id, and bumps `nextWorker`, in one change.
It then flushes the file, because `JsonFile.save` writes at the end of the event-loop turn and the extension reads the file at the first prompt, and tracks the session by the role the file now gives it.
So a coordinator that fails to start saves no project, a worker that fails to start takes no id, and workers take their ids in the order their sessions start; `startWorker` reads the id back from the tracked session.
A worker starts in the directory `start_worker` names, read through `expandHome` in `src/paths.ts` and resolved against the project's workspace, else in the workspace.
Its model (`modelOfSelector` in `src/shared/models.ts`), effort, and skill are the tool's; its branch is the one named, none for `none`, else, in a git checkout, `<project slug>/<title slug>-<6-character id>` from the checked-out branch.
Every worker joins the project's `queue` with `enqueue` first, so a crash before its session attaches leaves it queued for the next start.
The runner's `#drain` starts queued workers in order while fewer than `maxWorkers` are busy, working, asking, or still starting; `startWorker` awaits its own worker's start when `#drain` began it, and reports its queue position otherwise.
A queued worker that fails to start leaves the queue with `dequeue`; its error goes to the coordinator as the tool's error when `startWorker` began it, else as an `event` update.
`settle` delivers the waiting updates and drains the queue; the runner calls it on each turn end, exit, roster change, outside event, and boot, and the server calls it after every project edit from the page that changed something.

The coordinator's tools are strict host tools, every property required, loaded as `essential`: `start_worker` (`title`, `prompt`, `cwd`, `branch`, `model`, `thinking`, `skill`, nullable), `list_workers`, `read_worker` (`worker`), `message_worker` (`worker`, `text`), `answer_worker` (`worker`, `requestId`, `answer`), which maps the answer to the request's kind, and `end_worker` (`worker`).
An error a tool throws reaches the coordinator as the tool's error, and every tool throws once the project is archived.
`message_worker` prompts the worker as a follow-up, reaching it through the same `reach` as a scheduled message, so a worker that does not run resumes first.

A worker's session reports three kinds of news, which the runner saves as updates:

1. Its `turn-ended` update saves the reply as the worker's `lastReply`, empty when it had none, and becomes `finished`.
2. Each roster change, which the server passes to `observe`, reports every question the worker waits on whose request id the runner has not reported for that live session, as `asked`, so a question is reported once.
3. Its process's exit becomes `stopped`, unless the dashboard is stopping: `Dashboard.stop` calls the runner's `stop` before it ends the sessions, since they exit with the dashboard, which is no news.
   Nor is the exit of a worker that `end_worker` or `endFinished` ended, which the runner keeps by instance id until the exit; it still settles the project, so a queued worker takes the freed slot.

Two kinds come from elsewhere: `restarted`, which `recover` saves at boot when the owner lock is held, naming the workers `interrupted.json` says stopped with the server, after it resumes a coordinator that did, and `event`, which `notify` saves for the routine runner's `project` task and for `ProjectWatch`.
`notify` also writes the event into the project's `inbox/` through the runner's `writeInbox`, which `Dashboard` wires to `writeInboxEvent` in `src/server/project-notes.ts`, and logs a write that fails rather than losing the update.
`ProjectWatch` in `src/server/project-watch.ts` hears the minute tick and looks every `PROJECT_WATCH_MINUTES` (2): for each project not archived, it loads the pull request of each worker's branch and the viewer's Linear issues that match the project's `watch.linear`, keeps a snapshot of each in memory, and reports what changed since; the first look only records.
The cleanup after a merge, not the watch, ends the workers a merge leaves with nothing to do (see [Merges, and the cleanup after one](merges-and-the-cleanup-after-one.md)), while their project watches its pull requests.
It ends each through the runner's `endFinished`, which refuses a worker gone, ends it as `end_worker` does, waits until the session and its worktree are gone, then saves an `event` that names the worker it ended.

The runner saves each update in `projects.json` at once and then delivers; an archived project's updates wait until `unarchive`, whose apply calls the runner's `settle`.
When the coordinator's session runs and its status is `idle`, the runner sends every waiting update, in order, as one prompt that `updateText` builds, starting `[omp-agents] Project update.`, quoting at most `REPLY_QUOTE_CHARS` (2,000) of each finished worker's `lastReply`, and naming each `asked` question's request id for `answer_worker`.
Its `[omp-agents]` prefix keeps it out of what the page shows as the user's own ([Transcripts](transcripts.md)).
It sends it through `LiveSession.prompt` as a `followUp`, which rejects with `PromptRefused` when the session does not take the message, after showing the refusal in the session.
Once omp takes it, `delivered` removes those updates, and delivery runs again for the ones that came meanwhile; one delivery per project is in flight at a time.
When omp refuses it, the updates stay and nothing retries at once: delivery runs again when the coordinator's row changes, when its turn ends, and when it attaches, which is also how what waited while it worked, or while it was stopped, reaches it once it is idle.
Only sessions that attached through the starter are tracked, so a project's session resumed in a terminal reports nothing.

`src/server/project-notes.ts` seeds a new project's notes in `projectNotesDir(id)` from `src/paths.ts`, `$XDG_DATA_HOME/omp-agents/projects/<id>/`, else `~/.local/share/omp-agents/projects/<id>/`, laid out as Cursor's Project folder: `notes.md` with the project's name, its goal (the coordinator's first message), a `## Decisions` section, the index of the others, and `## Promoted`, then `testing.md` and `research.md` under `docs/`, `internal/checklist.md`, and `archived.md`.
It writes each file with the `wx` flag, so it never overwrites a file already there, even one another server wrote meanwhile.
`writeInboxEvent` writes one outside event into `inbox/`, named `<time>-<slug of source and title>.md` with the time's colons as dashes, so the names sort oldest first, and holding the title, the source, the time, the link when there is one, and the text; a second event of the same name takes `-2`, `-3`, and so on.
`moveOldNotes` moves the files an older version kept, `README.md` to `notes.md`, `testing.md`, `research.md`, and `preferences.md` to `docs/`, and `checklist.md` to `internal/`, each by linking the new name and then unlinking the old one, so a file already in the new place stays and the old one beside it too; any other file stays where it is.
`seedNotes` calls it before it seeds, and `Dashboard.start` calls it for every project in `projects.json`.
`Dashboard.start` also seeds the user's notes, `userNotesDir` from `src/paths.ts`, `$XDG_DATA_HOME/omp-agents/user/`, else `~/.local/share/omp-agents/user/`, as Cursor's User folder: `preferences.md` and `workflows/README.md`, through `seedUserNotes`, which never overwrites a file either.
`listNotes` lists a notes directory's Markdown files at any depth, by name, each named by its path from the directory with `/`, skipping hidden entries and not following a linked directory.
The notes live outside every repository, so every worktree shares them, and outside the access token's directory, which the file dialog refuses.

`templates/omp/agent/extensions/projects.ts` reads `projects.json` at each prompt and each `edit` or `write` call.
Both of its handlers find the role by the session id, and for a `task` subagent, whose transcript is `<parent>/<agent>.jsonl` beside its parent's, by its ancestors' session ids (`ancestorSessionIds`), so it acts in its parent's role.
Its `before_agent_start` handler adds the session's role and the places of the project's notes and the user's to the system prompt of every prompt, so they survive compaction.
The coordinator's role text says its job is to plan, delegate, and report, reading only the notes, the workers' reports, and what a quick look answers, and starting a worker for anything more, with a prompt that says what to report back.
The extension keeps its own copy of `userNotesDir`, since it cannot import `src/`.
Its `tool_call` handler blocks a coordinator's `edit` and `write` calls whose `path`, or a hashline edit's `[path#TAG]` header, resolves outside both the project's notes and the user's, the roots `inNotes` takes, and fails closed: a call that names no file it can read is blocked too.
Only `local://` and `artifact://` paths, the session's scratch space, pass without a check.
Its shell guard, `shellWrite`, is a nudge rather than a boundary: after unquoting, it blocks a coordinator's `bash` call that redirects or `tee`s to a file outside the same roots, runs a git subcommand that writes (skipping `-C` and `-c` values), or runs `gt` other than its read subcommands.
Anything else runs, so a command or script that writes on its own is not caught.

The runner's `noticeFacts` feeds the `projects` notice source (`PROJECT_KINDS`) each project's coordinator status and its workers' phases and questions, and `projectNotices` in `src/server/notices.ts` turns them into notices, each id naming the state it reports: a worker's request once the coordinator is not working, a worker that stopped, and a settled project.

On a takeover, the server reads `projects.json` again, since the previous owner kept saving it; see [One server runs the unattended work](routines.md#one-server-runs-the-unattended-work).
Each server's runner follows only the sessions that server started.
