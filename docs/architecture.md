# How omp-agents works

The server's design, its protocols, and its HTTP API.
For installation, see the [README](../README.md); for the interface, see [Using omp-agents](usage.md); for where each file lives and what it does, see [Code layout](code-layout.md).

- [omp modules](#omp-modules)
- [Transcripts](#transcripts)
- [Terminal sessions](#terminal-sessions)
  - [Why the server joins every terminal session](#why-the-server-joins-every-terminal-session)
- [Dashboard sessions](#dashboard-sessions)
  - [Session keepers](#session-keepers)
- [Socket requests](#socket-requests)
- [Ask about this](#ask-about-this)
- [Desktop shell](#desktop-shell)
  - [Packaging and releases](#packaging-and-releases)
- [Terminal panel](#terminal-panel)
- [Plan quota](#plan-quota)
- [Analytics](#analytics)
  - [Context sources](#context-sources)
- [Routines](#routines)
  - [One server runs the unattended work](#one-server-runs-the-unattended-work)
  - [Isolation sandboxes](#isolation-sandboxes)
- [Scheduled sends](#scheduled-sends)
- [Projects](#projects)
- [Pins](#pins)
- [Notifications](#notifications)
  - [Session notifications](#session-notifications)
- [Merges, and the cleanup after one](#merges-and-the-cleanup-after-one)
- [Review drafts](#review-drafts)
- [Updating the dashboard](#updating-the-dashboard)
- [Settings sync](#settings-sync)
- [HTTP API](#http-api)
  - [Integrations](#integrations)
  - [MCP servers](#mcp-servers)
  - [Providers](#providers)
  - [Google Calendar](#google-calendar)
  - [New and local events](#new-and-local-events)
  - [Gmail](#gmail)
- [Front-end components](#front-end-components)

## omp modules

The server imports omp's own modules from the installed package, so it does not reimplement a protocol, the encryption, or the session-file format, and it always speaks the same version as the sessions it shows.
`src/omp/modules.ts` loads every module once and checks at startup that each export this app uses exists, naming the omp version and the missing export when one does not.
It finds the package through `omp` on `PATH`, or `OMP_PACKAGE_DIR` when set; with a Bun global install that is `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.
`bun run omp-release` checks a new omp release against these modules and the files listed below; the [omp release skill](../.agents/skills/omp-release/SKILL.md) says how to read its report.

Paid Cursor fallback is an external OMP runtime change, preserved in [`patches/omp-18.12.3-paid-cursor-fallback.patch`](../patches/omp-18.12.3-paid-cursor-fallback.patch) with its regression tests.
Its base is upstream tag `v18.12.3`, commit `53a0377db6845e0dae606146130766ec92d407fd`; do not apply it to another release without porting and verifying it.
From a clean checkout of that release, check and apply the patch:

```sh
git apply --check /absolute/path/to/omp-agents/patches/omp-18.12.3-paid-cursor-fallback.patch
git apply /absolute/path/to/omp-agents/patches/omp-18.12.3-paid-cursor-fallback.patch
```

Build and install both patched packages, `@oh-my-pi/pi-ai` and `@oh-my-pi/pi-coding-agent`, including the CLI bundle and SDK sources and declarations.
The dashboard does not apply this patch at startup, and installing or upgrading stock OMP removes the runtime changes.
The [routing policy](../templates/omp/agent/docs/model-routing.md) describes the opt-in `retry.paidFallback` setting and its billing limits.

Paths in this document that start with `pi-coding-agent/`, `pi-ai/`, `pi-catalog/`, `pi-tui/`, `pi-utils/`, or `omp-stats/` are inside that install, in `@oh-my-pi/`.
They are not in this repository.
The main ones:

- Collab: `pi-coding-agent/src/collab/registry.ts`, `protocol.ts`, `crypto.ts`, and `relay-client.ts`.
- Session files: `pi-coding-agent/src/session/session-listing.ts` and `session-loader.ts`.
  `appendCustomMessageEntry` in `pi-coding-agent/src/session/session-manager.ts` gives a `custom_message` entry the timestamp of the message it records, which `#persistMessageEnd` in `agent-session.ts` passes.
- Interrupted turns: `pi-coding-agent/src/session/exit-diagnostics.ts` (`createInterruptedTurnAbortMessage`), which `endsMidTurn` in `src/omp/sessions.ts` uses to refuse forking a session that ended mid-turn.
  It checks the branch from the leaf that `resolveSessionLeafId` in `pi-coding-agent/src/session/session-entries.ts` returns, as omp's load does, since a late `model_usage` entry is written last but points back at the leaf with `activeLeafId`.
- Images: `pi-coding-agent/src/session/blob-store.ts`, which moves a prompt's image out of the session file into `blob:sha256:<hash>`, and `getBlobsDir` in `pi-utils/src/dirs.ts`; `src/transcript.ts` and the `/api/image` route read them.
- Provider requests: `emitBeforeProviderRequest` in `pi-coding-agent/src/extensibility/extensions/runner.ts` hands each provider's request body to the extensions in load order, with the request's model as `ctx.model`, and `templates/omp/agent/extensions/request-log.ts` records it.
  The providers call it through `onPayload`; `pi-ai/src/providers/anthropic.ts` still edits the body after the hook to withhold kill-switched fields and to fit server-side compaction, Bedrock, and Vertex, and compaction, branch summaries, and titles never reach the hook.
  `pi-coding-agent/src/cli/gc-cli.ts` keeps a blob while any session file holds its `blob:sha256:` reference, and `putSync` in `blob-store.ts` refreshes a reused blob's time so a reference not yet written to disk survives `omp gc`.
- Documents: `convertBufferWithMarkit` in `pi-coding-agent/src/utils/markit.ts`, the converter behind omp's `read` of a PDF, Word, PowerPoint, Excel, or EPUB file, which `src/omp/documents.ts` calls for `PUT /api/attachment/document`.
- RPC: `pi-coding-agent/src/modes/rpc/rpc-client.ts`, `rpc-frame.ts`, and the frame types in `rpc-types.ts`.
  `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of omp's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](#dashboard-sessions).
  `RpcClient`'s `spawn` option may return any process with `pid`, `exited`, `stdin`, `stdout`, `peekStderr`, and `kill` (`RpcAgentProcess`); `start()` waits for omp's `ready` line, sends `negotiate_protocol` when it offers protocol 2, then `set_host_tools`, and a stdout that ends makes it call `kill`; see [Session keepers](#session-keepers).
  omp answers `negotiate_protocol` again whenever it is sent (`rpc-mode.ts`), and `RpcFrameDecoder` throws on a chunk sequence that does not start at index 0 or that another frame interrupts; omp writes a frame over 1 MB as such a sequence.
  `get_state` reports `isStreaming`, `isCompacting`, and `hasPendingAsyncWork` (`AgentSession.hasPendingAsyncWork`, a running background job whose result will start the agent again), and `get_subagents` returns `RpcSubagentSnapshot`s with the fields of a subagent lifecycle frame.
  `agent_end` carries `isTerminal: false` while an async delivery remains, such as a background job, so a turn that started one stays running until the job delivers.
  omp's eval kernels and subagents spawn with Bun's `detached`, as session leaders of their own (`pi-coding-agent/src/eval/kernel-base.ts`, `task/executor.ts`), and its background jobs lead process groups of their own, so only a walk of the process tree finds them, and only while omp runs.
  `get_available_models` returns omp's whole `Model` objects, with `name`, `contextWindow`, `api`, `identity`, and `serviceTiers`; `get_state` adds `fastModeEnabled` and `fastModeActive`, and `setFastMode` sends `set_fast_mode`.
  `RpcClient.prompt` resolves with the request id once omp admitted the prompt, and `onPromptResult` delivers that prompt's `prompt_result` (`rpc-prompt-results.ts`); see [Dashboard sessions](#dashboard-sessions).
  Host tools: `RpcClient`'s `customTools` option (`RpcClientCustomTool`), which `start()` sends as `set_host_tools`, so a new process for the same session gets them again, and `setCustomTools`, which replaces them for a session the server attached to; `pi-coding-agent/src/modes/rpc/host-tools.ts` runs them as strict tools, sending `host_tool_call` and waiting on `host_tool_result` or its own `host_tool_cancel`, and `defaultLoadModeForToolName` in `pi-coding-agent/src/tools/essential-tools.ts` makes one without `loadMode: "essential"` only discoverable.
  A host tool stays registered through `newSession`, `switchSession`, and `/move` in one process, since omp builds `SessionTools` once per `AgentSession` (`pi-coding-agent/src/session/session-tools.ts`).
  Extensions: `omp -e <file>` (`pi-coding-agent/src/main.ts`, `additionalExtensionPaths`) loads in `rpc-ui` mode too; `pi-coding-agent/src/discovery/omp-extension-roots.ts` dedupes by path only, so the same extension at two paths loads twice.
- Service tiers: `serviceTierFamily` and `shouldSendServiceTier` in `pi-ai/src/types.ts`, which `fastAvailable` in `src/omp/models.ts` calls to decide, as `setFastMode` in `pi-coding-agent/src/session/model-controls.ts` does, whether `/fast` can turn on for the live model.
- Settings and discovery: `pi-coding-agent/src/config/settings.ts`, `pi-coding-agent/src/discovery/index.ts`, and `pi-coding-agent/src/task/discovery.ts`.
- Credentials: `pi-coding-agent/src/session/auth-broker-config.ts` (`discoverAuthStorage`) and `pi-ai/src/registry/oauth/index.ts` (`getOAuthProviders`).
  `connectedProviders` in `src/omp/models.ts` keeps the `/login` providers that have a credential, as omp's RPC `get_login_providers` marks them `authenticated`.
  It opens the credential store on each call and closes it, so a login in a terminal counts at the next call.
  Settings › Providers runs omp's own `/login` and `/logout` through `src/omp/providers.ts`: `AuthStorage.oauth.login` (`pi-ai/src/auth-storage.ts`) with `captureBrowserSession` from `pi-coding-agent/src/utils/browser-session.ts` for a cookie sign-in, `formatLoginIdentity` from `pi-coding-agent/src/cli/oauth-terminal.ts`, `ModelRegistry.refreshProvider` from `pi-coding-agent/src/config/model-registry.ts` afterwards, as `omp login` does, and `toLogoutAccounts` and `logoutCredential` from `pi-coding-agent/src/slash-commands/helpers/logout.ts`.
- Model selectors: `parseRetryFallbackSelector` in `pi-coding-agent/src/session/retry-fallback-chains.ts`, which only `readSelector` in `src/omp/config.ts` calls.
  `readSelector` reads a selector against the `provider/id` of the listed models, so a `:level` splits off only after an id that `omp models` lists, and returns the selector's provider, id, and suffix.
  `resolveSelector` keeps the read only when its model is listed, and `routedSelectors` names every selector of the routing: each role's, and each fallback chain's key and entries.
- Model roles: `pi-coding-agent/src/config/model-resolver.ts` (`expandRoleAlias`, `resolveRoleChain`), whose `@role` aliases `resolveRoles` in `src/omp/models.ts` follows for `GET /api/models/roles`.
  `modelEntries` reads each of the `routedSelectors` with `readSelector` and maps it to a listed model with `resolveProviderModelReference`, which follows retired variant ids such as `grok-4.7-high` and dotted spellings such as `claude-fable-5.1`.
- Side answers: `streamSimple` in `pi-ai/src/stream.ts`, with `resolveRoleSelection` in `pi-coding-agent/src/config/model-resolver.ts` and `ModelRegistry`'s `refresh`, `getAvailable`, `getApiKey`, and `resolver` in `pi-coding-agent/src/config/model-registry.ts`, which `answerDiscussion` in `src/omp/discussion.ts` uses to answer **Ask about this** with one model call outside every session; see [Ask about this](#ask-about-this).
  It reads the `smol` and `default` roles from the user's settings (`Settings.loadReadOnly` with `HOME` as its directory), so a project's `modelRoles` do not apply, and it loads no extension's custom provider.
- MCP: `pi-coding-agent/src/mcp/json-rpc.ts` (`callMCP`), `config.ts` (`loadAllMCPConfigs`), `client.ts` (`connectToServer`, `listTools`, `disconnectServer`), `oauth-credentials.ts` (`removeManagedMcpOAuthCredentials`), `oauth-discovery.ts` (`discoverOAuthEndpoints`), `oauth-flow.ts` (`MCPOAuthFlow`), and `config-writer.ts` (`addMCPServer`, `updateMCPServer`, `removeMCPServer`, `setMcpServerEnabled`, `validateServerName`, `readMCPConfigFile`), which `src/omp/mcp.ts` wraps for the tickets page, Settings › Integrations, and Settings › MCP servers.
  The MCP sign-ins and sign-outs read and write omp's credential store through the same `discoverAuthStorage`, opened and closed on each call.
  `pi-coding-agent/src/commands/token.ts` uses `refreshStoredManagedMcpOAuthCredential` from `oauth-credentials.ts` to refresh a managed token and persist its rotated refresh token before printing the access token.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory, and `getWorktreesDir`, its directory of isolation sandboxes.
- Isolation sandboxes: `ISOLATION_OWNER_FILE` and `hasLiveIsolationOwner` in `pi-coding-agent/src/task/isolation-ownership.ts`, the marker `ensureIsolation` in `task/worktree.ts` writes and the check of its process id and start time, and `stopRetainedMount` in `pi-coding-agent/src/cli/worktree-cli.ts`, the teardown `omp worktree clear` runs on a retained mount, which `src/omp/isolation.ts` hands the sweep; see [Isolation sandboxes](#isolation-sandboxes).
- Request usage: `omp-stats/src/aggregator.ts` (`getDashboardStats`, `getToolDashboardStats`, `getTimeRangeConfig`), `rollup.ts` (`getProviderTimeSeries`), `live.ts` (`statsLive`), and `db.ts` (`initDb`).
  `src/omp/stats.ts` reads omp-stats' database and starts its live sync on its first read, which the provider check makes at startup.
  `pi-catalog/src/models.ts` provides `getBundledModel` and `calculateCost`, which `listPrice` in `src/omp/stats.ts` uses to price Claude Code and Codex requests.
  `pi-catalog/src/types.ts` defines their model and usage arguments, including Anthropic's cache-write lifetimes.
- Request context: `buildSessionContext` in `pi-coding-agent/src/session/session-context.ts`, the messages a request on a branch sends, `Tokenizer` in `pi-agent-core/src/tokenizer.ts`, and `resolveModelTokenizer` in `pi-catalog/src/model-tokenizer.ts`, which `src/omp/context-index.ts` uses to count each request's context sources; `getStatsDbPath` in `pi-utils/src/dirs.ts` places its index beside omp-stats' database.
- Request errors: `is402BillingCapBody` in `pi-ai/src/error/rate-limit.ts`, the test omp's credential rotation applies to a 402, which `creditRuns` in `src/omp/stats.ts` uses to tell a provider out of prepaid credits from a 402 that asks for a smaller request.
  `classifyMessage`, `is`, and `Flag.UsageLimit` in `pi-ai/src/error/flags.ts`, and `extractRetryHint` in `pi-utils/src/fetch-retry.ts`, tell a turn that a usage limit ended and the wait its error names, for `usageLimitOf` in `src/omp/usage-limit.ts`; see [Dashboard sessions](#dashboard-sessions).
- Updates: `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts`, the `startup.checkUpdate` and `update.channel` readers in `pi-coding-agent/src/modes/settings.ts`, and `classifyModel` in `pi-catalog/src/identity/index.ts`, which `src/omp/release.ts` and `src/omp/model-updates.ts` use; see [Notifications](#notifications).

## Transcripts

Every transcript comes from the session files on this machine, not from a network connection:

- One recursive file watcher covers each session format's root: omp's sessions directory, Claude Code's `projects` directory under `CLAUDE_CONFIG_DIR` (else `~/.claude`), and Codex's `sessions` directory under `CODEX_HOME` (else `~/.codex`).
  The server makes omp's directory when it is missing; a missing Claude Code or Codex directory is left alone and watched from the first rescan that finds it.
  When a file changes, every open transcript in that directory reads the bytes appended since its last read and folds the complete JSONL lines into display items.
  On macOS a burst of appends can surface only as events for omp's `.<file>.lock` sidecar, which is why a change anywhere in a directory re-reads every open transcript in it.
- A session's transcript is its `<time>_<session id>.jsonl` file.
  A subagent's transcript is `<id>.jsonl` in its parent's artifacts directory, which is the parent's transcript path without `.jsonl`.
  A subagent that outlived a `/new` or `/resume` wrote beside the session it started in, so when the expected file is missing the server looks for the newest `<id>.jsonl` in the project's sessions that changed after the subagent registered.
- A past session reads the same way, so a session that runs without publishing itself keeps updating.
- A Claude Code or Codex session reads the same way, read-only.
  `src/session-formats.ts` holds one `SessionFormat` per agent, and the format whose root holds a file decodes each of its lines into the omp entries the transcript already folds, so the tail, the conversation search, and the past list need no other path.
  A Claude Code session is `<project>/<session id>.jsonl`; its `isMeta` and sidechain records, its bookkeeping records, and its system records other than a compaction are left out, and its tool results become `toolResult` entries.
  A Codex session is `<year>/<month>/<day>/rollout-<time>-<session id>.jsonl`; its developer messages, the context Codex injects as a user message, its events, and its turn context are left out, and a renamed session takes its title from `session_index.jsonl`, the last line for an id winning.
  A Codex session whose `session_meta` names a parent agent is a subagent's, and the past list leaves it out; so does Claude Code's `subagents` directory, which sits one level deeper than a session.
  An unknown or malformed record or content block shows as one warning notice per line with the line's start, alongside any recognized content.
  Intentional empty blocks, injected context, ignored metadata, and encrypted reasoning without readable text do not warn.
  Correlated tool calls require call ids, names, and input; tool results require their call ids, and Codex function namespaces qualify tool names.
  The past row and the pane name the agent, the pane reads `Read-only`, and neither offers **Resume** nor fork buttons; `src/server/start.ts` refuses a fork or a resume of such a file before it starts omp.
  Listing reads only each file's first 256 KB and last 64 KB, and a file whose size and modification time are unchanged keeps its row.
- Live agent events only add what the file does not hold yet: the reply as it streams, and the running state of tool calls.
  omp keeps a message's `timestamp` when it writes the message, so the file's copy replaces the streamed copy in place, and a late event cannot undo it.
  omp writes a fresh session's file only with its first reply.
  Until then the prompt shows from its live event, except a prompt sent from the dashboard to a terminal session, whose file entry has no message timestamp to merge on.
  A `/skill:` prompt is a `custom` message of type `skill-prompt`, and omp writes its `custom_message` entry with the message's timestamp, so it merges on that.
  A queued steer or follow-up keeps the time it was sent, though the agent takes it later.
  So a message from the file never goes ahead of the file messages before it, and a live user message goes after everything already shown.
- A reply that streams and a tool call that runs change with every token.
  Each open transcript sends those changes to the page at most every 50 ms; a message that finishes, a tool call that ends, a prompt, or a notice goes out at once, together with what was held back.
- A dashboard session's view shows a prompt that omp admitted while the main agent was idle as a pending user item, after every other item, until the turn's live user message replaces it ([Dashboard sessions](#dashboard-sessions)).
  It renders as that message will: a `/skill:` prompt as the skill and its arguments, attached files by name, images inline.
  Its id is `starting:<request id>`, and the `items` message that brings the live user message lists that id in `removed`, so the page drops it and appends the real prompt in one update.
  A pending prompt is the only item that leaves a transcript, so `removed` is empty in every other `items` message.
- A user message whose text starts with `[omp-agents]` (`DASHBOARD_PROMPT_PREFIX` in `src/shared/transcript.ts`), such as a project's update, is a prompt the dashboard sent in the user's place.
  The transcript folds it into a `dashboard` item, never a pending one, which the page renders as nothing but counts as a turn's prompt: the reply before it keeps its copy and fork buttons, the user's prompt before it is no longer the editable last prompt, and a reply before it suggests nothing.
  `messageItemsOf` leaves it out, so the conversation search skips it and the trajectory folds it as an `omp-agents` injection into the turn before it; it titles no session, neither through the `/rename` a dashboard session sends after its first prompt nor as a past session's first prompt, and the composer's queued rows leave it out.
- The same read folds each line into the view's changed files as well, from each `edit` result's `details.path` and `diff` (one per entry of `perFileResults` for a multi-file edit) and each `write` result's `details.resolvedPath`, which omp sets only for a file.
  The view's socket topic carries them as `work` messages: the whole list with the transcript, then only the files each later read changed, which the page puts in place by path.
  A subagent's view folds its own file, so it shows its own changes.
- A `task` result names the subagents it spawned in `details.progress` and `details.results`; the tool item lists their ids, which name each subagent's view.
  A running `task` reports them sooner through `tool_execution_update` events.
- A tool result's images, through `imagesOf` in `src/session-entries.ts` as a prompt's, ride on its tool item as `images`, which the transcript shows under the call's row; only the view's own file adds them, while the media tree below also collects its subagents'.
- Each watched view also gets a media tree (`src/media.ts`), which collects the images that tool results returned, from the view's file and from every subagent transcript, at any depth, in the directory named after it.
  About half the screenshots in a session sit in its subagents' files, so a session's view collects them all; a subagent's view collects its own and its subagents'.
  An image is a `content` block of a tool result, which omp moves to its blob store, so it reaches the page through `/api/image`; the caption is the summary of the tool call with the same id, and a user prompt's images are left out.
  It also collects image files the session wrote, as `AgentMedia` with `path` set and a `src` of `/api/media?path=`: each path ending in an image extension in a tool call's string arguments, at any depth, or in its result's text, resolved against the call's `cwd` argument, else the session's `cwd` from its header.
  A named file counts as written when `stat` finds a regular file modified at or after the `timestamp` of the tree's own session header, which leaves out paths in source code and files that predate the session.
  The tree keeps each check with the time it ran, and checks a path again when a later call names it, since a script may write a file after a call lists it.
  A `read` of an image file sets that path on the image it returned, and each path shows once across the tree: its oldest entry, and none for a path the list already holds.
  It reads each file incrementally, parses only lines holding a tool call, an image block, a path to an image file, or the session header, and reads a tool result's call id without parsing the result, so a caption is dropped once its result arrives, unless the call named an image file; it lists the directory again, reading the subagent files at once, after each change under it, so a subagent that starts later is found.
  The watcher's changes poke it only for its own file, that file's `.<file>.lock` sidecar, and anything under its artifacts directory, since a subagent's appends do not touch the session file, and a sibling session's writes leave it alone.
  The view's socket topic carries them as `media` messages: the whole list once the files are read, then only the images each later read added, which the page sorts in newest first.
  A file rewritten shorter, or the first read, sends the whole list again.
  The Media tab sends selected images on: `PUT /api/pull-request/attachment` takes `PullRequestAttachment` from `src/shared/github.ts`, a pull request and 1 to 50 PNG, JPEG, GIF, WebP, or SVG images of up to 10 MB in base64, each with alt text, which are the limits and types of `gh pr edit --attach`.
  `attachToPullRequest` in `src/pull-request-edit.ts` writes them to a temporary directory, each named for its place and ending in its type's extension, since `gh` reads the type from it, runs `gh pr edit <n> -R <owner>/<repo> --attach <file>#<alt>` for every image, which appends them and keeps the body, and removes the directory however `gh` ends.
  When some uploads fail, `gh` exits non-zero yet still adds the others, so the error the page shows can come with a changed description.
  Each image for a Linear issue goes through `PUT /api/ticket/attachment`, as the new-issue dialog's files do.
- A view whose **Trajectory** a socket shows also gets a trajectory tail (`src/trajectory.ts`), which folds the view's own file into turns: a turn opens at each user message or `custom_message` that the transcript shows as a prompt, so the turns match the minimap's.
  Entries that wait for the model, such as a model change, a `model_usage` side call, a `ttsr_injection`, or a hidden `custom_message`, join the turn in which the next assistant message reads them, and are left out until one does.
  Each assistant message is a request with the `usage` omp recorded on it; `model_usage` entries are only side calls such as auto-thinking and cache warming, so a turn's usage adds both.
  `watch` lists those views in `trajectories`, and the watcher's changes poke the tail as they poke the transcript.
  The socket topic `turns:<view>` carries `turns` messages: every turn once the file is read, then only the turns each later read changed, which the page puts in place by id.
  A page that stops showing the Trajectory leaves the topic, and the tail closes when no socket shows it.
- The server lists the session files through each format's listing at startup and then once a minute, in case a watcher missed a change; omp's is omp's session listing, the code behind omp's session picker.
  Between listings it reads again only the session files the watcher reported, at most twice a second, so a session that streams costs one file read, not a listing of every session.
  The past list skips the empty sessions that omp's picker hides, and a Claude Code or Codex session with no prompt and no reply.
  The server looks up files by session id in this listing, so the page never sends a path.
  While no page is connected, it skips building the roster and the past list.
  The past list goes out whole when a page connects; after that the server compares each session with what it last sent and sends only the sessions that changed, joined, or left, so an untouched row keeps its object on the page and skips its render.
  `SessionFiles.past` hands back the same row object while the session's listed file, its facts, and its interruption are the same objects as before, and the comparison skips serializing a row it already sent as that object, so a push while one session streams serializes only that session's row.
- Whenever the list changes, the server also scans for pull requests in each session file whose modification time changed, plus the subagent files in its artifacts directory.
  Like an open transcript, each file reads only the bytes appended since its last scan.
  The first scan reads every session file, 16 sessions at a time.
  On 641 MB across 464 sessions it takes under a second, and the sidebar shows before it finishes.
  A session that names a PR by number alone, or works on a branch, costs one `git remote get-url origin` in its working directory.
  A `gt submit` call costs, once per directory it ran in, one `git remote get-url origin` and a `git reflog show HEAD` with a `git symbolic-ref HEAD`, which place the branch checked out at the call's time; the server keeps each call's branch for as long as it lists the session.
  A subagent's appends do not change the session file, so its pull requests show once the session writes again, at the latest when it receives the subagent's result.
- The same scan collects the Linear issues each session worked on, by identifier, from the arguments of its Linear MCP calls: a direct `mcp__linear_<tool>` call or a `write` to `xd://mcp__linear_<tool>`, whose `content` holds the arguments as JSON.
  `get_issue` and `save_issue` name the issue in `id`, `list_comments` and `save_comment` in `issueId`; a `save_issue` with no `id` opens one, whose identifier its result's JSON `id` names.
  A UUID is left out, since the tickets page opens an issue by identifier.
  The `/ship` state's `issue` counts too.
  Session rows carry them as `tickets`, the session's own first.
- The same scan reads the branch each session that wrote works on, in its worktree else its directory, through `worktreeAt` in `src/git.ts`.
  In a linked worktree that is the branch checked out now; in a repository's main checkout it is the branch `headHistory` and `branchAt` in `src/git.ts` find checked out at the session file's last write, from the HEAD reflog.
  `defaultBranchOf` there reads the repository's default branch from `origin/HEAD` with one `git symbolic-ref` per directory of a session that wrote, so a moved `origin/HEAD` updates the `defaultBranch` of every session in that directory.
  Session rows carry it as `branch`, a `SessionBranch` `{ name, linked, defaultBranch, pullRequest }` from `src/shared/sessions.ts`, `null` on a detached HEAD, outside git, or once the directory is gone, and a branch switch changes the row at the session's next write.
- Each read of the pull request list tells the server which branch heads which pull request in that repository.
  The server then links each session whose `git push` updated one of those branches, whose `gt submit` submitted one, or whose linked worktree has one of them checked out, to that PR, and sends the sidebar the new links.
  It also sets the `pullRequest` of each such session's `branch`, the PR it heads, and so links the PR of a main checkout's branch other than the default one too; the header's **Open PR** shows only while it is `null`.
- The list names a new PR only at the page's next read, up to a minute after the session opened it, and only once GitHub's search has indexed it, some seconds after.
  So when a session's transcripts name a PR it did not link before, such as the URL `gh pr create` prints, while its branch heads none yet, the server asks GitHub at once which PR that branch heads, through one `gh api graphql` call outside the search (`branchPullRequest` in `src/pull-requests.ts`), and sets `pullRequest` from the answer.
  The answer outlives later reads of the list, which search may still leave without the PR, until one names that branch, whose PR then takes its place.

## Terminal sessions

Sessions started in a terminal are reached through their Collab room:

- Every 1.5 seconds the server lists the local hosts through the registry, and pushes the roster when a row or the registry error changed; the past list goes out again only when a session joined or left.
  The roster goes out the way the past list does: whole when a page connects, then each push carries only the rows that changed or joined, the instance ids that left, and the registry error.
  That is the same call that backs `omp collab list`.
- The server joins every listed session's room as a guest named `omp-agents`, as `omp join` would.
  The guest is how the dashboard prompts a session (`prompt` frames), stops a turn (`abort`), messages a subagent (`agent-cmd` `chat`; the host steers, prompts, or revives it), and cancels a running subagent (`agent-cmd` `kill`).
  It also carries the host's subagent registry (`agents` frames), subagent progress (`bus` frames), the host's model, thinking level, context numbers, and whether a turn runs (`state` frames), and the live agent events.
  The composer enables as soon as the host welcomes the guest.
  Nothing waits on the transcript snapshot that the host then sends.
- The host steers every `prompt` and `chat` that arrives during a turn.
  The guest therefore holds follow-ups and sends the next one when a `state` frame stops reporting `isStreaming`, or when an `agents` frame shows the subagent no longer running; it checks after every frame but the agent events, which cannot end a turn.
  It sends none after a turn that its own `abort` or a reply cut off mid-stream ended.
- The dashboard uses omp's discovery and autocomplete modules for file commands, skills, and file mentions.
  It expands file commands and skills before guest prompt delivery because Collab prompts bypass the host's slash-command pipeline.
  The host still resolves `@file` references in the selected session's working directory.
- If a host starts a new room, for example after `/new` or `/resume`, the server sees the new generation and joins the new room.
  If the link request races the switch and fails with `stale_generation`, the server lists again and retries.
  A host that leaves the registry is marked as no longer running.
- Collab has no frame that ends a host, so ending a terminal session sends `SIGTERM` to its omp process, through a writable room only.
  The guest first lists the registry again and signals only when the same `instanceId` still runs at that pid and hosts the session, so a pid that a host freed and another process reused since the last poll is never signalled.

Terminal sessions send their questions to writable guests as Collab `ui-request` frames, and the guest answers with `ui-response`.
The host races every writable guest against its own terminal dialog, and the first answer wins.
When the question ends anywhere else, the host sends `ui-request-end` and the card goes away.
After a reconnect, the host sends the questions that still wait again.
Read-only rooms receive no questions.

### Why the server joins every terminal session

Subagent status lives in the host's memory.
The session files on disk cannot tell an idle subagent from a parked one.
The guest connection is the one source the protocol offers for live status, and the host already leaves advisor rows out of it.
Joining every session keeps those rows current for sessions that you have not opened, and keeps each room ready for a prompt.

The cost is visible on each host and on its relay (`collab.relayUrl`, by default an internet relay):

- Each listed session counts `omp-agents` as one more participant for as long as the dashboard runs.
  The terminal shows that the guest joined.
- Each session sends its full transcript snapshot through the relay when the dashboard joins it, and every live event after that.
  The dashboard ignores the snapshot.
  Transcripts never travel through the relay.
- The text that says what a subagent is doing comes from live progress events.
  After the dashboard restarts, a subagent's link shows only its status until that subagent reports progress again.

Stop the dashboard to leave every room.

## Dashboard sessions

Sessions started from the dashboard are omp processes in RPC mode with tool dialogs, driven through omp's own `RpcClient`.
Each runs under a session keeper, so it outlives the server that started it; see [Session keepers](#session-keepers).
They use the installed CLI with `--mode rpc-ui`.
The page starts one with a single `start` request whose `kind` is `new`, `fork`, `resume`, or `replay`, and the server answers each with one `started` reply that carries the new session's instance id or the error.
The server picks the instance id before omp spawns, so a question that omp raises while the session opens already belongs to it.
A new session's first message rides on the `start` request: the server spawns omp, sends the message as its first prompt, and answers the page as soon as omp reports ready, with no terminal, registry, or relay involved.
**Resume** starts the same process in the directory that the session file's header records and opens the file with omp's `switch_session` command.
Prompts, Stop, live events, subagent progress, and questions stay on omp's stdio, which the keeper lends the server.
A prompt carries omp's `streamingBehavior`, `steer` or `followUp`, so omp queues it during a turn the way its terminal does.
A prompt omp refuses shows as a note in the session, and `LiveSession.prompt` rejects with `PromptRefused`, so a caller that has no one else to tell, such as the socket handler or a session's first message, skips it.
The composer's queue is omp's `queue_update` event.
A `dequeue` message takes one message back with `remove_queued_message`, and the server answers with `withdrawn`, carrying its text and images so the composer can restore both.
A `promote` message, a queued row's **Send now**, is `promote_queued_message`, which moves a follow-up into the steering queue.
An `interrupt` message, Stop, is `abort_and_restore_queue`, which aborts the turn and hands back both queues, steers first, in one `withdrawn` answer; omp's terminal Esc does the same.
omp's restore leaves out a prompt it admitted but never ran, so when the session's starting prompt got no live user message before the abort answered, the session puts that prompt first in the `withdrawn` answer ([Dashboard sessions](#dashboard-sessions)).
A session runs its prompts, interrupts, promotes, and `flush` requests one at a time, in the order the page sent them (a `SerialLane` from `src/serial-lane.ts`), because the socket handlers do not wait for each other.
When an abort follows, omp drops a prompt it has read but not yet run, so an abort that got ahead of a steer would lose it.
Enter on the empty composer sends `flush`, and the session aborts only if omp's queue, read with `get_state` at that moment, still holds a steer; omp then runs that steer as its next turn.
A steer that has left the queue is already in the turn, recorded or streamed into the response, and an abort then would cut off the reply to it, so neither the page's lagging copy of the queue nor omp's terminal rule, which also counts such a steer, decides.
A guest keeps the same order for its `prompt`, `abort`, and `flush` frames, because it expands a prompt before it sends it.
Collab has no queue frames, so a guest answers `promote` by sending the follow-up it holds as a steer, and `interrupt` by taking back the follow-ups it holds before it sends `abort`.
It flushes while the host's `state` frame counts a queued message (`queuedMessageCount`), or while this guest sent a steer that no `state` frame has counted yet.
Plain `--mode rpc` gives the session no `ask` tool.
`rpc-ui` gives it one, and omp sends extension dialogs as `extension_ui_request` frames.
The server sends `set_ask_dialog` when it opens a session, so omp sends each `ask` call whole as one `ask` frame and takes all its answers in one `extension_ui_response` (`requestRpcAskDialog` in `rpc-mode.ts`) instead of a chain of selects, whose frames do not report a multi-select's checked rows.
omp's `RpcClient` reads those frames but only hands them to its own login flow, so the server reads a copy of the child's stdout through omp's JSONL reader and chunk decoder.
It writes the `extension_ui_response` to the child's stdin as one line, the way `RpcClient` writes its own commands.
omp sends a `cancel` frame when a question ends without an answer, for example after Stop.
A question with a timeout ends with no frame, so the server drops it at its deadline.
omp's RPC mode does not title a session from its first prompt, as its terminal does.
While a session has no title, each user message's `message_end` event makes the server send a bare `/rename` prompt, which omp runs as its own command: it titles the session from the conversation in the background and announces the title with a `session_info_update` frame.
`RpcClient` drops that frame too, so the same stdout copy reads it, and the server then reads omp's state again for the new `sessionName`.
An `agent_end` that ends the run, not one that hands over to a queued follow-up (`isTerminal: false`), makes the session report `turn-ended` with its last reply: the text of the last assistant message that has any, without the suggested prompts `splitSuggestions` takes off, or `null` when none has text; the project runner reads it ([Projects](#projects)).
The same update carries `limit`, the provider's usage limit the run ended on, or `null`: `turnUpdate` in `src/live-session.ts` reads it with `usageLimitOf` in `src/omp/usage-limit.ts`, which reads the run's last assistant message, and counts it when its `stopReason` is `error` and omp's `classifyMessage` flags it `UsageLimit`, the same test omp's retry and credential rotation apply.
It keeps the wait the error names, such as `retry-after-ms=…`, through omp's `extractRetryHint`; see [Scheduled sends](#scheduled-sends) for the continue the server schedules for a session it started, including one it attached to after a restart.
A dashboard session reports `turn-ended` before the roster update that shows it idle, so the server holds a session the limit stopped before the routine and project runners see it idle.
Each main-agent `agent_start` makes the session report `turn-started` once its status reads working, whoever prompted it, which cancels a continue the session waits on.
A session keeps running when the server stops, restarts, or crashes; only **End session**, or omp exiting on its own, ends it.
The transcripts stay on disk, and **Resume**, or `omp --resume <session id>` in a terminal, continues one that ended.

omp acks a `prompt` once it admitted it, but on every turn its auto-thinking classifier (`applyAutoThinkingLevel` in `pi-coding-agent/src/session/model-controls.ts`) holds `agent_start` back by about a second, and a new session's first turn can also wait on MCP discovery (`MCP_DISCOVERY_TURN_WAIT_MS` in `pi-coding-agent/src/session/agent-session.ts`).
So a prompt the main agent takes while idle becomes the session's starting prompt at its ack: the session reports `working` and tells its view, which shows the prompt as pending ([Transcripts](#transcripts)).
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
The dashboard serializes model, effort, and fast-mode setters with state reads in a separate `SerialLane` from turn commands.
Event-driven refreshes coalesce while queued, so a read cannot overwrite a later switch, and switching stays visible until every queued model change has finished.

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

### Session keepers

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
omp's output while no server listens is dropped; the attaching server reads omp's state instead: `DashboardSession.reattach` counts a turn as running when `get_state` reports `isStreaming`, `isCompacting`, or `hasPendingAsyncWork`, lists the subagents `get_subagents` reports, and serves the session's project tools again with `set_host_tools`.
A host tool call that no server hears, because none has joined, fails at once with a note that the dashboard restarted, so omp's turn goes on; so do the calls a server heard and did not answer before it hung up or another joined.

The server's shutdown calls `DashboardSession.dispose`, which hangs up without stopping omp; the link's `ended` then settles with `detach` rather than `exit`, so the session reports no exit and does not count as finished.
At startup `reattachAll` in `src/server/start.ts` connects to every socket in the directory under the instance id it had, holding back what each session reports; a socket nobody listens on loses its files.
A keeper that takes the connection and does not greet within 3 seconds is stuck: the server hangs up, logs its instance id, and stops it by the pid in its `.pid` file with `stopTree` in `src/process-census.ts`, which lists the keeper and every process under it with one `ps`, each with its start time, sends them SIGTERM, and after 3 seconds SIGKILL only to those still running under the same start time, so a pid another process reused is never hit.
Startup and the socket gate then wait at most about 6 seconds, no Resume starts a second omp on its file, and `recover` counts its session as interrupted.
Once all attached, `InterruptedSessions.recover` learns which sessions survived, and only then is each listed again, in its project, and what it reported passed on, before the runners recover.
Attaching to a keeper that greeted never stops omp: a session file without a readable header leaves the session in the directory omp started in, a replay marker that cannot be read counts as a replay, and a session that fails to attach is left running, unlisted, for the next server.
**End session** sends the keeper `omp_agents_keeper_stop`: the keeper notes the processes under omp while omp is still their parent, sends SIGTERM to omp and to them, SIGKILL to those left after 3 seconds, removes its socket and log, and exits.
omp exiting on its own ends the same way, except that its processes are no longer under it, so the keeper stops the ones it noted before.
omp's background jobs, kernels and subagents lead process groups or sessions of their own and are reparented once omp exits, so the keeper's `ProcessCensus` (`src/process-census.ts`) notes the processes under omp with `ps` a second after a tool call ends, since an async call starts its job just after it returns, and every 10 seconds, each with its start time so that a reused pid is never signalled.
A process omp started since the last note escapes an omp that exits on its own.
A `ps` that fails is logged with the pids that may still run, rather than read as nothing left.
A keeper exits whenever omp does, and omp exits when its keeper dies, since its stdin closes, and stops its own background jobs as it exits.

## Replay from here

`src/replay.ts` owns replay preparation and comparison. The dialog first reads `GET /api/replay/detail?view=<JSON View>&turnId=<prompt entry id>`.
The dashboard resolves that authorized main-session view to its known file, then reads the prompt through omp. It returns an HMAC-authenticated source token containing the file, session id, selected prompt id, and a fingerprint of the header, ancestors, and prompt.
`start` with `kind: "replay"` carries that token, the same view, the selected model and thinking level, and either a replacement prompt or `null` to retain the original.
Revalidating the token rejects a replaced or edited source without rejecting later appended responses. No browser-supplied source path is opened.

`src/omp/replay-fork.ts` uses the installed `SessionManager` to branch through the prompt's parent with artifacts copied. A null parent uses `newSession`.
`userTurnDraft` restores ordinary stored text or a skill invocation, and blob-aware `imageContent` restores images in order. Required missing images are errors.
The new prefix receives only omp's synthetic unresolved-tool results, never execution of inherited calls. The fork moves to the detached checkout, clears inherited additional write directories, and flushes and closes before RPC opens it.
The source is never RPC-opened. The accepted original turn and its verified complete first request body are frozen in omp's native blob store.

The checkout uses only the source cwd's current Git repository and canonical common-directory identity. A surviving HEAD reflog commit at the prompt's time is preferred; otherwise current HEAD is explicit provenance.
Neither route reconstructs historical dirty state. `Worktrees.start` serializes this checkout creation with removal, and a failed launch removes only its recorded owned root after the existing preview permits it.
The normal dashboard registry, request ledger, session transport, first-prompt path, and worktree removal checks remain the lifecycle owners.

The `omp-agents-replay` custom entry stores versioned source and checkout identities, accepted settings and prompt-change flags, repair provenance, and original blob references.
`ReplayFold` exposes it through ordinary session facts, records the first subsequent user prompt's entry id, and consumes the `omp-agents-replay-check` evidence. Later prompts never replace that target.
There is no replay registry or durable draft state machine. Native session inventory and existing transcript and trajectory streams provide live state. A restart never resends the first prompt.
Before admission, only the selected first text and exact ordered images are accepted. That turn excludes further prompts and settings or history changes until completion, including a preflight refusal reported by `prompt_result`.

`src/omp/replay-launch.ts` keeps advertised tools intact. It adds the guard and request-log extensions when absent and launches with an atomically regenerated private LSP overlay outside the writable checkout.
The overlay disables format-on-write and edit/write diagnostics and enables lazy LSP startup. Before prompting, the server waits for `omp-agents-replay-ready` with this launch's random nonce, so a stale acknowledgment cannot authorize an unprotected resumed process.
`replay-guard.ts` lets model `bash` calls run unchecked and blocks eval, task, direct LSP, MCP, and unknown tool calls. Only audited local reads and checked in-root writes run among the file tools.
Its pure policy uses omp's native edit inspector across supported grammars, including delete and move destinations. It rejects URI, database and archive mutations, lexical and canonical metadata paths, outside targets, symlink escapes, and hard links.
Blocked calls add `omp-agents-replay-block` so the ordinary tool trajectory can distinguish a policy block from another error.
This policy is not an OS sandbox or a confidentiality guarantee. Installed startup code and dependencies remain trusted, outside reads remain possible, and another process can race filesystem checks.
The dashboard rejects local slash commands, including history edits, and subagent steering prompts in a replay; human `!` commands run, and the independent terminal panel is not restricted. Dashboard resumes restore the policy and its safe-launch overlay. A direct terminal resume cannot promise the same launch configuration.

At `before_provider_request`, the guard correlates the chosen model and final user text and images with the native first prompt. A classifier that quotes that prompt is not sufficient.
The prompt must be the trailing text of the last user message, because omp prepends a dated `<system-reminder>` block to it.
The same request-log reconstruction exported by `request-log.ts` verifies the complete original body against its logged SHA-256.
The pre-send comparison includes the complete envelope, not a combination of component hashes. It permits only known root-prefix relocation, the per-session `client_metadata` and `prompt_cache_key` fields, and an explicitly selected model's top-level routing and generated workstation metadata.
Those two fields carry the session, thread, and turn ids, which every fork gets fresh, so only the raw hash still covers them.
Dates, messages, images, other cache metadata, loaded docs, tool catalog text and schemas, thinking, and unknown repair outcomes stay unchanged. Missing evidence or different APIs produces unknown, and no body is changed to manufacture equality.
The replay checkout is recorded with omp's spelling of its path: on macOS omp drops the `/private` prefix of its launch directory and refuses to open a session whose header names the other spelling.
Literal normalization-tag text cannot alias generated tags, and a structured `model` object is not erased as a routing identifier.
The hook can precede provider transformations, so the claim is hook-stage equality, not guaranteed wire equality.

`GET /api/replay/compare?view=<JSON View>` reads a replay's accepted original blobs, pinned first prompt, complete reconstructed request bodies, and full-detail trajectories.
The web dialog uses the existing trajectory stream as its refresh signal, aligns tool sequences by ordered names while retaining repeats and unmatched calls, compares unclipped arguments and the last request's full text, and displays recorded token and dollar totals.
Truncated previews never establish equality. A response without a correlated pre-send check or a request that cannot reconstruct to that check says unknown.
The source relation and comparison remain readable from the replay file after it stops or the dashboard restarts.

## Socket requests

A page tags a message it waits on with an `ack`, counted per page load, and the server answers it with `done`, carrying the error its handler threw or `null`.
`request` in `web/use-dashboard.ts` sends that way prompts, answers to questions, starts and **Resume all**, interrupts, ends, edited prompts, model, thinking, and fast switches, subagent cancels, a routine's **Run now**, and each change to the scheduled sends.
A model switch's `done` comes once omp switched, or refused, and the session read its state again; the composer's picker waits on it, and a roster row's `switching` only tells other pages that a switch runs.
A message the page does not tag, such as a pin, a todo change, or a queued row's **Send now**, is dropped when the socket is down, as before.

A socket can close after the server got a request and before its answer reached the page, and the page cannot tell that from a request the server never got, so it may not simply send it again: a prompt would reach the session twice.
So the page picks an id once per load, `crypto.randomUUID()`, and opens `/ws?page=<id>`, and `RequestLedger` in `src/server/request-ledger.ts` keeps each page's requests by `ack` across its sockets.
A request runs once, and its replies to the page that sent it (`withdrawn`, `started`, `resumed-all`) and its `done` are recorded and sent to whichever socket the page has open at the time.
Each socket the page opens sends `resume` after `watch`, with every tagged message the page still waits on.
The ledger sends the recorded replies of each request it ran, and its `done` once settled; it runs a request it never got; and it forgets every request the page no longer lists.
A reply for a live session goes only to a socket that shows it, which a resume after `watch` already knows.
Each tagged message also carries `floor`, the lowest `ack` the page still waits on, and the ledger forgets the requests below it.

The ledger first hears of a page at its `resume`, which then lists only requests the page sent before this server knew it: to a server that has since restarted, or to this one more than an hour ago, since the ledger forgets a page an hour after its last socket closed.
Each of them gets `done` with the error `FORGOTTEN`, "The server restarted or lost track of this page before it answered. Check whether it took effect.", and the ledger records that answer, so a later resume gets it again and nothing runs.
A tagged message from a page the ledger does not know yet is logged and dropped, which the page never sends, since every socket sends `resume` first.
Replies and `done` go to the page's current socket; `Peer.socket`, the socket a message came on, is only for `watch`, which sets that socket's views.
A request the page makes while disconnected rejects at once with "Not connected to the server.", and one it made before keeps waiting across the reconnect, with no time limit.
A prompt that fails comes back to the composer with its files and a note, and a failed answer lets the question card take another.
A handler's error goes to the server's log once, with its message type, on the run that threw.
A page loaded before page ids tags its requests with no `floor`, so the server drops them until the page reloads.

`ListRegistry` in `src/server/list-registry.ts` owns the whole-list snapshots for todos, routines, scheduled sends, workspaces, pins, projects, notices, and review drafts.
`Dashboard` registers each typed message builder once, beside its store's edit function when it has synchronous edits.
`Broadcasts.open` iterates these registrations, so a new list needs no separate opening-snapshot or push method.
`Broadcasts.pushList(kind)` uses that same builder and suppresses an identical whole-list message; roster and past messages still send their row-level deltas.
Socket edits, workspace HTTP edits, todo inbox changes, and routine pin changes go through the registry's typed `apply`.
An edit that changes the list publishes it to every listener; one that changes nothing instead resends the authoritative snapshot to its requesting peer, if there is one.
Routine and scheduled runner actions and asynchronous notice actions remain separate, publishing their list through `pushList` when they change it.

## Ask about this

**Ask about this** answers a question about selected text with one model call that no session sees, unlike omp's `/btw`, which sends the whole conversation and records the exchange in the session file.
The page's `web/discussions.ts` holds the one open discussion in memory and sends each question as an untagged `discuss` socket message with an id counted per page load; `parseDiscussionRequest` in `src/server/wire.ts` holds every text to its limit in `src/shared/discussions.ts`.
The request is the passage, its source, the earlier questions with their finished answers, and the new question, and `discussionPrompt` folds all of it into one user message, which the panel shows as sent.
`Discussions` in `src/server/discussions.ts` runs `answerDiscussion` from `src/omp/discussion.ts` per question and sends its events back to the socket that asked as `discussion` messages: the model, the text in pieces, and an `end` with the error or `null`.
The answers go over the socket rather than an HTTP response, which Bun would cut after its 10-second idle timeout while a slow model writes nothing, and the handler is not awaited, so a `discuss-stop` reaches a running answer.
`discuss-stop` aborts the answer, which ends with no error, and a socket that closes aborts every answer it asked for; the page marks an answer it was waiting on as failed when its socket closes.
`answerDiscussion` resolves omp's `smol` role, else `default`, among the models with a credential, and streams with reasoning off and at most 4,096 output tokens.
**Send to session** is not part of this flow: the page sends the quoted passage and the answer as a `prompt`, as the composer does.

## Desktop shell

`desktop/` is the desktop app: an Electron main process, `desktop/main.ts`, in its own package, so the root `bun install` never fetches Electron.
Electron's main process runs on Node, which cannot load omp's TypeScript modules or the server's `Bun.*` calls, so the shell runs the server as a child process on Bun and never imports it: `bun src/server.ts` from a checkout, and in the packaged app the Bun binary it ships in `Contents/Resources/server/bin/bun` on the bundled `server.js`, with `OMP_AGENTS_RESOURCES` naming that directory (`src/server/resources.ts`) so the server reads its prebuilt page and the starter kit from it.
omp's sessions run on that same Bun, through `process.execPath`.
It imports only `src/paths.ts`, `src/json.ts`, `src/server/auth.ts`, `src/server/address.ts`, and `src/shared/desktop-bridge.ts`, which use Node's modules alone; `bun build` bundles them into `desktop/dist/main.cjs`, and `desktop/preload.ts` into `desktop/dist/preload.cjs`.
Its global quick-capture shortcut dispatches `QUICK_TODO_EVENT`, from `src/server/address.ts`, in the page, which `web/app.tsx` answers by opening the command palette on its **Create todo** view.
`src/server/address.ts` holds what the two processes must agree on: the port from `PORT`, the host names the server answers to, and the line it prints once it listens.

- At launch it calls `loadToken`, as the server does, so whichever runs first creates the token file, and asks `GET /?token=<token>` on the port.
  A 302 that sets the cookie can come only from an omp-agents server that holds this token, and the window uses it.
  A refused connection starts a server.
  Any other answer means the port is taken, and the window says so.
- The shell takes the server as started once it prints `listeningLine` (`omp-agents (omp v…) on http://127.0.0.1:<port>`), not once the port answers: another server that took the port while this one built its page would answer too, and the shell would then own a server that is about to fail.
- It spawns the server with `OMP_AGENTS_PARENT=stdin` and an open stdin pipe that it never writes to.
  The server calls its `shutdown()` when that pipe ends, which it does however the shell exits, `SIGKILL` included, so no server outlives the app and holds the port.
  On a normal quit, the shell sends `SIGTERM` and waits up to 10 seconds for the server to write its stores and let go of its sessions.
  Quitting leaves the sessions the server started running, as a restart or a crash does: the server cannot tell a quit from a restart, **Restart to Install** quits too, and the next launch shows them live again, while **End session** stays the one way to stop a session.
- **Update dashboard** runs the server again inside the same process ([Updating the dashboard](#updating-the-dashboard)), so the shell keeps its child, its pipes, and the window; the page in the window reloads itself once its socket hears a new build, as a browser tab's does.
- The window loads `http://127.0.0.1:<port>/?token=<token>`, a navigation that sends `Sec-Fetch-Site: none`, so `guardsFor` admits it as it admits the printed address in a browser, and the socket's `Origin` matches its `Host`.
  A custom scheme for the page would fail that check.
- `setWindowOpenHandler` denies every new window and hands `http:` and `https:` addresses to `shell.openExternal`; `will-navigate` does the same for any address outside the dashboard's origin.
  An empty `window.open`, which a browser tab opens before it knows the address, returns `null`, so the MCP sign-ins in `web/use-sign-in.ts` then open the address themselves once the server names it.
- The page runs with context isolation and the sandbox on, and gets no Node or Electron API.
  Its preload, `desktop/preload.ts`, hands it only `window.ompDesktop`, the `DesktopBridge` of `src/shared/desktop-bridge.ts`, whose `badge`, `alert`, and `ownsClose` send one IPC message each; see [Session notifications](#session-notifications).
  The main process takes each one only from the window's own dashboard frame.
- The app keeps its data, its cookie, localStorage, window bounds, and single-instance lock, in `port-<port>` under Electron's `userData`, so a smoke run on another port is an instance of its own beside your app.
- A main-frame load of the dashboard that fails (`did-fail-load`), for example after the server the window used stopped, shows the shell's error page with **Retry** instead of Chromium's.
- The packaged app, launched by Finder or at login, gets no shell environment, so `desktop/shell-env.ts` runs the login shell (`$SHELL -ilc`) once at startup and merges its environment into `process.env` before the server starts; omp, `gh`, and `git` are then found as in a terminal.
- **Open at Login** is the packaged app's own login item (`setLoginItemSettings`); a checkout has none, and the app removes the LaunchAgents that `bun run desktop` once wrote.
- `desktop/updates.ts` updates the packaged app through electron-updater from GitHub Releases: a check 15 seconds after launch and then every 30 minutes, a download in the background, a notification, and **Restart to Install** in the app menu, which stops the server first; an update left waiting installs when the app quits.
  Squirrel.Mac installs only an update signed by the same Developer ID as the running app, so ad hoc builds check and download but never install.

### Packaging and releases

`scripts/build-desktop-artifact.ts`, modeled on T3 Code's script of the same name, builds `desktop/dist/resources` (the server bundled into `server.js` with Tailwind left out, the page prebuilt by `buildPage`, and the starter kit with its installer bundled into `install.js`), downloads the Bun of the build's own version for each architecture into `desktop/dist/bun-<arch>`, and runs electron-builder with a config it generates, which writes a DMG, a zip, their blockmaps, and `latest-mac.yml` to `desktop/release`.
It signs and notarizes when `CSC_LINK` and the `APPLE_API_KEY*` variables are set, with the hardened runtime and `desktop/entitlements.mac.plist`, which lets Bun JIT; otherwise it signs ad hoc.
`--mock-update-port <port>` points the update feed at `scripts/mock-update-server.ts`, which serves `desktop/release`, to try an update without publishing.
`.github/workflows/release.yml` runs on every push to `main`, one run at a time with a newer push cancelling an older run: it sets `desktop/package.json`'s patch version to the run number, keeping its major and minor, then runs the checks, one build for arm64 and x64 on an Apple silicon runner, and a GitHub Release tagged `vX.Y.Z` with every artifact.

## Terminal panel

The panel's shells run on the server, in pseudo-terminals from Bun's `terminal` spawn option, so the dashboard needs no native module.
`src/terminals.ts` owns them: `Terminals.open` starts `$SHELL -l` (else `/bin/sh -l`) in a directory with `TERM=xterm-256color`, without the server's `PORT` and `OMP_AGENTS_PARENT`, and a shell lives until it exits, its tab hangs up on it, or the server's shutdown calls `Terminals.dispose`.
At most `MAX_TERMINALS` (16) shells run at once; `Terminals.open` refuses another until one exits, so a page cannot fork shells without bound.
Each shell keeps its last megabyte of output in `Scrollback`, which drops whole chunks from the front, and replays it to every socket that attaches, so a reloaded page shows what the shell printed.

- `GET /api/terminals` answers the running shells as `TerminalInfo[]`, `{ id, cwd, cwdDisplay }`, from which a reloaded page reopens its tabs.
- Each tab opens its own socket, `/ws/terminal?cwd=<dir>&cols=<n>&rows=<n>` for a new shell or `/ws/terminal?id=<id>` to attach to one; `terminalSocketPath` in `src/shared/terminals.ts` builds both.
  `parseTerminalQuery` in `src/server/wire.ts` checks the query, holding the size to 1–1000; `terminalFor` in `src/server/terminal-socket.ts` resolves `cwd` through `directoryOf` and answers 404 for one that is no directory, such as a removed worktree, 404 for an unknown `id`, and 429 past the cap, all before any shell starts.
  A reloaded page reattaches to its shells by `id`, which starts none.
  The upgrade passes the same guards as `/ws`, and a shell opened for an upgrade that fails is killed.
- Binary frames carry the shell's bytes both ways.
  Text frames carry JSON control messages: the server sends `TerminalServerMsg`, `opened` with the `TerminalInfo` once and `exit` with the shell's code, then closes the socket; the page sends `TerminalClientMsg`, `resize` or `kill`, which `parseTerminalMsg` checks.
  The page shows **Starting shell…** until `opened` and a close spinner until the socket closes.
  Closing the socket detaches without ending the shell, so closing a tab, even one still starting, sends `kill`, which the page's `terminalSender` holds until the socket opens, and the tab stays until the socket closes.
- `src/server.ts` serves both socket kinds from one `Bun.serve`, its data typed as the union of `SocketData` and `TerminalSocketData`, and `isTerminalSocket` routes each handler to `src/server/terminal-socket.ts` or the `Dashboard`'s session socket.

## Plan quota

Plan quota comes from `omp usage --json`, run through this same package's CLI.
omp builds those reports from its auth storage, extensions, and credential broker, so the server reads the command's output instead of rebuilding that setup.
omp can exit non-zero after it prints the reports it did get, so the server reads the output whatever the exit code.
When the output is not a usage report, the footer shows the last line omp wrote to stderr.
`UsagePoll` in `src/server/usage-poll.ts` runs it every minute while a socket listens, as `Dashboard` lists the registry, and when a socket opens unless the run and the plan notice check after it both succeeded since the last tick that found none, so no page means no `omp usage` runs.
A continue that a usage limit schedules ([Scheduled sends](#scheduled-sends)) runs it at once whatever the listeners, for fresh reset times, without the plan notice check and without marking it done, so the next page to open still checks; one run under way serves every caller.
`parsePlanUsage` keeps each limit's omp id and whether omp reports it `exhausted`, which, when omp gives no status, means nothing is left; a window omp lets run past its limit, as Codex's does, is not used up.
It keeps a report's `resetCredits` as omp's `availableCount`, which counts banked credits whether or not one can be redeemed now, and the soonest expiry among the credits omp counts, those neither `expired` nor `redeemed` with some left, or `null` when it is 0.
A limit in `usd` without a window, such as omp's `anthropic:extra` when Claude extra usage is on, becomes the plan's `extra`: the dollars spent, the monthly cap or `null`, and whether it is used up; a plan with only extra usage still counts.
A window omp meters in `usd`, such as Cursor's `Other Models`, also keeps its dollars as `usd`.
omp reports no dollars for a Codex account's credit balance, so a Codex plan never has `extra`.

## Analytics

omp-stats owns omp's request history in `~/.omp/stats.db`, under omp's config root.
`src/omp/stats.ts` starts `statsLive()` on its first read, which the provider check (see [Notifications](#notifications)) makes at startup; it syncs every session transcript, watches for changes, and resyncs every five minutes until the server stops it on shutdown.
The dashboard calls omp-stats' rollup-aware total, model, agent-type, and tool reads from the selected range's cutoff, then groups request rows by session file for the top sessions.
omp-stats' `getTimeRangeConfig` gives each range's cutoff and bucket, except `today`, which starts at the server's local midnight with hourly buckets.
`Dashboard` owns a `ForeignUsage` index in `src/foreign/usage.ts`, which refreshes Claude Code's and Codex's transcripts on each Analytics read.
Each format names its usage files, including subagents, and folds each file through `FoldedFile`, reading only appended complete lines and restarting after truncation.
Claude Code requests come from assistant records with a real model and usage.
Repeated `message.id` records count once, with the last record's usage, because content blocks repeat the request while its output grows.
Synthetic replies and `cost-state` bookkeeping do not count.
Codex requests use `token_usage_record.payload.usage` once per `response_id`, with the latest preceding model from `turn_context` or `thread_settings_applied`.
The reader assumes an ordinary response record precedes its next valid `token_count` summary, with unrelated non-usage records allowed between them.
That summary consumes the pending record and advances the event cumulative total, but adds no request when its input, cached input, output, and per-request total match the record.
An unchanged cumulative summary also consumes the pending record, so a record-only compaction still counts and cannot suppress a later event-only request.
Duplicate response ids neither count again nor re-arm a consumed pair, and equal token values alone never deduplicate separate response records or growing event-only summaries.
Unpaired `event_msg` records with `payload.type: "token_count"` and non-null `info` count when `total_token_usage.total_tokens` grows, using `last_token_usage`.
The response records' `thread_token_usage` and the events' cumulative usage can start at different points and are never compared.
Codex input excludes cached and cache-written input, which count in their own buckets, and output already includes reasoning.
Claude Code subagent files count toward the session directory that holds them.
Codex subagents count toward `thread_spawn.parent_thread_id`, else the first session metadata's `parent_thread_id`, including guardian reviewers.
A Codex subagent without either parent id counts toward its own unlisted session.
`withForeignUsage` in `src/analytics.ts` filters requests by the same cutoff and adds them to `StatsRead` totals, models, agents, per-session rows, and provider buckets.
Foreign rows carry their session id and subagent flag rather than using omp's filename convention.
Listed sessions take their title and working directory from the existing saved-session index and can open their read-only transcripts.
Cache rates are recomputed after merging, and model output rates remain omp's measurement or `null` for foreign-only models.
Tool statistics remain omp-only.
`src/analytics.ts` folds nested subagent and advisor files into their top-level session, assigns the session's working directory from the saved-session index, and orders models, workspaces, and sessions by token usage.
`src/omp/stats.ts` reads time buckets by recorded provider through omp-stats' rollup-aware `getProviderTimeSeries`, using the same source as the totals cards.
`src/analytics.ts` derives chart totals and provider totals from those rows, fills missing buckets with zeros, and starts all time at the first request.
`web/components/settings/provider-trend.tsx` renders Recharts stacked bars, bucket details, and an optional data table from that provider breakdown.
The page and an Analytics API read with no range default to `24h`.
`analyticsStore` in `web/reads.ts` uses `createPolledStore` to keep each range's last successful answer in memory and localStorage, discarding incompatible saved shapes.
Polled stores opt into persistence with one `cache: { key, decode }` configuration, and omitting `cache` keeps reads only in memory.
When the page loads, `decode` turns each kept read back into the store's answer, or answers `null` for a record that lacks any field of that answer, which the store drops and reads again; each store's decoder sits beside its answer's type in `src/shared/`.
`AnalyticsTab` shows that answer while refreshing on activation or a range change, and every two seconds during indexing or 30 seconds otherwise while active.
A failed refresh keeps the last successful answer and reports its error without replacing another range's data.
The displayed cost is omp's API-equivalent list price, not the user's subscription bill.
Foreign requests use omp's bundled `pi-catalog` model prices at each request's timestamp, including long-context tiers and Claude's five-minute and one-hour cache writes.
An unknown model costs zero but still counts requests and tokens.

### Context sources

`src/omp/context-index.ts` keeps its own index, `context-sources.db` beside `stats.db`, and never writes omp-stats' database.
A sync walks omp's sessions directory and re-reads only the files whose size or modification time changed; a file it cannot read is recorded with no requests until it changes.
For each request, the assistant entry or `model_usage` entry whose usage carries input, `attributeTurns` in `src/context-sources.ts` splits the input, cache reads and writes included, by source.
It rebuilds the request's context with omp's `buildSessionContext` from the entry's parent, counts each message with omp's `Tokenizer` for the request's model, and credits it by role: a tool result to its tool, a `skill-prompt` custom message to its skill, a rule reminder to its rule, other custom messages and reminders to injections, and the rest to the conversation.
A subagent's `session_init` records its system prompt, which `splitSystemPrompt` splits into `<file path>` blocks, the skills and rules its lists name, each MCP server's tool routes, devices, and instructions, and the remaining `§` sections.
A main session's file records only a digest of its system prompt, so the request's input left after its measured messages is credited to the system prompt and tool definitions together; a subagent's residual is its tool definitions.
Measured tokens above the billed input scale down to it, so a request's sources always add up to its input, and a `model_usage` side request is one source named by its purpose.
A fork copies its parent's entries; omp-stats counts each copied request once, for the parent, so `attributeTurns` skips a fork's requests older than its header.
The index stores one row per request and one per request and source, by integer file and source ids, so `read(cutoff)` sums exactly the requests at or after the range's cutoff, which `windowOf` in `src/omp/stats.ts` gives as for usage.
`buildContextReport` folds subagent files into their session, takes the working directory from the saved-session index or the session's own file, and narrows the sums to the chosen workspace or session.
Each request with a report starts a background sync unless one ran in the last 15 seconds; the answer carries its progress, and `ContextSources` in `web/components/settings/context-sources.tsx` reads every two seconds while it runs and every 30 seconds otherwise.
A report's totals match omp-stats' input tokens for the same files, cache reads and writes included, apart from requests either side has not synced yet.

## Routines

A routine starts dashboard sessions, or runs a shell command, on one or more schedules. A schedule is every so many minutes, counted from the last run, or a local time on chosen weekdays, so 9:00 stays 9:00 across DST. The routine is due at the earliest of them. Two intervals share that last run, so the shorter one decides.
Its task is one prompt, one command, or one `project` task, `{ projectId, prompt }`, which takes no session slot: the run hands the prompt to the project runner's `notify` as an `event` from **Routine** and ends with outcome `project`, or with the error when the project is gone or archived.
The prompt ends with `UNATTENDED`, which tells the session not to ask questions.

`src/server/routines-file.ts` keeps the routines in `routines.json` beside the access token, and saves every change at once.
A file from before `schedules` reads its `schedule` as a one-element list, and drops a routine whose task was pull requests.
A prompt task from before `pin` reads as unpinned.
The rest of the file stays.
The next save writes `schedules` and `pin`.
A file that is not a list of routines still moves aside.
`parseRoutineSpec` in `src/routines.ts` checks each routine's fields both for the file and for the socket's `routine` save, so the two hold the same limits.
Each routine holds its last 10 runs, newest first.
A run holds its slot time, its errors, and one `outcome`: `pending` from its claim, with whether it is still `queued`; a `session` with the instance and session ids it started; or a `command` with the command's result once it ran.
A run from before `outcome` migrates as the file loads, in `parseRun`, and nothing else sees the old fields: its `command` becomes a `command` outcome, a started session a `session` (the first, of the several that a pull request routine's run started), and otherwise `pending`, queued when its `queued` is set or its `queue` list holds an entry.
A run stays queued from its claim until the drain starts its session or command.

`src/server/routine-runner.ts` runs on a 60 s tick in `src/server/loops.ts`, whether or not a page is connected, and only on the server that owns routines; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Ticks and **Run now** claims share one `SerialLane`: a tick that finds the lane busy is skipped, and a **Run now** waits its turn.
Each tick does three things, in order:

1. It claims each due slot: it saves a new queued run before it starts anything.
   Slots missed while the dashboard was closed or the Mac slept coalesce into one run at the next tick.
2. It starts the queued runs, oldest first, while fewer than 3 routine sessions are busy; a command takes no session slot, so a command run starts even when they are all busy.
   It starts each prompt session through the same `start` the page uses.
   A failed start goes to the run's errors, and the next run tries again.
   A prompt routine whose last session still runs records an error instead of starting a second one.
   A command starts through the runner's `exec`, `runShell` in `src/proc.ts`, and the drain does not wait for it, so a tick never blocks for minutes.
   `runShell` runs `/bin/sh -c` in the workspace with stderr merged into stdout, keeps the last 64 KB of output, and stops the command after 10 minutes.
   It spawns the shell in its own process group and stops the whole group with SIGTERM, since a command's own children would otherwise keep running and hold the output pipe open.
   When the command ends, the runner writes its exit code, output, and times to the run; a non-zero exit, a stop, or a failed spawn also goes to the run's errors.
   The runner keeps the routines whose command runs in memory, since a run holds one outcome and later `run-now` claims can push a running command's run out of the saved 10; a command routine whose last command still runs records an error instead of running a second one.
3. It retires finished sessions: once a session that worked is idle, the runner ends it.
   When the routine's prompt task sets `pin`, the runner first unpins the sessions of the routine's other runs and pins this one through `changePins`, then ends it, so its row moves from **Running** to **Pinned** without passing through **Past**; other pins stay.
   A session ended at the start deadline, or one that is gone, is not pinned.
   A session counts as working from the first time its row shows it working or waiting on a question, at its start, at a tick, or at any change of its row, which the server passes to `observe`.
   `observe` also ends a session as soon as its row shows the turn over, so a finished session frees its slot at once rather than at the next tick.
   Its transcript stays a past session, and **Resume** continues it.
   A session that waits on a question holds its slot.
   A session that is still in its `starting` phase 10 minutes after its start (`SESSION_START_DEADLINE_MS`) never began its turn: the runner records that on the run as an error, releases the slot, and ends the session.

Running a tick twice starts nothing new, since the slot is claimed, and a tick that comes while one runs is skipped.
A crash after a claim loses no queued run, since it is on disk. A start that had not finished waits for the routine's next slot.
A routine's session survives a restart, and `RoutineRunner.recover` tracks it again from the run that started it, once the server attached to the surviving sessions, so it keeps its slot and ends, pinned when its routine asks, once idle.
It counts as working, since its turn may have ended while no server watched; one that never began its turn therefore ends at once, without the start deadline's error.
A run whose session did not survive keeps its `session` outcome, and the session no longer holds a slot.
On a takeover the runner tracks only the sessions this server attached to, since a server attaches only to the sessions started on its own port.
Stopping the server stops every running command, right before it exits, so the result of a command it stopped is never saved as a time-limit stop.
A run saves its command as `running` before the command starts, then as `exited`, `stopped`, or `failed` when it ends.
No command resumes after a restart: the server that owns routines turns each run still saved as `running` into `stopped` by the dashboard, with that error, when it starts or takes over (`RoutineRunner.recover`).

A `routine` socket message carries one change: `save`, `remove`, `enable`, or `run-now`, which claims a slot now, whatever the schedules, and drains it.
Every socket hears the routines after each change and each step of a run as a `routines` message on the roster topic, also sent when a socket opens.

### One server runs the unattended work

Servers on different ports share `~/.config/omp-agents`: your app and a smoke run, say.
Routines, the todo inbox, the daily clean-up of checked todos, and the daily sweep of omp's isolation sandboxes write that directory or omp's without anyone asking, so one server at a time runs them.
`src/server/owner-lock.ts` decides which, with `server.lock`, a file that holds `{pid, port}` of the owner.
A server creates it whole through a draft file and a hard link, so a reader never sees half of it, and it takes over a lock whose process is gone or whose content is not a lock.
A process id that another program reused keeps the lock held; delete `server.lock` to release it.
At startup a server that does not own the lock logs once which port does, and the minute tick tries again.
On a takeover the server logs it, reads `routines.json`, `todos.json`, and `projects.json` again, since the previous owner kept saving them, tracks the routine sessions it attached to, fails the runs that were running a command and the scheduled sends left sending, and drains the todo inbox.
A server that exits normally deletes its lock.
The servers that do not own it still serve their pages, start sessions, and take what you do in them, such as editing a routine, a todo, or **Run now**; only the minute tick's routines, scheduled sends, and isolation sweep, the todo inbox, and the end inbox's requests for sessions started in a terminal are left to the owner.
Each server keeps its own copy of `routines.json` and `todos.json` in memory and saves whole, so the last server you edited in wins until the owner changes.
`projects.json` is the exception: every server runs its own project runner, which writes on every worker turn, so `ProjectsFile` is a `shared` `ReducerFile`, which reads the file again before it applies a change, and a change made on one server keeps what another saved.
`ScheduledFile` is shared the same way, so a send added on any server reaches the owner.

### Isolation sandboxes

omp runs a subagent's isolated task in a sandbox under `~/.omp/wt` (`getWorktreesDir`, which `OMP_WORKTREE_DIR` moves): a directory named after the repository and the task, which holds the owner marker `.omp-isolation-owner.json`, naming the omp process and its start time, and the checkout `m`, `merged` in older sandboxes, a full copy of the repository with its own `.git`.
omp removes a sandbox when its task ends, but one whose omp exited first stays, often gigabytes, and `omp worktree clear` removes those without looking at their changes.
`IsolationSweep` in `src/server/isolation-sweep.ts` removes them more carefully, once a day: the owner's minute tick starts a sweep when none ran for 24 hours, the first one a minute after the server starts or takes over, and does not wait for it, since it runs `git status` in every sandbox, four at a time.
A directory without the marker, such as a pull request's checkout, is no sandbox, and the sweep leaves it alone.
A sandbox stays while omp's `hasLiveIsolationOwner` says its process runs: a process id that is gone, or that another process now holds with a different start time, has exited.
It stays while a live session, idle or waiting ones included, or the server runs in it, by `Worktrees.inUse`; while its checkout has a tracked change or an untracked file, by `git status --porcelain --untracked-files=all`; and while its checkout is a linked worktree that Git locked.
It also stays when the sweep cannot read it: a marker that names no process, a checkout that is not a Git checkout of its own, or a git call that fails, such as a `git status` that takes over two minutes.
Commits that no remote has do not keep a sandbox, since the copy carries every local branch of the repository it copies, so nearly every sandbox has some, and the repository the task ran from keeps those branches.
A commit the task itself made, which its omp exited before bringing back, goes with the sandbox, as with `omp worktree clear`.
A sandbox with the marker but no checkout, left by an omp that exited while it made one, holds nothing of a task and goes.
Just before it removes one, the sweep asks again whether an omp owns it, since a task run again takes the same directory; then it stops a retained native mount through omp's `stopRetainedMount`, renames the sandbox with the suffix `.omp-agents-removing`, and deletes it, so the next sweep finishes a removal cut short instead of reading half a sandbox.
A mount that will not stop keeps its sandbox.
Each sweep logs one line with how many sandboxes it removed and kept, by reason, and one more for each it could not read or remove.

## Scheduled sends

A scheduled send is one message to a session, or one new session's start, that waits for a time; see [Send later](usage.md#send-later) for what the user sees.
`src/shared/scheduled.ts` holds its shapes, `ScheduledSend`, `ScheduledTarget`, and `ScheduledChange`, and the rules the server applies, `applyScheduled` and `isDueSend`.
A target is `{ kind: "message", sessionId, text }`, `{ kind: "start", request }`, where `request` is the `NewSessionRequest` that the new-session draft's **Start session** would send, without images, or `{ kind: "continue", sessionId, provider, reply }`, which only the server schedules, below.
The page resolves a plan window's reset to a time before it sends the change: `at` is the window's `resetsAt` plus `RESET_MARGIN_MS`, one minute, and `reset` only names the window for the lists.
So a send never moves when `omp usage` later reports another reset time.

`src/server/scheduled-file.ts` keeps the sends in `scheduled.json` beside the access token, as `{ sends }`, soonest first, and moves a file that holds anything else to `scheduled.json.invalid`.
A send's `state` is `waiting`, `sending` from its claim until it reaches omp, or `failed` with the error and its time; a send that reaches omp leaves the file.

`src/server/scheduled-runner.ts` sends them.
Its `tick` runs on the minute tick, before the routine runner's, only on the server that owns the unattended work, and sends each due waiting send in turn.
`sendNow` sends one at once on whichever server the page talks to, a failed one too.
Either way the runner first claims the send and writes `sending` to the file at once, so a second tick or another server never sends it twice.
A message goes through `reach`, which `Dashboard` builds once for this runner and the project runner: the live session with that session id, else that session resumed through the same `start` the page uses.
The runner sends it through its `prompt` as a `followUp`, a follow-up while its turn runs and a prompt otherwise, as a project's updates go.
A start goes through `start` as the page's would, so the todo it names is linked the same way.
A failure, such as a session that cannot resume or a start that fails, saves the error on the send, which waits for **Try again** or **Dismiss**.
A send that a stopped server left `sending` may have reached its session, so the owner fails it at its start or takeover (`ScheduledRunner.recover`) rather than sending it again.

A `schedule` socket message carries one `ScheduledChange`: `add`, whose `id` the page picks so an add sent twice adds once, `remove`, which cancels a waiting send or dismisses a failed one and leaves one under way, `take`, `update`, or `send-now`, which answers once the send went or failed.
`update` is the scheduled-session page's save: it replaces a waiting or failed send's time and target in place, keeps its `createdAt`, sets it waiting again, and, like `take`, refuses one under way or gone, so the page never believes an edit saved.
`take` is **Edit**'s: it takes a waiting or failed send off the schedule and writes the file at once, as a claim does, so the server that sends reads it gone.
`applyScheduled` throws for a `take` of a send that is gone or under way, which may already have reached its session; the request's `done` carries that error, and the page puts the text back in the composer only after a `done` without one.
`parseScheduledSpec` in `src/shared/scheduled.ts`, which `parseScheduledChange` in `src/server/wire.ts` and `src/server/scheduled-file.ts` share, holds a message's text and a start's prompt to `MAX_SCHEDULED_TEXT`, a million characters, and refuses images, an empty text, and a start that resumes.
Every socket hears the sends after each change and each claim, send, or failure as a `scheduled` message on the roster topic, also sent when a socket opens; a change that changes nothing sends them back to its own socket alone.
Each server also reads the file and sends the list on its minute tick, so pages on a server that does not send see what the owner did.
A send is at most a minute late, and one whose time passed while no server ran goes at the first tick after one starts.
A message whose session runs live on a server that does not own the unattended work goes to a resumed copy on the owner, since each server reaches only the dashboard sessions it started.

`src/server/auto-continue.ts` schedules a `{ kind: "continue", sessionId, provider, reply }` send when a dashboard session's `turn-ended` carries a usage limit ([Dashboard sessions](#dashboard-sessions)), `reply` being that turn's last reply; the runner delivers it as the message `continue`.
`continueWhen` picks its time after reading `omp usage` again, once a run already under way, which may have started before the limit, finished: when every one of the provider's accounts has a used-up window, the latest reset among each account's used-up windows, then the soonest account, since omp moves to any account that serves, plus `RESET_MARGIN_MS`, with `reset` naming the window as the **Send later** menu does.
Otherwise, an account with nothing used up being one that could serve now, it waits the error's own retry hint plus the margin, with `reset` `<provider> limit`, and with neither one hour, `UNKNOWN_RESET_WAIT_MS`, with `reset` `null`, which the page words as an unknown reset; a failed `omp usage` run counts as no window.
`applyScheduled` takes the server's `ContinueChange`s: `continue` replaces the waiting or failed continue of its session, and `drop-continue` drops it; both leave one under way, which may already have reached the session.
The socket's `schedule` parser refuses a page's `add` or `update` of a continue, while `scheduled.json` keeps them.
`AutoContinue.cancel` runs on the session's `turn-started`, which `DashboardSession` emits at each main-agent `agent_start` whoever prompted: the page, a project's update or `message_worker`, or a scheduled message.
The continue's own turn does not cancel it, since the runner claimed it first and `drop-continue` leaves one under way.
An `edit-prompt` cancels the old session id's continue, since the edited turn starts under the new id, and ending the session through `Dashboard`'s `#endLive` cancels it too.
A cancel that arrives while the usage read runs keeps the continue from being scheduled.

`AutoContinue.held` reads the hold from the schedule: a session is held while `scheduled.json` has a continue for it that waits or is under way, or while its limit's usage read runs, the one part kept in memory.
A continue that failed never goes on its own, so it holds nothing: the runner's failure reaches `sendsChanged` like any change, which releases the session, while the row stays for **Try again** or **Dismiss**.
So a session the server attached to after a restart is still held while its continue waits.
The routine and project runners and the cleanup after a merge read a session's real `status` and its `occupied`: a turn runs or waits on a question (`occupiedBy` in `src/server/project-runner.ts`), or `AutoContinue` holds it.
An occupied session is not ended by a routine or by the cleanup after a merge, which tries it again at its next look; it takes a project worker slot and gets no project updates; the bell's project notices keep the real worker phase, and an occupied worker or coordinator keeps "all done" off and an occupied coordinator keeps worker questions out.
The page reads the roster, so a held session shows idle; the project runner hears of the held turn, with the `reply` its continue saved, only when the hold ends with the session idle.
`AutoContinue.sendsChanged` compares the held sessions with those it last saw, starting from the file as the server starts, and releases each that is no longer held.
Every change to the sends goes through `Dashboard`'s `#publishScheduled`, which tells every socket and calls `sendsChanged`: the page's edits, through the list registry's push, the runner's claims, sends, and failures, `AutoContinue`'s own continues and cancels, and the minute tick's read of the file, which brings in what another server did.

## Projects

A project is a coordinator session that plans the work and starts worker sessions, which all share one notes directory, and the user's notes, which every project shares; see [Projects](usage.md#projects) for what the user sees.
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
The cleanup after a merge, not the watch, ends the workers a merge leaves with nothing to do (see [Merges, and the cleanup after one](#merges-and-the-cleanup-after-one)), while their project watches its pull requests.
It ends each through the runner's `endFinished`, which refuses a worker gone, ends it as `end_worker` does, waits until the session and its worktree are gone, then saves an `event` that names the worker it ended.

The runner saves each update in `projects.json` at once and then delivers; an archived project's updates wait until `unarchive`, whose apply calls the runner's `settle`.
When the coordinator's session runs and its status is `idle`, the runner sends every waiting update, in order, as one prompt that `updateText` builds, starting `[omp-agents] Project update.`, quoting at most `REPLY_QUOTE_CHARS` (2,000) of each finished worker's `lastReply`, and naming each `asked` question's request id for `answer_worker`.
Its `[omp-agents]` prefix keeps it out of what the page shows as the user's own ([Transcripts](#transcripts)).
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

On a takeover, the server reads `projects.json` again, since the previous owner kept saving it; see [One server runs the unattended work](#one-server-runs-the-unattended-work).
Each server's runner follows only the sessions that server started.

## Pins

The sidebar's pins are a list of session ids that the server keeps, so the routine runner can pin with no page open and every window agrees.
`src/server/pins-file.ts` keeps them in `pins.json` beside the access token, as `{ sessions }`, and moves a file that holds anything else to `pins.json.invalid`.
A `pin` socket message carries a `PinChange`, `{ op, sessionIds }` with `op` one of `pin` and `unpin`, checked in `src/server/wire.ts`.
`applyPins` in `src/shared/pins.ts` applies it, and never toggles, so the same change sent twice pins or unpins once.
Every socket hears the pins after each change as a `pins` message on the roster topic, also sent when a socket opens; a change that changes nothing sends the pins back to its own socket alone.
The page shows a change before the server answers, and its **Pin** and **Unpin** send `pin` or `unpin` from the pins it holds.
Pins an older page kept in the browser's localStorage, under `omp-agents.pinned-sessions`, go to the server as one `pin` the first time the page hears the pins, and the key is then removed.
Each server keeps its own copy in memory, as with the workspaces, so a routine's pin shows at once on the pages of the server that owns routines.

## Notifications

`src/server/notices.ts` owns the bell's notices: what the last checks found, the status of each update a page started, and which notices the user saw, read, or cleared, which it keeps in `notices.json` beside the access token.
Each kind has its own check, and `src/server/loops.ts` runs five of them.
The update check (`UPDATE_KINDS`) runs at startup and every six hours, whether or not a page is connected, and again after each update that succeeds.
The activity check (`ACTIVITY_KINDS`) runs every two minutes while a socket listens, and when a socket opens unless it ran since the last tick that found none.
The provider check (`PROVIDER_KINDS`) runs after each `omp usage` run of the usage tick, every minute while a socket listens, and when a socket opens unless it succeeded since the last tick that found none; a continue's own run skips it ([Plan quota](#plan-quota)).
The event check (`EVENT_KINDS`) runs on the minute tick, whether or not a page is connected.
The dashboard check (`DASHBOARD_KINDS`) runs at startup and every five minutes, whether or not a page is connected: `SelfUpdate.newCommits` fetches the branch the server runs from origin and counts the commits past the running one.

- `latestOmp` in `src/omp/release.ts` asks `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts` for the newest release on omp's `update.channel`, unless `startup.checkUpdate` is off.
  `installedOmp` reads the version from the installed package's `package.json` on each check, so the check is right after an update, before a restart.
- `findModelUpdates` in `src/omp/model-updates.ts` reads the global `modelRoles` and `retry.fallbackChains` entries with `resolveSelector`, and keeps the listed models that `classifyModel` in `pi-catalog/src/identity/index.ts` places in an Anthropic or OpenAI family with a revision.
  A model's line is its provider, its family, and its id with the version masked, so `claude-opus-5-5` and `claude-opus-5-6` share one.
  It offers the newest revision of each line that a connected provider lists, and leaves dated snapshots out.
- The pull requests come from `loadPullRequests` in `src/pull-requests.ts` over the known workspaces that still exist, through the pull request list's 30-second cache, so the page's polls and the check share one query.
  `moveOf` in `src/shared/moves.ts` picks each one's move, with `agentOn` over the roster, and a move in `YOUR_MOVES` is a notice.
- `waitingOnYou` in `src/slack-messages.ts` calls Slack's Web API with omp's Slack MCP sign-in through `integrationFetch("slack")`, since the MCP server's search answers in Markdown and Slack's `search.messages` needs a scope the sign-in lacks.
  `auth.test` names the user, and two `assistant.search.context` searches over the last three days, newest first, read the direct and group messages (`im,mpim`) and the channel messages that mention them (`<@ID>`), each up to five pages of 20 through `next_cursor`.
  A conversation gives one notice for the messages after the user's last one there; the user's own messages, bots, Slack's system messages, and empty ones count for nothing.
  `slackText` turns Slack's markup into plain text.
  `users.info` gives each author's 72-pixel profile picture as the notice's `avatarUrl`, which the page's `img-src` allows from `avatars.slack-edge.com`, `secure.gravatar.com`, and `a.slack-edge.com`; a lookup that fails leaves it `null`, and the page shows the initial.
  Without a Slack sign-in, which `integrationSignedIn("slack")` reads, the check finds nothing.
- The plan notices come from the plans of the last `omp usage` run, which `Broadcasts.refreshUsage` answers with, one per window whose `exhausted` is set; when that run failed, the check fails too and keeps its notices.
- `readCreditRuns` in `src/omp/stats.ts` reads the last day's requests, in order, of each provider that had an error naming `402` then, aborted requests left out.
  `creditRuns` starts a run at a failure whose error names `402` and that `is402BillingCapBody` reads as a billing cap, counts each such failure after it, and ends it at the provider's next request that worked; another error neither starts nor ends a run.
  A provider with a run open is a notice.
- The events come from `LocalEventsFile` and, for each signed-in Google Calendar account, `GoogleCalendars.byAccount` over the next ten minutes (`EVENT_LEAD_MS`), each timed event a notice from that lead before its start until its end, dated at that lead.
  Google's events, one scope per account, and the local ones are separate scopes: an account whose read fails keeps its notices as they were while the other accounts' change, and the Calendar page shows why.

A check that fails keeps what the last one found for its kind, and the marks for it, and logs each distinct error once.
A repository GitHub did not answer for keeps its pull requests' notices the same way.
A notice whose update runs or ran stays after a check stops finding it, so the page shows how the update ended.
A notice's id names what it is about, so it is a new notice when that changes, even after the user cleared the last one: `omp:<latest>`, `model:<provider>/<from>><to>`, `dashboard:<running commit>`, `pull-request:<owner>/<repo>#<number>:<move>`, `slack:<channel>:<ts>` of the newest message, `plan:<provider>/<account>:<limit id>`, `credits:<provider>`, or `event:local/<id>:<start>` and `event:google/<account>/<calendar id>/<event id>:<start>`, so a moved event is news again.
The dashboard notice names the running commit rather than origin's, so new commits raise its count instead of toasting again, and only a restart onto another commit makes a new one.
A plan notice's id leaves out the reset time, which a provider may report a little differently on each run, and a credits notice's leaves out its first failure, which moves once that failure is older than the day the check reads; the window's reset or a request that works ends the notice, and the next time it comes after its marks lapse is news.
A Slack notice dates from its message, and a credits notice from the first failure the check reads.
A pull request notice dates from the check that found it, since the pull request's last update on GitHub may predate the move, except on its repository's first answer since startup, which dates each from that update, so a workspace found later or a repository GitHub answers again does not bring old pull requests as news.
The marks of a notice the checks stop finding last ten minutes, so a pull request whose checks run again, which leaves **Ready to merge** for a moment, keeps its marks, and one that comes back later is news again.
Each notice carries its scope when its check finds it, its kind, a pull request's `owner/repo`, or `event:local` or `event:google`, and a check answers for the scopes it looked at, never by reading ids back.
`notices.json` keeps each marked notice's scope under `scopes`, so a restarted server forgets the marks of a notice that is gone from an answered scope; a mark from a file without `scopes` stays until its notice is found again.

A `notice` socket message carries `{ ids, op }`, with `op` one of `update`, `seen`, `read`, and `clear`.
`update` runs on update notices and marks them seen and read.
Every socket hears the list as a `notices` message on the roster topic after each change, also sent when a socket opens.
`update` on omp runs `omp update` through `ompCommand` and succeeds when omp exits 0 and the version on disk is at least the notice's release; otherwise it fails with omp's last line of output, such as Nix's.
The server keeps the omp modules it loaded until it restarts, and `src/omp/modules.ts` names any export the new release dropped at the next start.
`update` on a model calls `upgradeModel` in `src/settings.ts`, which turns `upgradeEdits` into routing edits and writes each with `writeRouting`, under the same lock as a Settings › Models save.
A role or chain entry keeps whatever follows the model in its selector, such as `:high` or `:auto`, and each chain that names the model is written whole.
`update` on omp-agents' own notice calls `SelfUpdate.update`, as [Updating the dashboard](#updating-the-dashboard) says, and fails with its refusal.
No check follows its success, unlike omp's and a model's: the server restarts and checks at startup, and a fetch run now would still hold `.git`'s lock when that check fetches.

### Session notifications

The Dock badge and the session notifications count on the roster: the server keeps whether each live session waits on you, and each page decides what to show of it.
A row's `status` of `needs-input` says that the session asks something, and its `unread` names the turn it ended since you last looked: when, and the first line of its last reply.
Both transports report the main agent's turn as a `TurnUpdate` from `turnUpdate` in `src/live-session.ts`: `turn-started` at `agent_start`, and `turn-ended` with its last reply and its usage limit at an `agent_end` that ends the run, not one that hands over to a queued follow-up.
The same `turn-started` cancels a continue the session waits on, and only a `turn-ended` with a limit from a session this server started schedules one ([Scheduled sends](#scheduled-sends)).
`Dashboard` applies each in `#onLiveUpdate` through `LiveSessions`, which keeps the unread turns privately by instance id in memory, adds them to each row in `rows()`, and drops one when its session leaves.
`turn-ended` sets the turn with `markUnread` and always pushes the roster; `turn-started` clears it with `markRead` and pushes the roster only when a turn was unread.
A page sends `{ t: "read", instanceId }` while a pane shows the session's main agent in a focused window, which `LiveSessions.markRead` clears for every page.

`useAttention` in `web/use-attention.ts`, over the pure rules in `web/attention.ts`, leaves out a project's workers, which answer to their coordinator, and counts the rest that need you for the desktop's badge.
Each session raises at most one alert at a time, for what it waits on: its oldest open question, else a wait with no question relayed, else its unread turn.
`attend` keeps an episode per live session: the first roster that shows a session hears its wait and raises nothing, so neither a page that loads nor a terminal session that joins after the socket's first roster raises what already waited.
A wait with no question raises only when it starts after the page saw the session not need you, and a question that follows it in the same wait is the question the host replays after a guest's welcome, so it raises nothing.
A question, by its request id, or an unread turn, by its time, that the page has not heard raises its alert while **Settings › Preferences › Notifications** is on, and stays heard while the session lives, so a question a reconnect replays raises none again.
An alert carries the hash that opens its session, `#session/<session id>`, from `hashForSession`, so the shell needs nothing of the roster's shapes.
In the desktop app the alert goes through the bridge to `desktop/attention.ts`, which shows an Electron `Notification` unless its window has focus, as `BrowserWindow.isFocused` tells, and, on its click, shows the window and sets the page's hash to the alert's; it holds each session's latest notification, closing the one before, since Electron drops a click of one nothing references.
In a browser it is a Web `Notification` tagged with the alert's hash, so a session's newer one replaces the one before, raised while the page does not have focus, once the browser granted the permission that turning the switch on asks for.

## Merges, and the cleanup after one

`MergeQueue` in `src/server/merge-queue.ts` carries out every merge the dashboard makes, at once when GitHub allows it and otherwise once it is ready, and stacks, bottom first.
It keeps them in `merges.json` beside the access token, and every socket hears them as a `merges` message on the roster topic, also sent when a socket opens.
A queued merge is a `QueuedMerge`: the method, the base every pull request lands in, which is the bottom one's base when it was queued, the pull requests still to merge, each pinned to a head commit, how many merged, `settling`, the last change the queue asked GitHub for that no read has shown yet, and its state, `waiting` or `failed`, with the reason.
Adding one reads each pull request, refuses one not open, one whose head moved past the commit the confirmation showed, and one already queued, and orders them bottom first with `stackOrder`, which refuses pull requests that are not one chain of base branches of one repository.
Only the server that holds the owner lock changes GitHub for a merge: it takes the first step of a merge it queued at once, so a pull request GitHub would merge now merges with the click, and every 15 seconds steps every merge still waiting, so it takes over one a server beside it queued.
Every server reads `merges.json` again on that tick and before each change it makes, so its sockets hear what the other saved and a cancel saved by one stops the other's next step.
Each step reads the first pull request of a merge through one `gh api graphql` call (`readMergeStatus` in `src/pull-request-merge.ts`) and takes the step `nextStep` decides, then the next until one waits, at most six a tick.
A retarget, a ready, an update, or an arm is saved as `settling` with its time, since GitHub may answer before a read shows it; while the read still asks for that change, for a minute, the merge waits instead of asking again, and a read that shows the change clears it.
The steps, in the order `nextStep` checks: a merged pull request moves on; a closed one stops the merge, and so does one whose head moved past its pin.
The one head change it takes is its own update of the branch: after `updatePullRequestBranch`, which answers before GitHub writes the commit, a head with exactly two parents, the first of them the pin, becomes the new pin; a commit pushed on top of the pin has one parent, so it stops the merge.
Then one based on another branch than the merge's base is retargeted onto it; a draft is marked ready; one that conflicts, or whose checks failed, stops it; one behind its base has its branch updated; one GitHub merges now (`mergesNow`) merges with `expectedHeadOid` its pin; else the repository's auto-merge is armed when it allows it, or the merge waits on checks, a review, or a rule.
A read that fails waits for the next tick, and a mutation GitHub refuses stops the merge with GitHub's reason.
Each merge of a pull request hands it to `MergeCleanup`; the next one of a stack is then under way, and a merge with none left leaves the list.
A cancel drops the merge and, on the server that took it, turns off an auto-merge it armed, since the cancel is the user's own change; when the cancel lands while the owner arms the auto-merge, the owner finds the merge gone and turns it off.
A stopped merge stays listed with its reason until it is cancelled.

`MergeCleanup` in `src/server/merge-cleanup.ts` ends what a merge leaves with nothing to do; it runs only on the server that holds the owner lock, which alone steps the queue.
`cleanupEnds` decides which live sessions it may end: only one that server started (`LiveSessions.started`), never a terminal session joined through Collab or one another dashboard owns; of those, a project's workers while their project watches its pull requests, whatever `cleanUp` says, never a coordinator, and every other one while Settings › Source control's `cleanUp` is on.
It hears each merge the queue made at once, and looks every two minutes, on the minute tick, at the live sessions' pull requests not yet merged or closed, through one `gh api graphql` call per repository (`readPullRequestStates`); the first look at a pull request only records it, and only a later look that sees it merged counts as a merge.
Merges and looks run one at a time on a `SerialLane`, and a pull request known merged or closed is never read again, so a look that read it open before the queue merged it cannot undo the merge, and the branch delete takes the head the queue merged.
Each merge marks the live sessions linked to it as finishing, and after every look the cleanup ends each finishing session that is idle and not occupied ([Scheduled sends](#scheduled-sends)), with every pull request it links known merged or closed.
So a session busy at the merge, or held for a usage limit's continue, ends once idle with the hold gone, one whose other pull request closes later ends then, and one whose end failed is tried again at the next look; a session that links the pull request only after it merged, such as one resumed later, is never marked.
It ends each through `endSession`, or through the project runner's `endFinished` for a worker; either removes its linked worktree through `Worktrees.removeCheckout`, which keeps it while any live session, a terminal one included, still uses it, or it has changes.
Its status was read before the checkout, so it reads the session again just before the end and refuses one that started a turn or was held meanwhile, which waits for the next look; either end rejects a session that is gone.
Then it deletes the local branch it worked on when that is the head branch of a merged pull request of the repository `origin` names in its checkout, through `Worktrees.deleteMergedBranch`: only when the branch's commit is the merged head or one it contains, fetched from `origin` when missing, as after the queue updated the branch on GitHub, through `git update-ref -d` with that commit as the old value, so a commit made meanwhile keeps it, and never a branch a worktree has checked out.

## Review drafts

A **Review** quick action's session writes its review into a draft the dashboard keeps, and the user posts it from the pull request's **Review draft** tab; see [Pull requests](usage.md#pull-requests) for what the user sees.
`src/shared/review-drafts.ts` holds the shapes and the rules both sides apply: `ReviewDraft`, one per pull request, with the `head` commit the session reviewed, a `verdict`, a `summary`, `findings`, `savedAt`, and `posted`, the review it became; `ReviewFinding`, `{ id, path, line, startLine, side, body, state, source }`, its `line` `null` for a finding on a whole file and its `state` `pending`, `accepted`, or `dismissed`, and its `source` `review` for the session's tool or `code` for the Code tab; and `Reviewer`, which pull request a session reviews.
`applyReviewDraft` reduces a `ReviewDraftChange` over `ReviewDraftState`, `{ drafts, reviewers }`: the page's `ReviewDraftEdit`s, which change a draft not yet posted, and the server's `save`, `posted`, `bind`, and `relink`.
A `save` replaces the pull request's draft, keeping only its `code` findings when the draft is unposted on the same head, renumbered after the saved ones, and drops drafts posted more than 14 days before it; `posted` marks a draft only while its head is the one posted and it is not posted yet; `bind` keeps the latest 200 reviewers.
`ReviewDraftsFile` in `src/server/review-drafts-file.ts` keeps that state in `review-drafts.json` beside the access token, `shared` so every server on this machine reads the others' writes, and every socket hears the drafts as a `review-drafts` message, also sent when a socket opens; the page edits them with a `review-draft` message, which `parseReviewDraftEdit` in `src/server/wire.ts` checks.
The Code tab's `add-finding` edit creates a local comment draft or appends a pending finding to an unposted draft on the same head, without calling GitHub; the reducer numbers it after the draft's highest `fN` id, so the page never picks an id.
One on a posted draft or a draft of another head throws, like a `take` of a scheduled send, so the page's request fails with why and it toasts that instead of a saved comment.
Every finding has a `side`, `LEFT` or `RIGHT`, and a `startLine`, the first line of a range or `null`; `ReviewDraftsFile` reads a finding saved before ranges as `RIGHT` and `null`, and one saved before sources as `review`.
Posting preserves a range only when every line belongs to the diff on that side; other findings join the summary.

`ReviewDrafts` in `src/server/review-drafts.ts` owns the tool and the post.
A start asks for the tool with `NewSessionRequest.reviewDraft`, which `parseNewSessionRequest` takes only with a pull request subject and which `startTarget` in `web/quick-actions.ts` sets only for **Review**; **Thermonuclear review** never gets it.
`join` wraps the project runner's `launchFor` as the starter and `reattachAll` call it: such a start, or the resume of a session a `Reviewer` names, gets the strict host tool `save_review_draft`, bound to that pull request, so the model cannot write another one's draft, and its `attach` saves the `Reviewer`; a session reattached at startup gets it again the same way.
A `switched` update relinks the reviewer to the session's new id, since a `/move` or a new session in the same process keeps the tool; `exited` forgets the instance.
The tool takes `commit`, the 40-character head the session reviewed, `verdict`, `summary`, and `findings`, at most 100, each with `path`, `line`, a line number or `null`, and `body`; it throws, so the model sees why, on anything else, and the summary and each body hold at most GitHub's 65536 characters.
It numbers the findings `f1` on, all `pending`, trims a leading `./` from each path, and answers that the draft waits for the user and that the session must not post anything on GitHub.

`reviewPayload` turns a draft into the body of `POST /repos/{owner}/{repo}/pulls/{number}/reviews`: `commit_id` the draft's head, `event` from the verdict, a comment on the head side for each accepted finding on a line the diff shows, and the other accepted findings as Markdown list items after the summary, since GitHub refuses a comment on a line outside the diff.
`diffLinesOf` reads those lines from each file's `patch` in GitHub's files answer, which `readReviewTarget` in `src/pull-request-review.ts` reads with the pull request's head.
`postRefusal` refuses a posted draft, a head that moved since the review, **Request changes** with no summary, and a draft with nothing accepted and no summary; the preview and the post both read the target fresh and run the same two functions, so the preview shows exactly what posts.
`post` posts through one `gh api` call (`ghRestPost` in `src/github.ts`) and saves `posted`.
Before it posts, it lists the pull request's reviews and takes one of the viewer's on the same commit, in the state the verdict makes, with the same body and the same comments by path and words, as the review already posted, so a retry after a lost answer marks the draft instead of posting twice; an empty reply review, which GitHub makes for each thread reply, never matches.
Two posts of one draft at once share one promise.

## Updating the dashboard

`src/server/self-update.ts` is **Update dashboard**.
At startup `SelfUpdate.forServer` reads the checkout the server runs from: its top directory, the branch checked out, and that branch's commit, the running build.
A packaged app, a detached HEAD, a directory outside git, or a system without `process.execve` offers no update, and says why.

`SelfUpdate` runs its status reads, its checks, and its updates one at a time, so a check never fetches under a fast-forward.
Once an update starts the restart, a later check answers nothing without fetching, so no fetch outlives `execve` and holds `.git`'s lock when the new server checks.
An update never stashes, resets, or merges:

- It refuses when the checkout moved to another branch since the server started, has changes to tracked files (untracked files do not count), or `origin/<branch>` was never fetched, as for a branch never pushed.
- It fetches `origin/<branch>`, refuses when the branch has commits origin lacks, and otherwise fast-forwards with `git merge --ff-only`, its only write.
- It answers `current` when the checkout then holds the running commit.
- It reads each git exit code exactly: `diff --quiet` and `merge-base --is-ancestor` answer 0 or 1, and any other code, a timeout's included, refuses with git's `fatal:` or `error:` line rather than reading as an answer.
- Otherwise it runs `bun install --frozen-lockfile` when `bun.lock` differs between the running commit and the new one, and answers `restarting`; a failed install leaves the server running and says so.
- 300 ms after answering, so the answer reaches the page or agent that asked, the server restarts: `restart` in `src/server.ts` stops as a shutdown does, letting go of the sessions it started, which run on in their keepers, and writing its stores, and calls `process.execve` with its own command and environment.
  The new server attaches to those sessions again as any start does.
  It keeps the owner lock, which names its pid and port, so no other server takes over the routines while it starts again; a signal or the desktop shell's pipe ending during a restart makes it exit instead.
  The new server keeps the pid, the port, and the standard streams, so a terminal keeps its job and the desktop shell its child, and it builds the page of the checkout as it now is.
- Every later update until then answers the same `restarting`.

The desktop shell's own code in `desktop/` loads only when the app starts again.
Every socket's first message is `{ t: "build", id }`, a hash of the served `index.html`, which names each chunk by its content's hash; the page keeps the first id it heard and reloads when a later socket brings another, so a browser tab or the desktop window follows a restart to the new page.

`GET /api/dashboard/update` answers `DashboardUpdateStatus` from `src/shared/dashboard-update.ts` without asking origin: `unavailable` with its reason, or the branch, the running commit, and `behind`, the commits `origin/<branch>` held past it at the last fetch.
`PUT /api/dashboard/update` with any JSON body runs `SelfUpdate.update` and answers `{ kind: "current" }` or `{ kind: "restarting", from, to, installed }`, or 409 with the refusal.
An agent reaches both with `curl`, with the token's cookie and, for the `PUT`, an `Origin` that matches the host; the starter kit's `AGENTS.md` tells agents to load new commits this way, never by killing its processes.

## Settings sync

`SettingsSync` in `src/settings-sync.ts` keeps the portable settings the same on several machines through one branch of a Git remote.
What is portable is data, `SYNC_ITEMS` in `src/shared/settings-sync.ts`: omp's `config.yml`, `AGENTS.md`, and `APPEND_SYSTEM.md`, the `skills`, `rules`, `agents`, and `commands` trees of omp's agent directory, and the source control settings, each under its path in the repository (`omp/…` and `dashboard/source-control.json`).
`NEVER_SYNCED` lists, as patterns on those paths, what never syncs even inside a synced tree: databases such as `agent.db`, `mcp.json`, `secrets.yml`, key and credential files, session files, lock files, the dashboard's token, `interrupted.json`, and `merges.json`, and `.git` and `node_modules` directories.
`readLocal` also leaves a link inside a tree, a file over 1 MB, a file that is not UTF-8 text, and a file whose text matches a credential's shape (`CREDENTIAL_SHAPES`: private keys and GitHub, GitLab, Anthropic, OpenAI, Slack, AWS, Google, Linear, and npm tokens) on the machine, and reports each as skipped.
Routines and todos stay out of the registry: a routine synced to two machines would run on both, and todos name this machine's sessions.

The machine keeps a bare repository, `settings-sync.git` in the data directory, and runs every git command with `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, and, unless you set your own, `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, so git uses the machine's keys and credential helper and fails rather than prompt.
`SyncRepo` in `src/sync-repo.ts` wraps those commands: it points `origin` at the remote, fetches the branch, reads a commit's text files, builds a commit from a parent and a set of changes with `git fast-import`, and pushes without force.
A ref under `refs/omp-agents/base/`, keyed by a hash of the remote and the branch, holds the commit this machine last applied, so changing either starts again from no base.

A sync runs one at a time, in these steps.
1. Fetch the branch; a branch the remote does not have yet, or no longer has, counts as an empty remote with no base.
2. Read the base commit's files, the remote's, and this machine's, the stores through their `SyncStore` objects and the files from disk.
3. `planSync` merges each path of a synced item three ways with `mergeFile`: one side's change wins, an equal change stays, and two different changes, or two different files with no base, conflict unless the request chose a side.
   A JSON store merges key by key, recursively, and conflicts only on a key both sides changed differently.
4. Any conflict ends the sync with a `conflict` outcome, before anything is written on either side.
5. A store's value from the remote that its store does not accept fails the sync, again before anything is written.
6. When this machine has changes, commit them on top of the remote's head and push as a fast-forward; a push that loses a race fails the sync, and the next one merges again.
7. Write the remote's changes here: files through `atomicWriteText`, executable or not as the remote has them, with deleted files' emptied directories removed up to the tree, and stores through their `write`.
8. Move the base ref to the commit now on both sides.

Pushing before writing here means a sync that stops after the push leaves this machine's files as the next sync's merge expects, so it converges.
A path the plan did not consider, one of an item that is off, a skipped file, or a path a newer version syncs, keeps its remote version, since the commit changes only the paths the plan names.
A sync with nothing changed on either side writes nothing and makes no commit.

Paths under the home directory travel as `~`: `portableText` rewrites the home directory in text files on their way to the remote, and `sourceControlStore` maps each repository key with `portablePath` and `localPath`.
A text file arrives with its `~` form as written, so the comparison on the next sync, which normalizes this machine's text again, sees no change.

`settings-sync.json`, beside the access token with mode `0600`, holds the remote, the branch, the items turned off, and the last `SyncOutcome`: `synced` with the paths received, sent, and skipped, `conflict` with each conflict's path, item, and the first 20,000 characters of both versions, or `failed` with git's message.
Changing the remote or the branch forgets the last outcome.

## HTTP API

**Settings** reads `GET /api/settings`, or `GET /api/settings?cwd=<directory>` for a workspace.
The server loads omp's settings with omp's own read-only loader (`Settings.loadReadOnly` in `pi-coding-agent/src/config/settings.ts`), the same way a session that starts in that directory would, and applies omp's rule for which roles use the `default` chain (`expandDefaultRetryFallbackChains`).
It finds the files through omp's capability discovery (`pi-coding-agent/src/discovery`), agent discovery (`pi-coding-agent/src/task/discovery.ts`), and `findConfigFile` for `APPEND_SYSTEM.md`, and then reads each file from disk.
Each file carries the SHA-256 of its text.
`GET /api/models` runs `omp models --json` for the pickers.

`GET /api/analytics?range=<range>` answers `Analytics` from omp-stats and Claude Code's and Codex's recorded requests, defaulting to `24h`.
The accepted ranges are `today`, `24h`, `7d`, `30d`, `90d`, and `all`; an unknown range returns 400.
The answer includes totals, time buckets with per-provider usage, provider totals, models, workspaces, agent types, tools, the 20 sessions with the most tokens, and live indexing status.

`GET /api/analytics/context?range=<range>[&cwd=<directory>][&session=<id>]` answers `ContextReport`, the context sources over the range, defaulting to `24h`, for every workspace, one working directory, or one session; an unknown range returns 400.
It includes the requests, their input tokens and input cost, the sources by tokens, the workspaces with input in the range, the 20 sessions with the most input in the chosen workspace, and the index's progress while it syncs.

Edits go through two endpoints, each taking the same `?cwd=` and answering with the settings as they load after the write:

- `PUT /api/settings/routing` takes one change: a role's model or fallbacks, a model-keyed chain, some `retry.*` values, or the provider order.
  The server writes it through omp's own write path, the one `omp config set` uses: `Settings.loadIsolated`, the setting's `set` or `setEntry`, and `flush`.
  omp re-reads `config.yml` under its lock and writes back only the paths that changed.
  A model must be one that `omp models` lists, read by `resolveSelector` in `src/omp/config.ts`, so `provider/id:level` works even when the id holds a colon.
  A selector that the config already names passes as it is, so keeping an entry never blocks a save.
  omp checks each retry value against the setting's type and allowed values.
  If omp cannot load `config.yml`, the write is refused, because omp would move the broken file aside before it writes.
- `PUT /api/settings/file` takes `{ path, text, baseHash }`.
  The server runs discovery again for that `cwd` and writes only a path that it finds there, never one the page invents.
  `baseHash` must match the file's current hash, or `null` for a missing file.
  Otherwise the server answers 409 with `conflict: true`.
  The server resolves symlinks, writes a temporary file beside the real file with its mode, and renames it over the real file, so a symlinked file stays a link and a crash cannot leave a truncated file.
  Saves run one at a time, so two saves of the same file cannot both pass the hash check.

Every response from these endpoints is JSON.
An error is `{ error, conflict? }` with the HTTP status.
Any other `/api/` path answers a JSON 404.
The page reports a response that is not JSON with its status and text.
Every endpoint needs the access token's cookie; see [SECURITY.md](../SECURITY.md).

`GET /api/git?cwd=<directory>` answers the git checkout that the directory is in, or `null` outside one: the checked-out branch, every local branch with the worktree that has it checked out, and the main worktree.

`GET /api/system` answers the status bar's machine load: `{ cpuPercent, memoryAvailable, memoryTotal, diskAvailable, diskTotal }`.
`cpuPercent` is the busy share of every core's time since the previous read, from `os.cpus()`, and `null` when no time passed; the first read measures from the server's start.
`memoryAvailable` is `kern.memorystatus_level`, the free percentage `memory_pressure` reports, of the physical memory on macOS, since `os.freemem()` counts only never-used pages there, and `os.freemem()` elsewhere.
`diskAvailable` and `diskTotal` come from `statfs` on the home directory: the blocks free to an unprivileged user and all the volume's blocks; on macOS the free figure leaves out purgeable space, which Finder counts.

`GET /api/file?path=<absolute path>` answers a text file for the page's file dialog: `{ path, text, size, truncated }`.
The path is absolute or starts with `~`, which `expandHome` in `src/paths.ts` reads as the home directory; the page resolves a relative one against the session's worktree or directory first.
The file's real path, after symlinks, must end in one of `TEXT_FILE_EXTENSIONS`, so a link named `notes.md` cannot reach a key file.
It must also lie outside the directories that hold sign-ins and config, `DENIED_DIRS` in `src/local-file.ts`, compared by their real paths, or the route answers 403: omp-agents' own directory, which holds the access token, and omp's agent directory, but for its Markdown, such as `AGENTS.md` and skills, and its images and videos.
It reads the first `MAX_TEXT_FILE_BYTES` (1 MB) and answers 415 when those bytes are not UTF-8.
`GET /api/media?path=<absolute path>` serves an image or video that agent text names, as the type `MEDIA_FILE_TYPES` in `src/shared/transcript.ts` gives its extension, with the same path, real-path extension, and `DENIED_DIRS` checks as `GET /api/file`.
Bun answers a `Range` request with a 206 and that part, so a video seeks.
It sends `Cache-Control: private, no-cache`, since a file can change under the same path, and `Content-Security-Policy: sandbox; default-src 'none'`, so an SVG opened at that address runs no script on the page's origin.
It runs `git worktree list --porcelain -z`, `git for-each-ref`, and `git symbolic-ref` on each call, and reads `origin` through the pull request list's cached lookup.
Like a new session's `start`, `cwd` may name any directory.
The new-session draft reads it for its branch picker, and a live session's header reads it when it opens and when a turn starts or ends.
`GET /api/changes?session=<session id>` answers a session's [changes dialog](usage.md#session-changes) list, `SessionChanges` in `src/shared/changes.ts`, or 404 for a session it does not know.
It reads the session's checkout from its worktree, else its directory: `git diff --name-status` and `--numstat` against the merge base of `HEAD` with `origin/HEAD`, else against `HEAD`, else against the empty tree before the first commit, and `git ls-files --others --exclude-standard` for untracked files.
It folds the session's transcript with `Work` for the files its own `edit` and `write` calls changed, keeping each transcript's fold and parsing only the lines it gained since the last list, or folding it again from its first line once it shrinks, and lists those git does not name after git's.
`GET /api/changes/file?session=<session id>&path=<path>` answers one file of that list in full, `ChangedFileText`, with every line of `git diff --histogram` as numbered rows, or a note for a binary file or one over `MAX_CHANGED_FILE_BYTES` (1 MB).
It computes the list again and answers 404 for a path the list does not hold, so it reads no file the session and its checkout did not change, and passes the path with `--literal-pathspecs`, so a name such as `app/[id]/page.tsx` is not a glob.
The dialog reads both routes again whenever the session's own changes grow and when a turn starts or ends.
`GET /api/project-notes?id=<project id>` answers a project's notes and the user's, `ProjectNotesAnswer` (`{ dir, notes, userDir, userNotes }`), each note a `ProjectNote` (`{ name, path, modifiedAt }`) for a Markdown file at any depth in its directory, named by its path from it with `/`, by name, or 404 for a project the server does not know.
The page lays each list out as a tree through `noteRows` in `web/notes-model.ts` and opens a note through `GET /api/file`, which opens both directories, since they lie outside `DENIED_DIRS`.
`GET /api/conversations?q=<words>` answers `ConversationSearchAnswer` from `src/shared/sessions.ts`: every saved conversation whose prompts or replies hold every word, the file changed last first, each by its latest such message, with that message's transcript item id, a snippet, and how many messages match; a blank `q` is a 400.
It waits for the transcript reads asked for so far, then reads nothing itself; the page leaves out the sessions the sidebar hides and lists the first 30.
`GET /api/pull-request/title?owner=<o>&repo=<r>&number=<n>` answers `{ title }` for a bare GitHub or Graphite PR link.
It reads only the title through `gh api graphql`, using the same validated pull request query as the details routes, and keeps each answer for 30 seconds, sharing in-flight reads.
The page's existing `useRead` drops answers for a previous link and aborts the read when the link unmounts; explicit Markdown labels do not request a title.
`GET /api/pull-request/files?owner=<o>&repo=<r>&number=<n>` answers `PullRequestChanges`: title and branches from REST, the files from the paginated REST files endpoint, and each file's `viewerViewedState` from paginated GraphQL.
Files are ordered by source dependencies, tests in source order, and generated files last.
The optional `commit=<full oid>` scopes both `/files` and `/file` to a commit belonging to that pull request, with a separate cache entry and the blobs from that commit.
Each list call reads GitHub again and keeps patches and blob ids for following file reads for 30 seconds.
`GET /api/pull-request/file?owner=<o>&repo=<r>&number=<n>&path=<path>` answers one file of that list in full, `ChangedFileText`, and 404 for a path the list does not hold.
GitHub's patch keeps three unchanged lines around each change, so `patchRows` in `src/shared/changes.ts` fills the lines before, between, and after its hunks from the file's text at the head, which one `gh api graphql` call reads by the blob id the list names.
Both file readers answer through `fileText(path, rows, note)` in `src/shared/changes.ts`, so a file's rows and the note on why it has none take one shape.
A removed file's patch holds every line, so it reads no blob; a file GitHub sends no patch for, a binary file, and one over `MAX_CHANGED_FILE_BYTES` answer a note.
`GET /api/pull-request/stack?owner=<o>&repo=<r>&number=<n>` answers the pull requests of the header's **N/M** stack menu, `StackedPullRequest[]` top first, from one `gh api graphql --paginate --slurp` read of the repository's open pull requests, forks left out, which it keeps for 30 seconds.
`stackOf` in `src/pull-request-stack.ts` follows the base branches down from the pull request and the pull requests based on its branch up, so the stack holds those that the Pull requests page does not list.
`GET /api/pull-request/options?owner=<o>&repo=<r>` answers `PullRequestOptions` for the pickers of a pull request's **Summary**: the repository's labels and the people its issues can be assigned to, whom a review can be asked of, each from `gh api --paginate --slurp` and sorted by name, kept five minutes per repository.
`PUT /api/pull-request` takes a `PullRequestEdit`, a pull request and one `change`, checked by `parsePullRequestEdit` in `src/server/wire.ts`: a label or a review request added or removed through REST, or a state of `open`, `draft`, or `closed` through the GraphQL mutations `stateSteps` orders, a closed pull request reopening before its draft flag changes.
A `title` change carries a nonblank title of at most 256 characters and patches `repos/<owner>/<repo>/pulls/<number>`.
A `body` change patches the same REST resource with the description as a literal `-f body=…` field, preserving whitespace and allowing an empty description, up to `MAX_PULL_REQUEST_BODY` (65536 characters).
Comment and review authors carry `isBot` from GitHub's `__typename` `Bot`, which the **Bot comments** filter reads along with a `[bot]` login suffix, since some GitHub Apps comment under a login without one.
An `update` change selects `merge` or `rebase` and calls `GITHUB_MERGES.update` with the node id and head read fresh from GitHub.
`PUT /api/pull-request/viewed` takes a `PullRequestViewedEdit`, a pull request with `{ path, on }`, reads the pull request node id, calls `markFileAsViewed` or `unmarkFileAsViewed` through GraphQL, and answers `{}`, since the **Code** tab keeps its own viewed states.
The queue uses the same update function with the merge method.
`PUT /api/pull-request/checkout` takes a `PullRequestCheckout` from `src/shared/github.ts`, a pull request with `{ cwd, place, skill }`, checked by `parsePullRequestCheckout`, and answers 404 when `cwd` is not a directory.
`checkOutPullRequest` in `src/pull-request-checkout.ts` refuses a `cwd` whose `origin` is another repository, reads the head branch and commit from REST, and answers a `CheckedOutPullRequest`: its `place`, the branch, whether it is at that commit, and at `worktree` the `instanceId` of the session it started; any refusal answers 409 with why.
Place `here` refuses uncommitted changes to tracked files and runs `gh pr checkout <number> -R <owner>/<repo>` in `cwd`.
Place `worktree` fetches `refs/pull/<number>/head` without tags or forcing into the head branch's name, or `pr-<number>/<name>` for a fork; a non-fast-forward rejection is explained as a local branch with commits of its own.
It gives a branch from the same repository the upstream `origin/<name>`, unless a linked worktree already has the branch, which it reuses as it is.
It refuses the branch while the main checkout has it, then starts a `new` session through the same start a socket `start` runs, with `branch: { kind: "existing" }`, the pinned `skill`, a prompt asking for a summary, and the pull request as its subject, so `checkoutDir` reuses or adds the worktree.
Each open pull request detail adds one REST comparison of its base against its head commit.
`behindBy` is the comparison's `behind_by` count, or `null` for an unavailable comparison or a finished pull request.
A merge is no change of its own: it goes through `PUT /api/merge-queue`, whose `MergeQueue` runs GraphQL's `mergePullRequest` with `expectedHeadOid` the commit the confirmation showed, so GitHub refuses the merge once the branch moved past it.
The pull request's answer carries that commit as `headOid` and the methods its repository allows as `mergeMethods`.
A `thread` change, `{ id, resolved }`, runs GraphQL's `resolveReviewThread` or `unresolveReviewThread` on the review thread with that node id, which `parsePullRequestEdit` takes only as letters, digits, `_`, `-`, and the `=` an older base64 id ends with, at most 100.
A `reply` change, `{ thread, body }`, runs `addPullRequestReviewThreadReply` on that thread.
A `comment` change, `{ body }`, posts to REST's `repos/<o>/<r>/issues/<n>/comments`, the pull request's number naming it, with the body as a `-f` field, which `gh` sends as written, never as a number, a file, or a placeholder.
A reply's or comment's body is not blank and at most 65536 characters, GitHub's limit.
The pull request's answer lists every review thread among the first 100, resolved ones too, each with its node id and whether the viewer may reply, resolve, and unresolve it, from `viewerCanReply`, `viewerCanResolve`, and `viewerCanUnresolve`, so the button a resolve or unresolve shows at once stays right.
The same detail GraphQL request reads `mergedAt`, `closedAt`, comment and review `reactionGroups`, each thread's `isOutdated`, its total comment count, and its root comment's review state for dismissal.
Each thread still loads its first 20 comments, with the total count letting the Timeline link to replies beyond that limit on GitHub.
Reaction groups carry their content, user count, and viewer participation for read-only display; lifecycle times remain separate from `updatedAt`.
The Timeline adds no activity request and does not invent draft, ready, reopen, force-push, or base-change history from the pull request's current state.
Its `unresolved` counts the open threads among those it lists, with `exact` false when GitHub has more than it listed, so the details' counts agree with their threads.
GitHub's GraphQL has no `viewerCanComment` on a pull request, so its `canComment` is true unless the repository is archived, or the conversation is locked and the viewer's `viewerPermission` is below `WRITE`, as GitHub lets only people who can write comment on a locked conversation.
Its `byViewer` is `viewerDidAuthor`, since GitHub refuses an approval or a change request from the pull request's author.
A `review` change posts `{ event, body }` to `pulls/<n>/reviews`, leaving out a blank body; `canSubmitReview` in `src/shared/review-drafts.ts` decides whether one may post, for the composer and the server alike.
Every mutation goes through `ghMutation` in `src/github.ts`, which throws GitHub's errors even when its answer carries `data`, since a refused mutation answers its field as `null` beside them.
`PUT /api/pull-request` answers the pull request as `GET /api/pull-request` reads it after the change, read again from GitHub, and the details then refresh the pull request list.
One change goes per call, so two changes made at once each keep the other.
The details send their changes one at a time through `useEditableRead` in `web/editable-read.ts`, which the issue detail's fields share.
Each answer carries how many writes had answered when it was asked, so an answer to an earlier change, or a read sent before a write answered, never hides a later change.

`GET /api/github-media?url=<HTTPS URL>` reads GitHub images and videos through `src/github-media.ts`.
The allowlist is `github.com/user-attachments/`, `private-user-images.githubusercontent.com`, `user-images.githubusercontent.com`, and `camo.githubusercontent.com`; credentials, alternate ports, and every other host or scheme are rejected.
`githubMediaUrl` in `src/shared/github.ts` holds it, and the page loads every such image or video written on GitHub through this route, so the page's CSP allows only GitHub's avatars directly.
It reads `gh auth token --hostname github.com` only for a `github.com` hop, at most once a minute, checks each of at most five redirects before fetching it, and never sends that token to a CDN.
Only image and video content types pass, up to 20 MiB streamed under one 15-second deadline, with a five-minute private cache bounded to 32 entries and 40 MiB.
Upstream cookies and headers do not pass through; responses have `nosniff` and a sandbox CSP.
A `github.com` upload may redirect once into GitHub's signed upload bucket, `github-production-user-asset-6210df.s3.amazonaws.com`, which gets no token and which no other hop or request may reach.

`PUT /api/merge-queue` takes a `MergeQueueChange` from `src/shared/merge-queue.ts`, checked by `parseMergeQueueChange` in `src/server/wire.ts`: `{ op: "add", method, prs }`, one to `MAX_QUEUED_STACK` (20) pull requests in any order, each with the head commit the confirmation showed or `null`, or `{ op: "cancel", id }`.
It answers a `MergeQueueAnswer`, the queued merges after it, which every socket also hears as a `merges` message, and the pull requests it merged on the way, which `writeMergeQueue` in `web/reads.ts` marks merged in the list at once; a refusal, such as a branch that moved or a pull request already queued, is a 409 with the reason.
The details' answer carries GitHub's `mergeStateStatus` as `mergeState`, which `mergesNow` in `src/shared/github.ts` reads to word the confirmation as a merge now or once it is ready.

`GET /api/review-draft/preview?owner=<o>&repo=<r>&number=<n>` answers a `ReviewPreview` from `src/shared/review-drafts.ts`: the `payload` posting would send, the pull request's `head` now, and the `refusal`, or `null`; see [Review drafts](#review-drafts).
`PUT /api/review-draft/post` takes `{ owner, repo, number }`, and optionally the composer's `submit: { verdict, summary }`, which the server checks the post against and writes into the draft, accepting its pending findings, once the post is not refused, so a refusal leaves the draft as it was; it posts that pull request's draft as one review, and answers the draft marked posted, which every socket also hears; a refusal, or GitHub's own, is a 409 with the reason.

`GET /api/source-control` answers a `SourceControlAnswer` from `SourceControl` in `src/source-control.ts`: whether `gh` and `gt` are installed and signed in, the automatic pull setting, whether the cleanup after a merge is on (`cleanUp`), and each repository the visible workspaces are in, keyed by its main checkout, with its own choice and its last pull since the server started.
`gh` is signed in when `gh api user` answers a login, and `gt` when Graphite's `user_config` holds an `authToken`.
`PUT /api/source-control` takes a `SourceControlChange`, `{ op: "default", on }`, `{ op: "repo", repo, on }` with `on: null` dropping a repository's own choice, or `{ op: "clean-up", on }`, checked by `parseSourceControlChange` in `src/server/wire.ts`, and answers the same as the `GET`.
A change that changes the settings saves `source-control.json` beside the access token and, for a change of the pulls on the server that holds the owner lock, pulls at once; a file from before `cleanUp` reads with it on.
A pull, from that change or from the pull loop every five minutes, waits for the one under way, then runs `pullDefaultBranch` on each repository whose pulls are on.
It reads the default branch from `origin/HEAD`, fetches it, and moves the local branch only when it is behind `origin`'s with no commits of its own: through `merge --ff-only` in the worktree that has it checked out, skipped when that worktree has changes to tracked files, else through `update-ref`.

`GET /api/sync` answers a `SyncAnswer` from `src/shared/settings-sync.ts`: the `SyncSettings`, `{ remote, branch, excluded }`, and the last `SyncOutcome` or `null`.
`PUT /api/sync` takes `SyncSettings`, checked by `parseSyncSettings`, which refuses an address that starts with `-`, holds whitespace, or carries a password, a branch name Git would refuse, and an unknown item, and answers the same as the `GET`.
`PUT /api/sync/run` takes `{ choices }`, each conflicting path mapped to `local` or `remote`, checked by `parseSyncRun` in `src/server/wire.ts`, runs one sync, and answers the same as the `GET`, with a conflict or a failure as the last outcome rather than an error status.

`GET /api/worktrees` lists the worktrees of every repository a session ran in, or of `?cwd=` when that directory is in a repository.
Each row names the registered path, branch, lock, whether the directory is missing, the newest session file there, why removal is refused, and `merged`: `{ by: "pull-request", number }`, `{ by: "default-branch", branch }`, or `null`.
A linked checkout is merged when `origin`'s default branch contains its commit, or when its branch's newest pull request merged no earlier than the branch's last commit; the pull requests come from one `gh api graphql` call per repository, and a failed call becomes an entry in `errors`.
`GET /api/worktrees/metrics?repository=&path=` reads approximate allocated disk use, the last commit time, and the modified and untracked counts for one registered checkout.
`PUT /api/worktrees/removal` previews a removal or performs one whose confirmation still matches that preview, up to `MAX_WORKTREE_BATCH` (100) worktrees per request.
A preview with `merged: true`, which **Remove merged** sends, adds the `unmerged` blocker to every target the same check cannot show merged, so the page removes only the merged ones nothing else blocks.
Removal uses `git worktree remove` without `--force`, so Git keeps the branch and still refuses a dirty or locked checkout.
The preview reads the status with executable-mode detection forced on, and refuses a checkout whose index hides changes with assume-unchanged or skip-worktree flags.
A missing directory is removed the same way, which drops only that registration.
A start that creates a branch's worktree and registers its session excludes a removal, and so does a removal that has begun: a removal waits for the starts under way, reads the live and saved sessions once, then checks and removes each confirmed checkout in turn.
Starts that create no worktree, such as a resume or a routine's session, stay parallel and wait only while a removal runs.

`PUT /api/worktree/release` takes `{ cwd, branch }`, an absolute directory in a repository and a branch name, checked by `parseBranchRelease` in `src/server/wire.ts`, and answers 404 when `cwd` is not a directory.
`Worktrees.releaseBranch` lists the repository's worktrees, picks the linked one that has `branch` checked out, never the main, a bare, or a prunable registration, and removes it through `removeCheckout` without waiting for a session to leave.
It answers a `BranchRelease` from `src/shared/git.ts`: `{ kind: "none" }` when no linked worktree has the branch, `{ kind: "removed", path }`, or `{ kind: "kept", path, why }` with the blockers' messages or Git's error.
The page sends it when you copy a session header's branch or a pull request details' branch.

`PUT /api/workspaces` takes a `WorkspaceChange`, `{ op, cwd }` with `op` one of `add`, `hide`, and `show`, checked by `parseWorkspaceChange` in `src/server/wire.ts`.
`add` resolves `cwd` through `directoryOf` in `src/paths.ts`, which expands `~`, and answers 400 when it is not a directory; `hide` and `show` take an absolute path.
`applyWorkspace` in `src/shared/workspaces.ts` applies one change: adding also shows a hidden directory, and a directory in both lists is hidden, so **Show** offers an added one again.
A change that changes the list saves `workspaces.json` and sends every socket a `workspaces` message, its `list` of added and hidden directories, each with its `cwdDisplay`, also sent when a socket opens.
A request's `?cwd=` may name an added directory, as the settings under **This workspace** and a workspace's pull request list do; the every-workspace pull request list and the worktrees inventory read only the directories sessions ran in.
The page lists added directories after those sessions ran in, and drops a hidden directory, not the directories inside it, from its pickers, session lists, counts, and search, as it does `/tmp`.

`GET /api/models/connected?cwd=<directory>` answers `{ models }`: the models that `omp models` lists from the providers you are connected to, for the new-session draft's model menu.
Each model is `{ provider, id, name, contextWindow, curated, thinkingLevels }`; `curated` marks the ones that the directory's `modelRoles` or `retry.fallbackChains` name, as omp resolves each selector, and `thinkingLevels` are the ones omp's catalog lists (`modelEntries` in `src/omp/models.ts`).
The models of the providers that `modelProviderOrder` names come first, in that order, and the rest keep omp's order.
A live session's `list-models` answer builds the same entries from the models that its omp RPC process offers and the config of the session's directory.
A `start` of kind `new` carries a `model`, `null` for omp's default; the server sends omp `set_model` once it is ready and before the first prompt, and a model that omp refuses fails the start.

`GET /api/models/roles?cwd=<directory>` answers `{ roles }`, each `{ role, model, thinking }`; the new-session draft reads the `default` role's model from it to name the model omp starts on.
Like `/api/git`, `cwd` may name any directory.
`connectedRoles` in `src/omp/models.ts` loads `modelRoles` with omp's read-only loader for that directory, so a project's `.omp/config.yml` overrides count, and reads each role's selector against `omp models`: a `:level` suffix becomes `thinking`, and `@role` or `*` takes the named role's model and level unless it adds its own.
Roles that name a model by a fuzzy pattern, or one on a provider you are not connected to, are left out.
A `start` of kind `new` and a `set-model` each carry a `thinking`, `null` to keep omp's level; the server sends omp `set_thinking_level` after `set_model`.

A dashboard session's row carries `fast`, `{ enabled, active }` from omp's state, or `null` while its model has no priority tier.
`set-fast` with `enabled` sends omp `set_fast_mode`, and the session then reads omp's state again; omp refuses to enable it for a model without the tier, which shows as a note.

`GET /api/skills?cwd=<directory>` answers `{ skills }`, each `{ name, description }`: the skills that `/skill:<name>` invokes in a session started in that directory, from the same discovery as the composer's `/` completions (`listSkills` in `src/commands.ts`), and none when omp's `skills.enableSkillCommands` is off.
Both leave out a skill whose frontmatter `name` holds whitespace, such as `Poteto Mode`: omp reads a `/skill:` name up to the first space, so no prompt can invoke it.
The settings page lists them to pin one, and the new-session draft reads them to show whether the pinned skill exists there.
The page keeps the pin in localStorage (`web/pinned-skill.ts`).
A `start` of kind `new` carries a `skill`, `null` for none: the draft sends the pin unless you turned it off there, and a quick action always sends it.
Once the server knows the directory omp runs in, worktree included, `withPinnedSkill` puts `/skill:<skill> ` before the first prompt, so omp's RPC prompt invokes the skill with the prompt as its arguments.
A directory without that skill, or a prompt that starts with `/`, keeps the prompt as typed.

A `start` of kind `new` carries a `subject`, `null` for none: a quick action sends the pull request or Linear issue it works on, and one on a todo sends no subject and names the todo in `todoId` instead.
`LiveSessions` keeps it by instance id, and `rows()` puts it first among the session's `pullRequests` or `tickets` until the session's tool calls name it, so the roster links the session to its subject from the start, before omp writes the session file.
The link goes when the session ends.

A `start` of kind `new` carries a `branch`, `null` for the directory as it is.
For an existing branch, the server runs omp in the worktree that has it checked out, or in the starting directory when that worktree is the directory's own (`git rev-parse --show-toplevel`); with no such worktree it runs `git worktree add <dir> <branch>`.
For a new branch, it runs `git check-ref-format --branch` and then `git worktree add -b <branch> <dir> <base>`.
`<dir>` is `worktreeDir` in `src/shared/git.ts`, beside the main worktree.
The server refuses a `<dir>` that already exists, because `git worktree add -b` creates the branch before it checks the path.
A branch that git refuses answers the `start` with git's reason, and no omp spawns.
A failed start makes the draft read the checkout again, so a branch that the start created shows as an existing one.

`GET /api/tickets`, or `GET /api/tickets?fresh` to skip the server's 30-second cache, answers the tickets page with `{ tickets }`.
A failed read is the API's usual `{ error }` with status 500, and the page keeps showing the last tickets it has with the error above them.
The server reads Linear through Linear's MCP server, with the OAuth sign-in that omp keeps for it, through `src/omp/mcp.ts`: it loads omp's own MCP config for the enabled server whose `url` has the `mcp.linear.app` host, and gets an access token for its `auth.credentialId`, or for the id omp files a sign-in for that URL under, from `omp token <credentialId>`, which refreshes the token through omp's credential owner.
The token stays in memory for five minutes and is dropped when Linear answers 401, which the page reports as a hint to reconnect Linear in Settings › Integrations or run `/mcp reauth <name>`; it is never logged.
Linear's GraphQL API refuses that token, so the server calls the MCP endpoint's `list_issues` tool through omp's `callMCP`, a stateless JSON-RPC `tools/call` POST.
It asks for each open state type in full, following the cursor, and for completed, canceled, and duplicate issues updated in the last seven days, in parallel, then drops repeats by identifier.
Each issue carries its `parentId`, the parent's identifier, from which the page nests a listed sub-issue under its listed parent.
`list_issues` and `get_issue` name an issue's labels without their colors, so the server reads each team's labels with `list_issue_labels`, by the team key that prefixes the identifier, and keeps them for five minutes; `?fresh` reads them again too.

`GET /api/ticket?id=<identifier>`, such as `?id=ENG-2368`, answers the tickets page's main content with that issue in full: the row's fields, the assignee, the team's id, the description, who opened it and when, the links Linear attaches to it, its comment threads, its parent, and its sub-issues.
The server calls `get_issue`, `list_comments`, and `list_issues` with `parentId` for the sub-issues, in parallel, through the same MCP sign-in, with no cache, so each opening reads the issue again.
For a sub-issue it then reads the parent with `get_issue`, asking only for the fields its row shows.
It rewrites Linear's `<issue>` mentions as markdown links, its `<linear-image>` tags as image links, its `<linear-embed node-type="video">` tags as `<video>` elements, and other `<linear-embed>` tags as links.
It threads the comments by `parentId`, oldest first.
An identifier that is not a team key, a dash, and a number answers 400.

Linear hands out its files as `uploads.linear.app` addresses whose `signature` JWT expires five minutes after the read.
`loadTicketDetail` reads the raw texts of `get_issue` and `list_comments`, and `rememberUploads` in `src/linear-uploads.ts` keeps the latest signed address of each upload path found in them, in memory, under the issue they were read for.
It drops an address once it expires, and the oldest past 256 addresses, since signing one anew costs one read of its issue.
`linearMarkdown` is a pure text rewrite: it turns each upload address in the description and comments into `GET /api/ticket/media?issue=<identifier>&path=<upload path>`.
That route fetches the kept address, passing the `Range` header on, and streams Linear's answer back with its type, length, range, and validators.
When the kept address is within 30 seconds of expiring, missing after a restart, or refused by Linear, the route reads the issue again and remembers its uploads anew, which signs every file in it; requests for one issue within 10 seconds share that read.
Only paths that a read of the issue named are fetched, so the route reaches nothing but Linear's own uploads, and a path that one issue names is not served under another's identifier.
It serves each file with `Content-Security-Policy: sandbox` and `nosniff`, and anything other than an image, a video, or audio as an attachment, since a file that someone uploaded to Linear is served from the dashboard's origin.
The page's CSP stays `'self'` for media.
`message-markdown.tsx` lets Linear's text load images and play `<video>` only from that route and `GET /api/github-media`.

`GET /api/ticket/options?team=<team id>` answers `TicketOptions` for the issue detail's field pickers: the team's workflow states (`list_issue_statuses`) as `{ status, statusType }` in the order Linear lists them, the workspace's active members (`list_users`), the team's and the workspace's live labels (`list_issue_labels`), and the names of the team's projects (`list_projects`, 50 a page), each paged to its end.
The issue detail's status picker orders the states with the same `statusOrder` as the tickets page's groups.
The server keeps each team's answer for five minutes.
`PUT /api/ticket` takes a `TicketEdit`, `{ id, state?, assignee?, priority?, labels?, project?, dueDate? }`, checked by `parseTicketEdit` in `src/server/wire.ts`, where `state` and `project` name the status and the project as the issue shows them, `assignee` is a user's id, `null` clears a field, and `labels` replaces the whole set by name.
It calls `save_issue` with those fields, drops the cached tickets list, and answers the issue as `GET /api/ticket` reads it after the change.
The issue detail shows a change at once and sends its changes one at a time, and once every change sent has answered, it reads the issue again if Linear refused one.

`PUT /api/todo/ticket` takes a `TodoTicketRequest`, `{ todoId, team }`, checked by `parseTodoTicket`, and `createTicketForTodo` in `src/server/todo-ticket.ts` opens an issue from that top-level todo's title and notes, assigned to the viewer, then links it to the todo through the same list change a socket `user-todo` makes.
It answers 409 without opening an issue when the todo is not a top-level todo outside the archive, has no title, or already links an issue.
Once the issue exists, it answers a `TodoTicketAnswer`: `{ identifier, linked: true }` when the server's todo list holds the link, else `{ identifier, linked: false, error }`, such as when the todo was removed while Linear opened the issue.
Linear and `todos.json` are not one transaction, so the page shows an unlinked issue by its identifier and offers to link it rather than open another.

### Integrations

`MCP_SERVICES` in `src/shared/accounts.ts` holds the services whose MCP server the **Integrations** page signs omp in to, keyed by the ids in `MCP_INTEGRATIONS`.
`integrationOn(host)` there names the service whose server is on a host, which is how the MCP servers page tells an integration's server from one it manages itself.
Linear, Slack, Google Calendar, and Gmail are the four.
Each names its label, the host omp's server for the service is on, and the name and URL of the server a sign-in adds when omp has none.
Each also names its `client`, where its sign-in gets its OAuth client: `none` for Linear, which registers its own, `slack-app` for Slack, and `google-oauth` for Google Calendar and Gmail.
Its `requireRefresh` says whether a sign-in refuses a grant without a refresh token, which only Slack's does.
Its `accounts` says whether it signs in to the first server on its host (`one`, Linear and Slack) or holds an account per server on its host (`many`, Google Calendar and Gmail).
`src/integrations.ts` reads these fields for every service rather than naming one, keeps one sign-in at a time per service, and picks each service's kind once: a single server for `one`, or the accounts `src/google-accounts.ts` keeps for `many`, each answering the same load, sign-in, remove, and drop of every sign-in.
The page adds each service's brand mark and what it gives.
`SLACK_USER_SCOPES` is the chat, history, search, and user set a dedicated Slack app may grant.
Canvas, list, file, reaction, and channel-creation scopes are not requested.

Google's MCP endpoints answer only their bare URL, so omp would file every account's sign-in under that URL; each account is a server on the service's host instead, and every sign-in to one, the first included, lands on a new credential id `mcp_oauth_omp_agents_<hex>` that its server's `auth.credentialId` names, a prefix `omp token` refreshes and `removeManagedMcpOAuthCredentials` removes.
A server that held a sign-in before accounts keeps omp's URL-keyed credential id until its next sign-in, so no sign-in moves on upgrade.
An added account's server is named `<serverName>-<n>`, the first `n` from 2 that names no server omp loads.
An add asks Google with `prompt: "select_account consent"`, so Google shows its account chooser.
`signInAccount` in `src/google-accounts.ts` writes the server to name the new id only after the grant is stored and its address claimed, since omp answers a server whose own sign-in is missing with the one filed under its URL, another account's.
Its claim asks Google for the address, lowercased, and refuses one that another account of the service already holds.
A refused, unreadable, or failed sign-in removes the new grant and leaves the server, its old sign-in, and its address as they were, so a failed add leaves neither a server, an address, nor a sign-in; a kept one removes the server's old grant.
A read of the integrations may learn a missing address, lowercased, and never signs out; when Google will not say it, the account's `addressError` says why.
While the only server on a host holds no sign-in, an add signs in to that server instead of adding one.
`signOutMcp` in `src/omp/mcp.ts` removes only a server's own credential id, and the URL-keyed ids only when its own id is one of them, as `/mcp unauth` does for Linear's and Slack's servers, so signing out an added account never signs out a server still filed under its URL.
Removing an account removes its server first, then its row; the last server on a host stays, signed out, because it holds the OAuth client, which `saveClient` writes to every server on the host.
`google-accounts.json` beside the access token (`src/server/google-accounts-file.ts`) keeps each account's lowercased address by server name, learned from Gmail's profile or the Calendar list's primary entry, and each lowercased address's linked workspaces, so a Gmail and a Calendar account whose addresses differ only in case share one link; `visibleAccounts` in `src/shared/accounts.ts` is the one rule the Inbox, the Calendar, and the `@` menu filter by.
Reading the integrations forgets the address of an account whose server is gone from the servers that read listed.
Forgetting an address keeps its links on purpose, so an account added again as the same address is linked as before.
`accountClients` makes one `GmailClient` or `GoogleCalendarClient` per signed-in account, keyed by its server's credential id, so a sign-in makes it again and it never answers from another account's caches; it drops a client once its server is gone, and `GmailAccounts` and `GoogleCalendars` merge their reads with one failing account kept apart from the others.
The starter kit's `extensions/google-accounts.ts` reads `google-accounts.json` and omp's user `mcp.json` at each prompt; while a service has two or more accounts, it tells the session each account's server name, address, and tool prefix, and the addresses linked to the session's workspace.
It finds that workspace as the deepest linked one the session's real directory is in, else the one its repository's main checkout, the parent of `git rev-parse --git-common-dir`, is in, so a linked worktree outside the repository takes the main checkout's links.

`GET /api/integrations` answers `{ integrations }`, one `McpIntegration` under each service's id: `{ id, connection, signIn, setup }` for Linear and Slack, and `{ id, accounts, signIn, setup }` for Google Calendar and Gmail.
Each `GoogleAccount` there is `{ name, address, addressError, connection, workspaces }`, its server's name, the address learned for it or `null`, why the latest read of that address failed or `null`, where omp stands with its server, and the workspaces its address is linked to.
`signIn` also names the `account` it signs in to, `null` while it adds one.
`setup` is the one its `client` decides, through `clientSetup` in `src/mcp-clients.ts`: `null` for Linear, which registers its own OAuth client, without reading `mcp.json`.
For Slack it is a `SlackSetup` with the client ID, whether a client secret is stored, the redirect URI, the callback port, the scope string, and `configured`.
For Google Calendar and Gmail, the `GOOGLE_SERVICES` in `src/shared/accounts.ts`, the services whose `client` is `google-oauth`, it is a `GoogleSetup` with the client ID, whether a client secret is stored, the callback port, and `configured`.
The client secret is absent from that body.
`GET /api/settings` does not read `mcp.json` either.
Its file list comes from omp's context, prompt, command, rule, skill, hook, and agent discovery.
Before the app is saved, Slack's setup uses callback port 3000 and the full scope list, with `configured: false`.
`configured` is true only when the user MCP file has a client ID, a client secret, a nonempty subset of `SLACK_USER_SCOPES`, an HTTPS redirect, and a callback port.
An HTTPS loopback redirect must use a different port from the local HTTP callback.
Google Calendar's and Gmail's setups use callback port 3119 until a client is saved, and are `configured` only when their server has a client ID, a client secret, and a callback port.

A Linear or Slack `connection` is `absent` while omp's user-level MCP config has no enabled server on the service's host, where a Google service's `accounts` is empty instead, and a connection is `signed-out` while omp's credential store, read again on each call, holds no OAuth sign-in for its server.
A Slack, Google Calendar, or Gmail server that already has a sign-in is still probed when the saved client settings are incomplete.
`listMcpTools` in `src/omp/mcp.ts` discovers their tools through omp's client, with the configured transport and headers and the same token as the tickets' calls, following every cursor.
`remoteStatusOf` in `src/mcp-status.ts` turns the outcome into one `McpRemoteStatus` from `src/shared/mcp-status.ts`, which both sections share: `ready` with each tool's name and description, `refused` on discovery's `McpUnauthorized` while omp holds a sign-in, or `failing` with any other error and the HTTP status the server answered, `null` when it answered none.
Every service requires a sign-in, so a service that has none is `signed-out` without listing its tools.
One cache keeps discovery lists for a minute and never a failure, keyed by server name, expanded config, credential id, and whether discovery sends omp's token; `?fresh` lists again.
Config writes invalidate that name, and sign-in, sign-out, and discovery or service API 401 invalidate every list using that credential id plus its token.
While a service's sign-in waits on the browser, `hold` on its `SignIn` answers the connection read during that sign-in of the account it signs in to, without listing the tools again; the sign-in names its target account, and a new one starts holding nothing.
The page shows the **Tickets** tab while Linear's connection is `ready`, `refused`, or `failing`, and the **Inbox** tab while any Gmail account's is, and keeps the last read in localStorage.
`integrationsStore` in `web/reads.ts` drops a cached answer in which an integration has no connection, or a `ready` one lists its tools as anything but objects, as answers did before tools carried descriptions.
Each gated tab names its service as the `integration` of its row in `SIDEBAR_TABS` in `web/routing.ts`, and `tabsSignedOut` in `web/sidebar-tabs.ts` turns those rows into the tabs omp holds no sign-in for. `useSidebarTabs` keeps the layout, the signed-out set, and the tabs the bar shows, which Cmd+1 through Cmd+7 go to, and the tab row fits its width by how many tabs show.
The dashboard calls Linear only while its connection is `ready` or `failing`: the tickets page shows Linear's integration row instead of the issues otherwise, and the Todo page's **Create Linear ticket** and the Calendar's tickets wait on it too.

`PUT /api/integrations/slack/client` takes `{ clientId, clientSecret?, redirectUri, callbackPort, scope }`.
`parseSlackClient` accepts a nonempty subset of `SLACK_USER_SCOPES`, with commas or whitespace as separators, and an HTTPS redirect.
It answers 400 for an HTTP redirect, an unknown scope, a bad port, or an HTTPS loopback redirect that reuses the callback port.
The save writes the existing user server on `mcp.slack.com`, or a new `slack` server, through omp's locked config writer.
The writer keeps owner-only file permissions and leaves every other server, top-level list, header, timeout, `callbackPath`, and `prompt` in place.
An omitted or empty client secret stays only when the client ID is unchanged.
A new client ID without a new secret is a 400 and does not write.
Saving cancels a Slack sign-in that is waiting.
Changing the client ID or the secret also removes the OAuth credentials omp manages for that server.
Credentials are removed before changing the app identity, so a failed config write cannot leave the old app signed in under the new settings.
If that write fails, the old settings remain, but Slack needs a new sign-in.
Config and credentials have separate native owners, not a shared transaction.
Saving scopes changes the next authorization request, not an existing grant.
Sign-out and a later sign-in leave the saved app in the file.

`PUT /api/integrations/google-calendar/client` and `PUT /api/integrations/gmail/client` take `{ clientId, clientSecret?, callbackPort }` of a Google OAuth client of type Web application, and one client may serve both.
`parseGoogleClient` answers 400 for a client ID that does not end in `.apps.googleusercontent.com` or a bad port.
`saveGoogleClient(id, input)` in `src/integrations.ts` writes every user server on the service's host, `calendarmcp.googleapis.com` or `gmailmcp.googleapis.com`, or a new `google-calendar` or `gmail` server when there is none, the way Slack's save does.
It sets the scope to the service's `GOOGLE_SCOPES` in `src/shared/accounts.ts`, events, the calendar list read-only, and free/busy for Google Calendar and `gmail.modify` alone for Gmail, `prompt: "consent"` so Google issues a refresh token, the callback port, and the redirect `http://localhost:<port>/callback`, which the client must list as an authorized redirect URI.
A sign-in to Google Calendar or Gmail first rewrites a saved server's `oauth.scope` that differs from `GOOGLE_SCOPES`, through `planGoogleScope`, so a client saved when Gmail asked only for `gmail.readonly` asks for the wider grant on its next **Reconnect**.
The same secret, client-change, and credential rules as Slack's apply, since Google ties a refresh token to its client: a new client ID or secret removes every account's server but the first with its sign-in, and signs out of the first.
The workspace links are kept by address, so the accounts added again take their old links.

`PUT /api/integrations/sign-in`, with `{ id, account }`, starts a sign-in the way omp's `/mcp reauth` does: to the Google account `account` names again, to a new Google account when it is `null`, and to Linear's or Slack's one server, which take `null`.
Linear still reads the OAuth endpoints from metadata, registers a client when the authorization server offers registration, and listens on `localhost:3000`.
Slack, Google Calendar, and Gmail refuse to start until `setup.configured` is true, so they do not open an authorization URL that has no client ID.
The flow then receives the saved client ID, client secret, scope, redirect, callback port, callback path, and prompt.
It answers the integration once the flow has the service's authorization address, as `signIn: { phase: "waiting", url }`, which the page opens in a new tab.
When the browser comes back, the server stores the tokens under the server's credential id, where `omp token` finds them.
The stored client secret is the one dynamic registration issued, or the configured secret when registration did not issue one.
That is the secret a later refresh sends.
A Slack grant with no refresh token is not stored.
The Slack app has to enable token rotation, which Slack does not let an app turn back off.
omp otherwise treats a missing token lifetime as one hour, so a refresh-less grant would stop working with no error at save time.
A Linear or Slack sign-in adds the service's HTTP server to the user `mcp.json` only when discovery found no enabled server on the service's host; a Google service gets its first server from its client save.
A new sign-in abandons the one under way.
A failure, or no return within five minutes, shows as `signIn: { phase: "failed", error }` until the next sign-in.
`createSignIn` in `src/sign-in.ts` holds that state, and the status `hold` repeats, for every MCP integration.

`PUT /api/integrations/remove`, with `{ id, account }`, abandons a sign-in under way to what it names and removes the sign-ins omp manages for the server, as omp's `/mcp unauth` does, through `signOutMcp`.
Linear and Slack keep their server in `mcp.json` and, unlike `/mcp unauth`, its `auth` block; a Google account's server leaves `mcp.json` with its sign-in, unless it is the last on its host.
A sign-in that omp does not manage stays, and the route answers an error that says so.
`parseIntegrationTarget` in `src/server/wire.ts` checks both bodies.

`PUT /api/integrations/google-links`, with `{ address, workspaces }`, checked by `parseGoogleLinks`, replaces the absolute workspace directories a Google address's accounts are linked to, none to show them in every workspace, and answers every integration.
The route replaces the whole list, so `toggleLink` in `web/components/integrations/google-accounts.tsx` sends an address's writes one after another, each built on the list the one before saved, and a second toggle before the first answer keeps both.

### MCP servers

`GET /api/mcp-servers` answers `McpServersAnswer` from `src/shared/mcp-servers.ts`: `servers`, one `McpServerRow` for every server omp loads for you, and `configPath`, omp's user `mcp.json`.
`listMcpServers` in `src/omp/mcp.ts` reads them with `loadAllMCPConfigs`, project configs off, and adds the servers omp's user file disables, which that call drops.
Each row has the server's name, transport, URL with `${VAR}` references expanded, host, command, `source` (the config file and whether the page may change it: only omp's own user file), whether omp holds a sign-in for its URL, `status`, `signIn`, and `catalogId`, the catalog entry on its host.

`status` is `disabled`, `integration` for a server on one of `MCP_SERVICES`' hosts, whose status [Integrations](#integrations) reads, `local` for a command, which only an omp session starts, or the outcome of listing the server's tools.
`listMcpTools` in `src/omp/mcp.ts` is the same discovery operation Integrations uses: it connects through omp's own client, `connectToServer` and `listTools`, so streamable HTTP and SSE servers both work, with the server's headers and a Bearer token when omp holds a sign-in, then disconnects.
A 401, a `http_status` failure from the HTTP transport or an `HTTP 401:` error from the SSE one, throws `McpUnauthorized`, distinct from service HTTP API authorization's `McpRefused`.
`remoteStatusOf` reads discovery's 401 as `signed-out` when omp holds no sign-in and `refused` when it does; any other failure is `failing` with its message and HTTP status, as an integration's is.
A server need not require a sign-in, so one that has none is still listed without a token.
An address that does not parse is `failing` with a `null` status.
Integration-host rows delegate to Integrations without probing a second time.
`McpServerStatus` adds `disabled`, `local`, and `integration` to `McpRemoteStatus`, and an integration's `McpConnection` adds `absent` and the server, so each answer carries only the kinds its section can reach.
While a server's sign-in waits on the browser, `hold` on its `SignIn` answers the status last read.

`PUT /api/mcp-servers/add` takes `{ catalog }`, an id in `MCP_CATALOG` from `src/shared/mcp-catalog.ts`, or `{ name, url, transport?, header? }`, checked by `parseMcpServerAdd` in `src/server/wire.ts`: the address must be HTTPS or loopback HTTP, the transport `http` or `sse`, and a header a token name with a value.
A catalog entry refuses a server already on its host and takes its id as the name, or the first of `id-2`, `id-3`, … that is free; an OAuth entry then starts its sign-in, and the route answers the new row, whose `signIn` the page opens.
A server by address must have a name omp's `validateServerName` accepts and no other server has, and is written with its header in `headers`; it starts no sign-in.
Both go through omp's `addMCPServer` into the user `mcp.json`.

`PUT /api/mcp-servers/sign-in` and `PUT /api/mcp-servers/sign-out`, with `{ name }`, sign in and out as the integrations' routes do, with a `createSignIn` per server name; they refuse a local server and an integration's.
`PUT /api/mcp-servers/enabled`, with `{ name, enabled }`, calls omp's `setMcpServerEnabled`, as `/mcp enable` and `/mcp disable` do, and `PUT /api/mcp-servers/remove`, with `{ name }`, calls `removeMCPServer`, as `/mcp remove` does, keeping omp's sign-in; both refuse a server from any file but omp's user `mcp.json`.
A refusal, such as a taken name, is `McpServerRejected`, which the routes answer as a 400 with its message.

### Providers

`GET /api/providers` answers `ProvidersAnswer` from `src/shared/providers.ts`: `providers`, one `ModelProvider` for each provider omp files `/login` credentials under, and `login`, the sign-in the page last started.
`listProviders` in `src/omp/providers.ts` groups omp's available `getOAuthProviders` entries by `storeCredentialsAs ?? id`, so `openai-codex-device` joins `openai-codex` and `zai-coding-plan` joins `zai` as further `methods`.
Each provider's `accounts` are its stored credential rows as `/logout` lists them, and `envKey` names the environment variable omp reads its key from when `keys.source` finds nothing stored.
The store opens and closes on each read, so a `/login` in a terminal shows at the next one; the page reads every minute, and every second while a sign-in runs.

`PUT /api/providers/login`, with `{ method }`, the `/login` entry, starts that sign-in on the server and answers the providers and the new `login`.
`createProviderLogins` in `src/provider-logins.ts` keeps one sign-in at a time: a new one aborts the one under way, and one not done within five minutes fails.
While it runs, `login` is `{ phase: "running", url, instructions, progress, prompt }`, from the flow's `onAuth`, `onProgress`, and `onPrompt` callbacks; the page shows the address as a link rather than opening it, since a device-code sign-in shows its code first.
`prompt` is `{ id, message, placeholder, secret, allowEmpty }`, and `PUT /api/providers/login/answer`, with `{ prompt, value }`, resolves the `onPrompt` call that asked it, or answers 409 once the flow no longer waits on that question.
For the paste-code providers, omp asks for the code or redirect address while its local callback also listens, and whichever comes first finishes the sign-in.
A sign-in ends as `{ phase: "done", identity }`, after `ModelRegistry.refreshProvider` re-reads the provider's models, or `{ phase: "failed", error }`, and stays until the next one starts or `PUT /api/providers/login/cancel`, which also aborts one under way.
A flow that stores nothing, such as Ollama's with an empty key, fails, as `omp login` reports it.

`PUT /api/providers/sign-out`, with `{ provider, credentialId }`, removes that row through omp's `logoutCredential`, which refreshes the provider's models, and answers the providers after.
`parseLoginMethod`, `parseLoginAnswer`, and `parseProviderSignOut` in `src/server/wire.ts` check the bodies.

### Google Calendar

`src/google-calendar.ts` reads and writes Google Calendar's REST API (`https://www.googleapis.com/calendar/v3`) with the token omp holds for each account's Google Calendar MCP server, so the Calendar page needs no sign-in of its own.
Google Calendar's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested the same scopes.
Each `GoogleCalendarClient` and each `GmailClient` reads with its account's sign-in, through the `SignedFetch` that `accountClients` in `src/google-accounts.ts` hands it; Slack's check calls `integrationFetch("slack")` in `src/integrations.ts`, which signs with the service's first server.
Both are `signedFetch` in `src/signed-fetch.ts`, which knows nothing of omp, over `mcpBearer` in `src/omp/mcp.ts`, the token omp holds for that server.
`signedFetch` sends that token with a GET, or, given an `ApiWrite`, with a POST of its `body` as JSON or a DELETE.
A 401 throws the bearer's refusal: `mcpBearer`'s forgets the token and the tool list and throws `McpRefused`.
Any other failure throws an `ApiError` from `src/signed-fetch.ts` with the answer's status and the API's `error.message`.
An empty answer, such as a 204, is `null`.
`GET /api/google` answers a `GoogleStatus`, `{ calendars, failed }`: the calendars checked in each signed-in account's Google Calendar list (`calendarList`, `selected`), each with its `account`, its id, the name you gave it or else its own, its color, its `group`, its `writable` flag, its `shown` flag, and the error of its last read, and in `failed` each account whose list could not be read, with why.
`GoogleCalendars` reads every account's list at once, so one failing account leaves the others' calendars in the answer.
`group` is `mine` for a calendar whose `accessRole` is `owner`, Google Calendar's **My calendars**, and `other` for the rest, its **Other calendars**.
`writable` is true for an `accessRole` of `owner` or `writer`, the calendars a new event may go in.
`shown` is false for a calendar unchecked in the Calendar page's sidebar.
`PUT /api/google/calendars` takes `{ account, id, shown }`, checked by `parseCalendarShown` in `src/server/wire.ts`, saves the choice in `calendars.json`, and answers the calendars as `GET /api/google` does.
`src/server/calendars-file.ts` keeps there, as `{ hidden }`, each account's hidden calendar ids by its server's name, and each account's `GoogleCalendarClient` reads its own set on each call.
A file from before accounts holds one list of ids, the first Google Calendar server's whatever its name; it waits under the key `""`, which names no server, until the dashboard's start gives it to the first server on `calendarmcp.googleapis.com`.
With no calendar checked in an account's Google Calendar list, that account's events read is an error that asks you to check one there; with every checked calendar hidden in the sidebar, it answers no events.
`GET /api/calendar/events?from=<ISO time>&to=<ISO time>` reads at most 62 days of every signed-in account, and reads each account's list and each shown calendar's events at most once a minute, unless `fresh` asks again; a hidden calendar's events are not read.
An account whose events cannot be read is left out of the answer while another answers, and only when none can is the answer an error.
Each calendar's `events` read uses `singleEvents=true`, so Google expands repeating events with their removed and moved repeats, and follows `nextPageToken` to the last page.
Canceled events, events you declined, working-location events, and events with no length are left out, and Google's exclusive all-day end becomes the last included day.
An event carries its `account`, its calendar's id, Google's event id, which differs for each repeat, and its calendar's `writable` flag, and it links to the event in Google Calendar.
One calendar that cannot be read keeps its error for the Integrations row while the others still answer; only when none of an account's can is that account's read an error.
The Calendar page reads the open month's events through `calendarEventsStore` in `web/reads.ts` every minute while any Google Calendar account's connection is `ready` or `failing`, and puts a multi-day event on each day it covers.
It shows the calendars and events of the accounts `visibleAccounts` keeps for the sidebar's workspace, grouped in its sidebar under each account's address.
The Calendar tab's sidebar reads the calendars through `googleStore`, and a checkbox's `PUT` reads both stores again, so the open month changes at once.
Each successful calendar save merges that calendar's confirmed visibility into `googleStore` before rereading, so an aborted or failed refresh cannot undo it.
The server deletes the `google.json` that an older version kept the calendars' secret iCal addresses in when it starts.

### New and local events

`PUT /api/calendar/events/new` takes a `NewEvent`, `{ title, when, calendar }`, checked by `parseNewEvent` in `src/server/wire.ts`, and answers a `NewEventAnswer`, `{ kept }`: the event as kept on this computer, or `null` for one added to Google Calendar.
The title is trimmed, nonempty, and at most 500 characters; `when` is `{ allDay: true, firstDay, lastDay }` with `YYYY-MM-DD` days, the last not before the first, or `{ allDay: false, start, end }` in epoch milliseconds with the end after the start.
`calendar`, a `NewEventCalendar`, is `{ kind: "local" }` or `{ kind: "google", account, calendarId }`, and the new-event dialog offers only the calendars of the accounts the page shows.
A Google calendar goes through `GoogleCalendarClient.create`, which refuses a calendar not checked in your Google Calendar's list or not `writable`, and otherwise posts the event to the calendar's `events` with its `summary` and `start` and `end`: `{ date }` for an all-day event, whose end Google takes as the day after the last, or `{ dateTime }` in ISO time.
It then forgets that calendar's kept event reads, which the client keeps per calendar, so the next read shows the event.
This computer adds the event to `events.json` beside the access token, through `LocalEventsFile` in `src/server/local-events-file.ts`, with a `crypto.randomUUID()` id; a file it cannot read moves to `events.json.invalid`.
`parseEventWhen` in `src/shared/calendar.ts` checks an event's `when` both for `parseNewEvent` and for each event that file keeps.
`GET /api/calendar/local` answers every kept event, since only what you typed by hand is there, and the page lays out the days of the month it shows.
`PUT /api/calendar/events/delete` takes an `EventRef`, checked by `parseEventRef`: `{ kind: "local", id }` deletes that kept event if it is still there, and `{ kind: "google", account, calendarId, eventId }` goes through that account's `GoogleCalendarClient.delete`; it answers `{}`.
`GoogleCalendarClient.delete` refuses a calendar not checked in your Google Calendar's list or not `writable` before asking Google, as `create` does, and otherwise sends a DELETE to the event's address under the calendar's `events`, without `sendUpdates`.
The client counts an `ApiError` of 404 or 410 as deleted, since Google answers 410 for an event deleted a moment ago and 404 once it is purged, so deleting twice ends the same way.
A repeat's event id deletes only that repeat; the client then forgets that calendar's kept event reads, so the next read leaves the event out.
The Calendar page reads the kept events through `localEventsStore` in `web/reads.ts` every minute, with or without Google Calendar.
The page owns what a write changes: it adds the kept event that `PUT /api/calendar/events/new` answers to that store, or reads the month of an event added to Google Calendar again; after a delete it takes a kept event out of `localEventsStore`, or reads the open month's events again, and the delete button stays busy until that read settles.

### Gmail

`GmailClient` in `src/gmail.ts` reads one account's Gmail REST API (`https://gmail.googleapis.com/gmail/v1/users/me`) with the token omp holds for that account's Gmail MCP server, so the Inbox page needs no sign-in of its own; `GmailAccounts` merges every signed-in account's inbox and routes each thread read and write by its `account`.
Gmail's MCP tools answer only for OAuth clients enrolled in Google's Workspace Developer Preview Program, while the API answers any client that requested `gmail.modify`.
The client reads, replies, and moves conversations to Trash; it never deletes mail for good, labels it otherwise, or marks it read.
`GET /api/gmail/inbox` answers an `InboxAnswer` from `src/shared/gmail.ts`, `{ accounts, threads }`: each signed-in account with the error its read failed with, or `null`, and the `MailThread`s of every account's inbox merged newest first, the latest 50 threads of each (`threads?labelIds=INBOX&maxResults=50`).
The page names each account by the address its integration account holds, the one source of an account's address.
An account whose read fails keeps its error while the others answer; only when every account fails is the answer an error.
Each thread is read with `format=metadata` and only its `From` and `Subject` headers, eight at a time.
A `MailThread` holds its `account`, the thread id, the display name of the last message's sender or else its address, the first message's subject, the thread's snippet with its HTML entities decoded, the last message's `internalDate`, whether any message carries the `UNREAD` label, the number of messages, and a link that opens the thread in Gmail under its inbox's address.
A thread without an id, messages, or an arrival time is left out, and one that cannot be read fails its account's read with Google's message, so an account's list never has a silent gap.
The client keeps the answer for a minute, unless `fresh` asks again.
The signed-in address is kept for a minute too, so opening a conversation right after the inbox's read reads no profile.
The Inbox page and its sidebar tab read it through `gmailStore` in `web/reads.ts` every minute while any Gmail account's connection is `ready` or `failing`; otherwise the page shows Gmail's integration row.
The page lists the threads of the accounts `visibleAccounts` keeps for the sidebar's workspace, each tagged with its address while it lists several, and the sidebar's Inbox tab narrows the list to one account.

`GET /api/gmail/thread?account=<account>&id=<thread id>[&fresh]` answers a `ThreadAnswer`, `{ account, id, subject, url, messages }`, from that account's `GmailClient.thread`, which reads `threads/<id>?format=full`; a request without an account or an id is a 400.
Drafts are left out as the inbox leaves them out, the subject is the first message's, and the link is the inbox's.
Each `MailMessage` holds its id, the people its `From`, `To`, and `Cc` headers name, split at commas outside quoted names and angle brackets, its `internalDate`, its `UNREAD` label, its snippet with entities decoded, its body, and its attachments.
An HTML body is only `{ kind: "html" }` in the answer: `GmailClient` keeps the HTML beside the conversation's read, by message id, and the page loads it on its own, so the conversation's JSON stays small.
The body comes from a walk of the message's MIME tree: in `multipart/alternative` the `text/html` version wins over `text/plain`, any other multipart reads as its first part with a body, and a part that names a file is never a body.
Each text part is decoded from base64url in the `charset` its `Content-Type` names, and in UTF-8 when no decoder knows that charset.
Every part that names a file becomes an attachment, with its name, MIME type, and size; nothing downloads it.
A message without an id or an arrival time is left out, and each conversation is kept for a minute per id.
The page keeps the conversations it read in memory only, by id, through `readMailThread` and `useMailThread` in `web/reads.ts`, since bodies are large and private.
It reads a conversation once, reads the next and previous ones of the list ahead while one shows, and reads one again from Gmail on **Refresh**, or when the inbox lists a message that arrived after the last read.

Each `MailMessage` also holds the people its `Reply-To` names, so the page addresses a reply itself: `recipientsOf` in `src/shared/gmail.ts` answers as Gmail does, to the `Reply-To`, else the sender, or to the recipients of a message you sent; replying to all copies everyone else in its `To` and `Cc`, and your address is never a recipient.
The page's editor, `MailEditor` in `web/components/inbox/mail-editor.tsx`, is Lexical with rich text, lists, links, and history; it sends the HTML `$generateHtmlFromNodes` writes and the root's text content.
The draft it shows has one owner, `useMailDraft` in `web/mail-draft.ts`: a `MailDocument` of people, subject, and the editor's document as JSON, `""` while it holds no text, which changes only on the events `mailDraftAfter` takes, such as editing a field, choosing **Reply** or **Reply all**, and beginning or ending.
`useReplyDraft` captures a reply's people from the conversation's last message when the reply begins and again only when you choose the other mode, so a refreshed or newly arrived message leaves the draft as it is.
The hook keeps the draft in localStorage under `omp-agents.mail-draft.thread.<thread id>`, or `omp-agents.mail-draft.new` for a new mail, while any field differs from how it began, as `draftUnchanged` compares them, and removes it once none does.
`decodeMailDraft` in `web/mail-draft.ts` reads a kept draft at that boundary: a draft with a missing or mistyped field, or a body Lexical cannot restore, reads as none.
Sending goes through the same hook, as `sendMailDraft` in `web/mail-draft.ts` runs it: the draft's phase moves from editing to sending, in which `mailDraftAfter` refuses every edit and the editor disables its fields, toolbar, and Lexical's editable, so the document submitted is the one shown.
A failed delivery moves it back to editing with the error, and a delivered one closes the draft first and only then removes its localStorage copy, so a removal that throws is logged and leaves the mail sent instead of offering to send it again.
`PUT /api/gmail/reply` takes a `MailReply`, `{ account, thread, to, cc, bcc, html, text }`, and `PUT /api/gmail/send` a `MailSend`, `{ account, to, cc, bcc, subject, html, text }`, whose `account` is the one it sends from, checked by `parseMailReply` and `parseMailSend` in `src/server/wire.ts`: at most `MAX_RECIPIENTS` people, each with a valid address, at least one of them, a text that is not blank, bodies of at most `MAX_MAIL_BODY` characters, and a subject of at most 1000 with its line breaks dropped; each answers `{}`.
`GmailClient.reply` reads the conversation again with `format=metadata` and the `Subject`, `Message-ID`, and `References` headers, and answers its last message other than a draft.
`mailOf` writes the RFC 2822 message: `To`, `Cc`, and `Bcc`, RFC 2047 encoded words for a name or subject outside ASCII, and a `multipart/alternative` body of base64 UTF-8 `text/plain` then `text/html`; `replyOf` adds `Re: ` before a subject that lacks it and `In-Reply-To` and `References` from the answered message so Gmail threads it.
The client sends it as base64url `raw` to `messages/send`, with the conversation's `threadId` for a reply.
`PUT /api/gmail/trash` takes a `MailTrash`, `{ account, thread }`, and that account's `GmailClient.trash` posts `threads/<id>/trash`; Gmail keeps it 30 days.
Each write drops the kept inbox and that conversation, so the next read asks Gmail.
Google's 403 for insufficient scopes becomes an error that says to sign in to Gmail again in **Settings › Integrations**.

`GET /api/gmail/message?account=<account>&thread=<thread id>&id=<message id>` serves a message's HTML as a document of its own, built by `mailDocument` in `src/server/mail-document.ts`, from that account's `GmailClient.messageHtml`, which reads the conversation's kept read, so opening a conversation asks Gmail nothing more.
A request without all three is a 400, and a message the conversation does not hold, or whose body is not HTML, is a 404.
`mailDocument` drops every tracking pixel from the message, through Bun's `HTMLRewriter`: an `<img>` whose width and height, each the smallest of its attribute and its inline `width`/`max-width` or `height`/`max-height` in pixels, are both at most 3px.
An image that declares only one side, a larger side, or a size in other units stays, so a 1×20 spacer keeps the layout it holds.
The page frames that address, not a `srcdoc`: a `srcdoc` document inherits the page's `Content-Security-Policy` from `web/index.html`, whose `img-src` no message can widen, so a message's images never loaded.
Widening the page's own policy is no answer, since it guards the whole dashboard, rendered transcripts too.
The frame keeps `sandbox="allow-same-origin"` and nothing else.
Without `allow-scripts` the message's scripts and event handlers never run, and the sandbox also blocks its forms, its popups, and a `<meta http-equiv="refresh">`, so it cannot navigate the frame.
That makes `allow-same-origin` safe, and the page needs it to size the frame to the message, to open the message's links in a new tab with no opener or referrer, and to pass keys pressed inside it on to the page's shortcuts.
`MailFrame` sizes the frame once the message's document is parsed, not on `load`, which waits for every image: a tracking pixel whose server never answers kept a message zero pixels tall.
A `ResizeObserver` then grows the frame as images arrive.
The document's response carries the policy `sandbox allow-same-origin; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:`, so a message loads images, styles, and fonts and nothing else.
Its `sandbox` directive keeps scripts off even when the address opens in a tab of its own.
The response also sends `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`, and the document's head, which comes before the message's markup, holds `<meta name="referrer" content="no-referrer">` too.
The frame's request is a same-origin GET with the login cookie, so it passes the API's guards like any other read.
Remote images still load, so a sender who tracks opens with them sees the dashboard's request, without a referrer.
The frame sits on white in both themes, since mail is written for white.

## Front-end components

The page uses [Fluid Functionalism](https://www.fluidfunctionalism.com/) components in their Radix flavor, installed with the shadcn CLI into `web/components/ui`.
The roster uses `sidebar`, and its **Pull requests**, **Tickets**, **Sessions**, **Todo**, **Calendar**, **Inbox**, and **Settings** switch uses `tabs`, installed from `https://www.fluidfunctionalism.com/r/radix/tabs.json`.
User and assistant turns use `chat-message`, and the composer uses `input-message`.
Tool calls and the model's thinking use shadcn's Base UI `trace`, vendored as `web/components/ui/trace.tsx` on `web/components/ui/collapsible.tsx`, and code blocks in messages its `code-block`, vendored as `web/components/ui/code-block.tsx`.
The utilities both use from shadcn's `tailwind.css`, such as `shimmer` and `scroll-fade-x`, are copied into `web/shadcn.css`, since that file's `scroll-fade` would clash with the page's own.
`thinking-indicator` shows while the agent works.
`Button`'s `loading` prop preserves its label's width, shows a spinner, disables the control, and sets `aria-busy`.
`InputMessage` takes `sending` and `stopping` for its send and Stop controls.
shadcn's `message-scroller` follows streaming content, preserves the reader's scroll position, and supplies the jump-to-latest button.
The model, thinking, and workspace pickers use shadcn's `popover` and `command` combobox pattern, and the Calendar page's day cards shadcn's `hover-card`.
Fluid's sidebar rail, mobile drawer, cookie, and toggle shortcut are removed from the vendored sidebar, which keeps only the bordered panel.
The dashboard sizes and toggles each sidebar in `web/components/sidebar-panel.tsx`, which gives each its own width and open state, because Fluid's provider held only one of each.
Sidebar widths and the split between panes share `web/components/drag-separator.tsx`: `useDragSeparator` owns the pointer capture, arrow keys, and double-click reset, and `Separator` is the element.
Each call site still clamps its own domain, pixels for a sidebar and a ratio for a split.

The pull request detail tabs use `web/components/segmented-tabs.tsx`, a reusable Radix Tabs wrapper with T3's 24px segmented styling.
Radix owns automatic arrow-key selection, roving focus, and the tab-to-panel ARIA links.
`presentChecks` in `web/pull-request-checks.ts` derives the status line and attention, running, and completed groups from `PullRequestDetail.checkRuns`.
The check transport remains `{ name, state, url }`, with no timing or separate workflow-approval fields.
Skipped checks stay in the completed group but never count as passed.

The sidebar rows' menus use Base UI's `ContextMenu` for right-click and its `Menu` for the **⋯** button, wrapped in `web/components/ui/menu.tsx` with the look of the `popover` and `command` items.
Both share Base UI's menu items, so each row builds one item list and both menus render it.
The wrapper also opens the context menu on the context-menu key and Shift+F10 at the focused row, because not every platform sends a `contextmenu` event for them.

The Pull requests page's open tabs use `web/pull-request-tabs.ts` and the same `useStoredState` localStorage mechanism as the sidebar layout.
The page shares one ordered strip between windows and stores no active tab, since its route says which PR shows.
A session's or project's PRs sidebar has no strip; `SessionPullRequestsTab` holds the PR it shows and its detail tab in component state, keyed by the session or project, so nothing is stored.
Only the main PR detail registers the copy-number, copy-link, and close-tab shortcuts.
While `PullRequestDetailPage` is mounted it tells the desktop shell through `window.ompDesktop.ownsClose`, and the Electron window's `before-input-event` then bypasses native menu shortcuts for Cmd+W, so the page can prevent the native Close action without the shell knowing the dashboard's routes.

Every fixed list of choices uses shadcn's Base UI `select`, vendored as `web/components/ui/select.tsx` with the menu's popup and row look, in place of the browser's `<select>`.
`FormDialog` is Base UI's `Dialog`, so a `Select` in its form opens and takes focus there; Esc in one of the form's Radix pickers closes only the picker.

Toasts use Base UI's `Toast` through one manager in `web/components/toaster.tsx`, since the page has no Fluid or shadcn toast; they stack at the bottom right in the `popover` look.

Questions use `web/components/question-card.tsx`, the dashboard's own card in the look of Fluid's `ask-user-questions`, which `web/components/user-request.tsx` fills from omp's request.
A select is one row per omp option, and a confirm is **Yes** and **No** rows, both in `question-options.tsx`, which reuses Fluid's hover highlight and merged selection backgrounds; an input or an editor is a free-text field.
A terminal session's select takes its checked rows from the request, since omp sends a multi-select pick back as a new request with the row checked.
A dashboard session's `ask` request holds every question; `AskCard` keeps the picks and typed text of each, shows multi-select rows as checkboxes, and sends one `ask` answer after the last question.

Changes the dashboard makes to Fluid's components are listed in `web/components/ui/PATCHES.md`, each with its reason, so an upgrade is a merge that checks each entry.
The dashboard keeps them mechanical where it can.
`InputMessage`'s text field is `PromptEditor` instead of a `<textarea>`, and gets an `onKeyDown` and `onPaste` passthrough, so the completion list and the composer shortcuts see a key before the submit handling and a pasted file attaches, and a `stopShortcut`.
It also gets two slots, `beforeEditor` and `afterActions`: `composer-queue.tsx` renders the queued rows that omp or the server holds into the first, and `composer-suggestions.tsx` into the second the prompts that the last turn's reply ends on, which `splitSuggestions` in `src/transcript.ts` splits off the reply into the assistant item's `suggestions`.
Its own queue, history recall, and suggested prompts are removed, since those slots replace them.
`ChatMessage` gets `files`, the names of the files a sent prompt carried as text, and `images`, the addresses of the images it carried.

Markdown uses `react-markdown` and `remark-gfm` (`web/components/message-markdown.tsx`).
A fenced code block renders as a `CodeBlock`, colored line by line by `highlightLines` in `web/code-highlight.ts`, the `lowlight` grammars the changes view uses, rather than shadcn's `shiki` hook, so the page bundles one highlighter.
In agent text, raw HTML is escaped, unsafe link schemes are filtered, and an image renders as a link unless it is a `data:` URL or a path to an image or video on this computer, which `LocalMedia` in `web/components/local-media.tsx` shows through `GET /api/media`.
In agent text, `remarkFilePaths` in `web/file-paths.ts` turns a path to a text, image, or video file into a link, and that link, like a `file://` one, renders as a `FileLink` from `web/components/file-link.tsx`, which opens the file dialog through the dashboard context.
It then ends the text with a `figure` naming the images and videos those links name, each once, but for those an image already shows; `MediaStrip` draws it as thumbnails, each dropping out when its file does not load.
A `file://` address whose escapes do not decode renders as a link with no address, and text from GitHub keeps no `file://` path, since it renders through the default filter.
A relative path resolves against `FileBaseContext`: the pane's session worktree, from `SessionFacts.worktree`, else its directory, or the directory of the file the dialog shows.
Text from GitHub, which means pull request descriptions and comments, and Linear issues' text, renders its raw HTML through `rehype-raw` and then `rehype-sanitize` with its default schema, which follows GitHub's, plus a `<video>` and its `<source>`, each with only a `src`.
It shows GitHub's avatars and images from the route for a Linear issue's files, and shows images and plays videos uploaded to GitHub through `GET /api/github-media`; a video from anywhere else, and any other image, renders as a link.
`web/index.html` sets the page's `Content-Security-Policy`.
