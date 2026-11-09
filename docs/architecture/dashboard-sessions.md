# Dashboard sessions

Sessions started from the dashboard are omp processes in RPC mode with tool dialogs, driven through omp's own `RpcClient`.
Each runs under a session keeper, so it outlives the server that started it; see [Session keepers](#session-keepers).
They use the installed CLI with `--mode rpc-ui`.
The page starts one with a single `start` request whose `kind` is `new`, `fork`, or `resume`, and the server answers each with one `started` reply that carries the new session's instance id or the error.
The server picks the instance id before omp spawns, so a question that omp raises while the session opens already belongs to it.
A new session's first message rides on the `start` request: the server spawns omp, sends the message as its first prompt, and answers the page as soon as omp reports ready, with no terminal, registry, or relay involved.
**Resume** starts the same process in the directory that the session file's header records and opens the file with omp's `switch_session` command.
When omp could not keep writing a session file, such as when another omp process held it, it went on in a sibling file with a new session id whose header names the old one (`continuationOf`).
`switch_session` opens the exact file it is given, so the server first asks omp's `findSessionContinuation` for the copy `omp --resume` would open, the newest one that holds the old file's last turn, and resumes that copy: its file and its recorded directory.
A fork reads the exact file the pane shows, since it starts from an entry picked there; see [the decision](../decisions/2026-11-02-resume-follows-continued-sessions.md).
Prompts, Stop, live events, subagent progress, and questions stay on omp's stdio, which the keeper lends the server.
A prompt carries omp's `streamingBehavior`, `steer` or `followUp`, so omp queues it during a turn the way its terminal does.
A prompt omp refuses shows as a note in the session, and `LiveSession.prompt` rejects with `PromptRefused`, so a caller that has no one else to tell, such as the socket handler or a session's first message, skips it.
The composer's queue is omp's `queue_update` event.
A `dequeue` message takes one message back with `remove_queued_message`, and the server answers with `withdrawn`, carrying its text and images so the composer can restore both.
A `promote` message, a queued row's **Send now**, is `promote_queued_message`, which moves a follow-up into the steering queue.
An `interrupt` message, Stop, is `abort_and_restore_queue`, which aborts the turn and hands back both queues, steers first, in one `withdrawn` answer; omp's terminal Esc does the same.
omp's restore leaves out a prompt it admitted but never ran, so when the session's starting prompt got no live user message before the abort answered, the session puts that prompt first in the `withdrawn` answer ([Dashboard sessions](dashboard-sessions.md)).
A session runs its prompts, interrupts, promotes, and `flush` requests one at a time, in the order the page sent them (a `SerialLane` from `src/serial-lane.ts`), because the socket handlers do not wait for each other.
When an abort follows, omp drops a prompt it has read but not yet run, so an abort that got ahead of a steer would lose it.
Enter on the empty composer sends `flush`, and the session aborts only if omp's queue, read with `get_state` at that moment, still holds a steer; omp then runs that steer as its next turn.
A steer that has left the queue is already in the turn, recorded or streamed into the response, and an abort then would cut off the reply to it, so neither the page's lagging copy of the queue nor omp's terminal rule, which also counts such a steer, decides.
A guest keeps the same order for its `prompt`, `abort`, and `flush` frames, because it expands a prompt before it sends it.
Collab has no queue frames, so a guest answers `promote` by sending the follow-up it holds as a steer, and `interrupt` by taking back the follow-ups it holds before it sends `abort`.
It flushes while the host's `state` frame counts a queued message (`queuedMessageCount`), or while this guest sent a steer that no `state` frame has counted yet.
Plain `--mode rpc` gives the session no `ask` tool.
`rpc-ui` gives it one, and omp sends extension dialogs as `extension_ui_request` frames.
An `input` frame carries `secret: true` when the extension asks for a secret, such as an API key, and the server keeps it as a text request whose `field` is `secret` rather than `line`, which the page draws as a password field.
The server sends `set_ask_dialog` when it opens a session, so omp sends each `ask` call whole as one `ask` frame and takes all its answers in one `extension_ui_response` (`requestRpcAskDialog` in `rpc-mode.ts`) instead of a chain of selects, whose frames do not report a multi-select's checked rows.
omp's `RpcClient` reads those frames but only hands them to its own login flow, so the server reads a copy of the child's stdout through omp's JSONL reader and chunk decoder.
It writes the `extension_ui_response` to the child's stdin as one line, the way `RpcClient` writes its own commands.
omp sends a `cancel` frame when a question ends without an answer, for example after Stop.
A question with a timeout ends with no frame, so the server drops it at its deadline.
omp's RPC mode does not title a session from its first prompt, as its terminal does.
While a session has no title, each user message's `message_end` event makes the server send a bare `/rename` prompt, which omp runs as its own command: it titles the session from the conversation in the background and announces the title with a `session_info_update` frame.
`RpcClient` drops that frame too, so the same stdout copy reads it, and the server then reads omp's state again for the new `sessionName`.
A `rename-session` message gives a session the user's own title; its parser trims the title and refuses one of only whitespace.
For a session this dashboard runs, the server writes omp's `set_session_name` inside the session's `SerialLane`, so a titling `/rename` already queued lands first and none starts after, then reads omp's state for the new `sessionName`, as omp sends no frame for it.
A terminal session refuses it, since only its own omp can retitle it.
A session no omp runs is retitled in its file through omp's `SessionManager.renameSessionTitle` (`renameSessionFile` in `src/omp/sessions.ts`), which takes omp's lease on the session first, and the server reads that file again and sends the past list; a Claude Code or Codex session refuses it.
While another omp process holds the session, which omp's lease marks from that process's first write to the file, omp writes nothing and the rename fails with `This session is open in another omp window. Rename it there with /rename.`
A title that is blank once control characters read as spaces is refused before omp is asked, since omp answers it the same way.
An `agent_end` that ends the run, not one that hands over to more of it, such as a queued follow-up (`isTerminal: false`), makes the session report `turn-ended` with its last reply: the text of the last assistant message that has any, without the suggested prompts `splitSuggestions` takes off, or `null` when none has text.
An `agent_end` that only waits on a background job (`isTerminal: false` with `awaitingAsyncWork: true`) ends the turn too, so the session reads idle and reports its reply; the job's result starts the next turn with its own `agent_start`.
The same update carries `failure`, how a provider's error ended the run, or `null`: `turnUpdate` in `src/live-session.ts` reads it with `turnFailureOf` in `src/omp/turn-failure.ts`, which reads the run's last assistant message when its `stopReason` is `error` and asks omp's `classifyMessage`, the same test omp's retry and credential rotation apply.
A message flagged `UsageLimit` is a `usage-limit`, which keeps the wait the error names, such as `retry-after-ms=…`, through omp's `extractRetryHint`, and wins over `Transient`, which omp also sets on a `429`.
A message flagged only `Transient`, such as a failed DNS lookup, a stalled stream, or a dropped connection that omp's own retries gave up on, is a `transient`; an abort, or an error with neither flag, such as `Usage preflight blocked`, is `null`.
See [Scheduled sends](scheduled-sends.md) for the continue the server schedules for a session it started, including one it attached to after a restart.
A dashboard session reports `turn-ended` before the roster update that shows it idle, so the server holds a session the failure stopped before the cleanup after a merge sees it idle.
Each main-agent `agent_start` makes the session report `turn-started` once its status reads working, whoever prompted it, which cancels a continue the session waits on.
A session keeps running when the server stops, restarts, or crashes; only **End session**, or omp exiting on its own, ends it.
The transcripts stay on disk, and **Resume**, or `omp --resume <session id>` in a terminal, continues one that ended.

omp acks a `prompt` once it admitted it, but on every turn its auto-thinking classifier (`applyAutoThinkingLevel` in `pi-coding-agent/src/session/model-controls.ts`) holds `agent_start` back by about a second, and a new session's first turn can also wait on MCP discovery (`MCP_DISCOVERY_TURN_WAIT_MS` in `pi-coding-agent/src/session/agent-session.ts`).
So a prompt the main agent takes while idle becomes the session's starting prompt at its ack: the session reports `working` and tells its view, which shows the prompt as pending ([Transcripts](transcripts.md)).
`DashboardSession` keeps whether a turn runs, from `agent_start` to the terminal `agent_end`, apart from the starting prompt, and reports `working` while either holds.
Both live in its `PromptTurn` (`src/prompt-turn.ts`), which moves them on each event, and the session tells the page when a move changed the starting prompt or the status.
The starting prompt ends at the live user message of its turn (`message_start` or `message_end`, or the user's `skill-prompt` custom message), at its `prompt_result`, at Stop or an edit's abort, when the session switches files, or when the process exits.
omp sends one `prompt_result` per admitted prompt once its work settled, at once for a prompt that failed or that a usage preflight or an extension stopped before a turn (`pi-coding-agent/src/modes/rpc/rpc-prompt-results.ts`), and `RpcClient.onPromptResult` hands it over by request id.
Its `prompt_result` can reach the session before the ack's await resumes, so results that come while a prompt waits for its ack count against it.
A prompt sent while a turn runs is queued as a steer or follow-up, and so is one sent while a prompt is starting, since omp counts a prompt in flight as streaming, so the session holds at most one starting prompt.
A prompt whose `agent_start` came before its ack is not held, and neither is a `/` prompt other than `/skill:`, since omp completes a builtin slash command itself, with no turn and no `prompt_result`.
A session's first message, a suggestion, and an edited prompt all take this path.

`src/server/interrupted.ts` keeps which of those sessions were interrupted, in `interrupted.json` beside the access token, and which of them were mid-turn (working or waiting on a question).
Each time a dashboard session starts, exits, or starts or ends a turn, the server writes the session ids of the ones that run and of those whose turn runs.
A session that exits without the page's `end` request joins the interrupted list, mid-turn if its turn ran.
At its next start, the server first attaches to the sessions whose keeper still runs, then reads the others that ran when the last server stopped as interrupted, with the turn state they last had (`InterruptedSessions.recover`): their omp exited while no server watched, as when the computer restarted.
The server listens before then, so a taken port fails before any keeper is joined, but refuses the dashboard socket with a 503 until `recover` has run (`refuseUntil` in `src/server/http.ts`), so no page starts or resumes a session meanwhile; the page retries as after any failed connect, then sends `watch` and its waiting requests.
A session that runs again leaves the list, and `dismiss-interrupted` takes one out.
Each past row carries `interrupted`.
`resume-all` resumes several past sessions at once, each the way a `start` with `resume` does, then sends `continue` as a prompt to each one that stopped mid-turn.
The server answers with one `resumed-all` that names the instance id of each session that started and the errors of those that did not.
`InterruptedSessions` calls back each time a write changes `midTurn`, the interrupted sessions that stopped mid-turn, and `Dashboard` then runs the bell's stopped check; `recover` reports nothing, since the server checks once it listed the session files, which give the notice each session's title and folder ([Notifications](notifications.md)).
A terminal session keeps running when the dashboard stops, so the server tracks none of them.

A subagent of a dashboard session takes a message through omp's `steer_subagent` command and stops with `cancel_subagent`; both reach only a subagent that runs, so the server offers them only for rows whose status is `running`.
A prompt that starts with `!` goes to omp's `bash` command, which runs it in the session's directory and records a `bashExecution` message in the session file; the transcript shows that message as the user's command and output.
omp appends that record without the lock churn that the watcher reports on macOS, so the server re-reads the file itself once `bash` answers.
A built-in slash command runs from a plain `prompt`, and omp sends what it prints as `command_output` frames and a model switch as `config_update`.
`RpcClient` drops both, so the same stdout copy reads them: the server shows the output as a notice when the user's last prompt was a `/` command, which leaves out what the titling `/rename` prints, and reads omp's state again after a model switch.
An `edit-prompt` message rewinds a dashboard session in place: inside the same `SerialLane`, the server aborts a running turn, sends omp's `branch` command with the last prompt's entry id, and reads omp's state for the new session id and file.
omp writes the history before that prompt to a new file and keeps the old one, which then lists as a past session; a branch from the first prompt has no history, so omp writes its file only with the edited prompt's reply.
The session follows the new file the same way it follows a `/move` below, in its current directory and without waiting for that file to exist, then reports `switched`, so the server points its views at the new file before it sends the edited text as a plain `prompt`, whose events then land in the new transcript.
A Collab terminal session has no `branch` frame, so only a dashboard session offers the edit.
omp's `/move` sends `config_update` too, and the state read after it finds a new session file: the session takes its working directory from that file's header, clears its subagents when the session id changed, and reports `switched`, so the roster and the views follow the moved file.
omp writes a moved session that has no reply yet only with its first reply, so until that file exists the session keeps its old file and directory, and a later state read follows it.
The composer's directory picker sends `/move <path>` as a plain `prompt`, only to an idle dashboard session, since omp refuses to move while a turn runs.
`SessionMoves` in `src/server/session-moves.ts` lets the agent ask for the same move: `join` gives every dashboard-started main session but a Bot's conversation the strict host tool `move_session`, which takes an absolute or `~` path, since the tool cannot know the session's own directory, checks it is a directory, and answers that the move waits for the turn's end.
`launch` and `reattachAll` in `src/server/start.ts` build each session's join from its instance id, so the tool knows its caller and records each call it took by its id.
The call's `tool_execution_end` without error hands the directory to that caller through `DashboardSession.moveAfterTurn`, the last call of a turn winning, since a reattached session gets its tools before it is listed and its held events reach it after; a call cut off before the move was taken moves nothing, and the caller's exit forgets its calls.
The session itself sends `/move <path>` as the composer does once a turn ends and it shows idle, and otherwise keeps the move for the next turn end; the move goes with the session when it exits.
`SessionWaits` in `src/server/session-waits.ts` lets one session wait on another: `join` gives every dashboard-started main session but a Bot's conversation the strict host tool `wait_for_session`, which takes the other live session's id, as an `@session` mention writes it, or its exact title, and a time limit of at most 240 minutes, 60 when null.
The call stays open until that session stops for the user, read from the roster rows the sidebar shows by `stopOf` in `src/shared/sessions.ts`: it asks a question, it waits for input, or it shows idle with no running subagent it waits on, so a turn that ended while such a subagent still runs keeps the call waiting.
It also answers once that session no longer runs or the time limit passes, and the answer carries the last reply in that session's file, cut at 4,000 characters, read by `LiveSessions.lastReply` with `endedTurn`.
`Broadcasts` calls `onRosterChange` on every roster push, debounced or not and whether or not a page listens, and the dashboard checks the waits there, and `exited` once it removed an exited session ends the waits that session made.
The tool closes over its caller from the join as the move tool does, so it refuses a wait on the caller's own session; the call's abort, when the user stops the turn, and the caller's exit end the wait.
The dashboard serializes model, effort, and fast-mode setters with state reads in a separate `SerialLane` from turn commands.
Event-driven refreshes coalesce while queued, so a read cannot overwrite a later switch, and switching stays visible until every queued model change has finished.

The same lane runs the short auto-compaction and goal RPC setters; context and advisor slash commands use the prompt path and its turn lane instead, without holding the model lane.
The roster carries `compaction` (enabled, running kind, and effective model threshold), nullable `advisor` (configured model selectors and tracked enabled state), and `goal` (off with a reason, none, or a set goal with status and accounting).
`get_state` is authoritative for auto-compaction and goals, and manual/auto compaction completion and `goal_updated` trigger a refresh.
A completed goal event is retained for the current dashboard lifetime because omp clears its goal mode on completion; Clear, a new live goal, and a session change discard it.
Advisor state is seeded from configuration and updated after dashboard `/advisor` prompts because RPC has no advisor enabled field; a server reattachment cannot recover a runtime-only toggle.
`loadSessionControlsConfig` reads session-only settings and discovers advisors in parallel, leaving generic routing reads free of advisor-file discovery.
Its threshold resolver stays lazy so a model switch uses omp's current per-model override and context window.
The dashboard does not enable `goal.continuationModes` on the user's behalf: it labels goals as prompt-driven unless the loaded configuration includes `"rpc"`.

A `prompt` message, and a `start` of kind `new`, carry `images`, each `{ data, mimeType }` with the file's bytes in base64, as omp's `ImageContent` takes them.
`parseImages` in `src/shared/sessions.ts`, which `src/server/wire.ts` uses, accepts PNG, JPEG, GIF, and WebP, up to `MAX_PROMPT_IMAGE_BYTES` (32 MB) per prompt, and a prompt of images with no text.
The socket's `maxPayloadLength` is 64 MB so such a message fits.
A dashboard session passes the images to omp's RPC `prompt`; a terminal session's guest puts them on its Collab `prompt` frame, a held follow-up included.
omp's `steer_subagent` and Collab's `agent-cmd` `chat` take text only, so a subagent's prompt with images is refused.
omp writes a prompt's images inline into the session file and then moves each to its blob store, `~/.omp/agent/blobs/<sha256>`, leaving `blob:sha256:<hash>` in the file.
A user item's `images` holds a `data:` URL for an inline image and `/api/image?hash=<sha256>&type=<image type>` for a moved one; that route serves the blob file as `type`, which must be one of the four prompt image types, since the store keeps none.

A prompt's other files travel as text, so they reach a subagent and a terminal session's Collab frame too, neither of which takes images.
`web/components/prompt-attachments.tsx` reads each file as it attaches: a file that is UTF-8 without a NUL byte, and not a PDF, is its own text, and any other goes to `PUT /api/attachment/document`, whose body is `{ name, data }` with the bytes in base64, up to `MAX_PROMPT_DOCUMENT_BYTES` (32 MB).
The route hands the bytes and the name's extension to omp's `convertBufferWithMarkit` and answers `{ text }`, the Markdown omp reads; a format omp cannot convert, or a file it fails to read, answers 422 with omp's reason, which the composer shows in its note.
`withFiles` in `src/shared/prompt-files.ts` puts each file after the typed text in the block omp's `@file` arguments write, `<file name="…">`, its text, and `</file>`, so a leading `/skill:` or file command still expands with the files as its arguments.
`preparePrompt` in `web/prompt-attachments-model.ts` keeps the files' text under `MAX_PROMPT_FILE_CHARS`, a million characters, in attach order, both as files attach and on the files a prompt sends, after awaiting each file's read.
omp saves the prompt as that text, so `userPrompt` in `src/transcript.ts` splits the trailing blocks off again with `splitFiles`, and a user item's `files` holds their names, which the transcript shows as chips.

## Private sessions

A `start` with `new` and `private: true` starts a private session, one that lives exactly as long as its omp process and is deleted with everything it wrote when that process exits ([decision](../decisions/2026-11-03-a-private-session-lives-in-its-own-directory-until-its-omp-stops.md)).
`parseNewSessionRequest` refuses a private start that names a todo, a task, or a review draft, since nothing may link to a session that leaves nothing behind.
`PrivateSessions` in `src/server/private-sessions.ts` makes `private-sessions/<port>/<instance id>` before omp starts, and its existence is what marks the session private, so a restart loses nothing.
omp runs with `--session-dir` set to omp's own name for the cwd inside that directory (`sessionDirForCwd`), so its transcript, subagents, `/move`, and `/wt` all stay inside, and with `--config private.yml` from the same directory, which turns omp's memory and autolearn off and outranks the user's and the project's settings.
A private session's file sits one directory deeper than past sessions' files are read, so the private root's watch only pokes live views, and no past list, search, or index lists it.
The session holds whether it is private, set at its start and, at a reattach, from its directory's existence; the roster marks the row `private` from it, and `saveRunning` leaves the session out of `interrupted.json`.
When the `exited` update comes, the server purges the session instead of counting it interrupted.
`purge` reads the session id of every `*.jsonl` under the directory through `readSessionHeader`, unpins those ids, deletes their `history`, `session_titles`, and `session_recaps` rows from omp's `history.db` and rebuilds its full-text index, removes omp's custom-session-file markers that name those files, and only then removes the directory (`forgetSessions` in `src/omp/forget-sessions.ts`, which mirrors `deleteHistoryRowsForSessions` in omp's `gc-cli.ts`).
Each step changes nothing when repeated, and the directory goes last, so a purge cut short anywhere is finished by the next one.
A purge asked while one of the same session runs joins it, so a failed start and its omp's exit purge once.
After `reattachAll`, before the page's socket is let in, the server sweeps the private root and purges every directory whose session neither the registry nor a keeper holds, as one whose omp exited while no server ran.
A private start that fails purges its directory through `launch`, before omp runs, or through the `discard` that `launch` returns, after.
`createStarter` refuses to fork a private session, since omp writes a fork beside its source, and the page hides **Fork from here** for it.
What stays: pasted images in omp's blob store until `omp gc --blobs`, omp-stats' token counts and file path with no text, and any terminal breadcrumb of omp's, which holds only a path.

## Session keepers

A keeper (`src/keeper.ts`) holds one session's omp: it runs omp with piped stdio, and lends that stdio to one server at a time through a Unix socket, `sessions/<port>/<instance id>.sock` beside the access token, with omp's stderr in the `.log` beside it and its own pid in the `.pid`, written before it listens.
The directory is per port, so a server on another port, such as a smoke run, never takes over this one's sessions.
`startKeeper` in `src/keeper-link.ts` starts it through `/bin/sh`, which backgrounds it and exits, and Bun's `detached` makes it a session leader: no signal to the server's process group, and no kill of the server's process tree, reaches it.
It retries while nobody listens on the socket yet; any other end of the connection before the greeting, a close or the reset Linux sends to a connection still waiting in the backlog of a keeper that exited, means the keeper hung up, and the start fails with the tail of omp's stderr from the log.
Of omp's modules the keeper loads only `rpc-frame.ts`, whose path the server passes it (`rpcFrameFile` in `src/omp/modules.ts`); the packaged app ships the keeper as `keeper.js` beside `server.js` (`keeperScript` in `src/server/resources.ts`).

Each connection starts with the keeper's greeting, `omp_agents_keeper` with omp's pid and the `meta` the server passed at the start (`startedAt` and the directory omp started in), then omp's own `ready` line again.
So `startRpc` and `attachRpc` in `src/omp/rpc.ts` both hand omp's `RpcClient` the connection as the process its `spawn` option returns, and the client starts on it as on a fresh omp.
A connection's `negotiate_protocol` makes it the one omp talks to, and the keeper passes the line on to omp, which answers it again; a second negotiation changes nothing in omp, and its `RpcClient` reads chunked frames from the moment it sends one.
When omp's `ready` offers no protocol 2, the client sends none, so a connection joins on the greeting instead; a connection that has not joined can neither write to omp nor stop it.
The joining connection first hears the questions omp still waits on (`extension_ui_request` dialogs not yet answered or cancelled, with what remains of a timeout).
The keeper reads omp's output one logical frame at a time through omp's `RpcFrameDecoder`, so an `rpc_chunk` sequence counts as the frame it carries, and forwards each whole frame, with all its lines, to the connection that joined.
omp's output while no server listens is dropped; the attaching server reads omp's state instead: `DashboardSession.reattach` counts a turn as running when `get_state` reports `isStreaming` or `isCompacting`, lists the subagents `get_subagents` reports, and serves the session's host tools again with `set_host_tools`.
It does not count `hasPendingAsyncWork` as a running turn, since a session that only waits on a background job gave its turn back.
A host tool call that no server hears, because none has joined, fails at once with a note that the dashboard restarted, so omp's turn goes on; so do the calls a server heard and did not answer before it hung up or another joined.

The server's shutdown calls `DashboardSession.dispose`, which hangs up without stopping omp; the link's `ended` then settles with `detach` rather than `exit`, so the session reports no exit and does not count as finished.
At startup `reattachAll` in `src/server/start.ts` connects to every socket in the directory under the instance id it had, holding back what each session reports; a socket nobody listens on loses its files.
A keeper that takes the connection and does not greet within 3 seconds is stuck: the server hangs up, logs its instance id, and stops it by the pid in its `.pid` file with `stopTree` in `src/process-census.ts`, which lists the keeper and every process under it with one `ps`, each with its start time, sends them SIGTERM, and after 3 seconds SIGKILL only to those still running under the same start time, so a pid another process reused is never hit.
Each of its `ps` reads runs as `readProcessTable`, without blocking the server, so the rest of the dashboard keeps answering while it waits out those 3 seconds.
Startup and the socket gate then wait at most about 6 seconds, no Resume starts a second omp on its file, and `recover` counts its session as interrupted.
Once all attached, `InterruptedSessions.recover` learns which sessions survived and answers those whose turn ran when the last server stopped, and only then is each listed again, and what it reported passed on, before the runners recover.
Each comes back with the turn it left unread, and one whose turn ended while no server listened comes back with that turn unread, as [Session notifications](notifications.md#session-notifications) says; terminal sessions get theirs back at the first registry listing.
Attaching to a keeper that greeted never stops omp: a session file without a readable header leaves the session in the directory omp started in, and a session that fails to attach is left running, unlisted, for the next server.
**End session** sends the keeper `omp_agents_keeper_stop`: the keeper notes the processes under omp while omp is still their parent, sends SIGTERM to omp and to them, SIGKILL to those left after 3 seconds, removes its socket and log, and exits.
omp exiting on its own ends the same way, except that its processes are no longer under it, so the keeper stops the ones it noted before.
omp's background jobs, kernels and subagents lead process groups or sessions of their own and are reparented once omp exits, so the keeper's `ProcessCensus` (`src/process-census.ts`) notes the processes under omp with `ps` a second after a tool call ends, since an async call starts its job just after it returns, and every 10 seconds, each with its start time so that a reused pid is never signalled.
A process omp started since the last note escapes an omp that exits on its own.
The census leaves alone every process whose command holds omp's `__omp_worker_` prefix, and everything under it, as `stopTree` does: omp starts its shared workers, such as a project's daemon broker or the LSP multiplexer, as children of whichever omp first needs them, and they serve every omp of the project or the machine, so stopping them with the session whose omp happened to start them would end every other session's services and shared browser.
The services a session's broker runs for it are stopped by the server instead, once the session leaves the roster; see [Session processes](session-processes.md).
A `ps` that fails is logged with the pids that may still run, rather than read as nothing left.
A keeper exits whenever omp does, and omp exits when its keeper dies, since its stdin closes, and stops its own background jobs as it exits.
