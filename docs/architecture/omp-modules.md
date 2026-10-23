# omp modules

The server imports omp's own modules from the installed package, so it does not reimplement a protocol, the encryption, or the session-file format, and it always speaks the same version as the sessions it shows.
`src/omp/modules.ts` loads every module once and checks at startup that each export this app uses exists, naming the omp version and the missing export when one does not.
It finds the package through `omp` on `PATH`, or `OMP_PACKAGE_DIR` when set; with a Bun global install that is `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent`.
`bun run omp-release` checks a new omp release against these modules and the files listed below; the [omp release skill](../../.agents/skills/omp-release/SKILL.md) says how to read its report.

Paid Cursor fallback is an external OMP runtime change, preserved in [`patches/omp-18.12.3-paid-cursor-fallback.patch`](../../patches/omp-18.12.3-paid-cursor-fallback.patch) with its regression tests.
Its base is upstream tag `v18.12.3`, commit `53a0377db6845e0dae606146130766ec92d407fd`; do not apply it to another release without porting and verifying it.
From a clean checkout of that release, check and apply the patch:

```sh
git apply --check /absolute/path/to/omp-agents/patches/omp-18.12.3-paid-cursor-fallback.patch
git apply /absolute/path/to/omp-agents/patches/omp-18.12.3-paid-cursor-fallback.patch
```

Build and install both patched packages, `@oh-my-pi/pi-ai` and `@oh-my-pi/pi-coding-agent`, including the CLI bundle and SDK sources and declarations.
The dashboard does not apply this patch at startup, and installing or upgrading stock OMP removes the runtime changes.
The [routing policy](../../templates/omp/agent/docs/model-routing.md) describes the opt-in `retry.paidFallback` setting and its billing limits.

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
  `RpcClient` drops `extension_ui_request` and `session_info_update` frames, so `src/omp/rpc.ts` reads them from its own copy of omp's stdout (`UNROUTED_FRAMES`); see [Dashboard sessions](dashboard-sessions.md).
  `RpcClient`'s `spawn` option may return any process with `pid`, `exited`, `stdin`, `stdout`, `peekStderr`, and `kill` (`RpcAgentProcess`); `start()` waits for omp's `ready` line, sends `negotiate_protocol` when it offers protocol 2, then `set_host_tools`, and a stdout that ends makes it call `kill`; see [Session keepers](dashboard-sessions.md#session-keepers).
  omp answers `negotiate_protocol` again whenever it is sent (`rpc-mode.ts`), and `RpcFrameDecoder` throws on a chunk sequence that does not start at index 0 or that another frame interrupts; omp writes a frame over 1 MB as such a sequence.
  `get_state` reports `isStreaming`, `isCompacting`, and `hasPendingAsyncWork` (`AgentSession.hasPendingAsyncWork`, a running background job whose result will start the agent again), and `get_subagents` returns `RpcSubagentSnapshot`s with the fields of a subagent lifecycle frame.
  `agent_end` carries `isTerminal: false` while an async delivery remains, such as a background job, so a turn that started one stays running until the job delivers.
  omp's eval kernels and subagents spawn with Bun's `detached`, as session leaders of their own (`pi-coding-agent/src/eval/kernel-base.ts`, `task/executor.ts`), and its background jobs lead process groups of their own, so only a walk of the process tree finds them, and only while omp runs.
  `get_available_models` returns omp's whole `Model` objects, with `name`, `contextWindow`, `api`, `identity`, and `serviceTiers`; `get_state` adds `fastModeEnabled` and `fastModeActive`, and `setFastMode` sends `set_fast_mode`.
  `RpcClient.prompt` resolves with the request id once omp admitted the prompt, and `onPromptResult` delivers that prompt's `prompt_result` (`rpc-prompt-results.ts`); see [Dashboard sessions](dashboard-sessions.md).
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
- Side answers: `streamSimple` in `pi-ai/src/stream.ts`, with `resolveRoleSelection` in `pi-coding-agent/src/config/model-resolver.ts` and `ModelRegistry`'s `refresh`, `getAvailable`, `getApiKey`, and `resolver` in `pi-coding-agent/src/config/model-registry.ts`, which `answerDiscussion` in `src/omp/discussion.ts` uses to answer **Ask about this** with one model call outside every session; see [Ask about this](ask-about-this.md).
  It reads the `smol` and `default` roles from the user's settings (`Settings.loadReadOnly` with `HOME` as its directory), so a project's `modelRoles` do not apply, and it loads no extension's custom provider.
- MCP: `pi-coding-agent/src/mcp/json-rpc.ts` (`callMCP`), `config.ts` (`loadAllMCPConfigs`), `client.ts` (`connectToServer`, `listTools`, `disconnectServer`), `oauth-credentials.ts` (`removeManagedMcpOAuthCredentials`), `oauth-discovery.ts` (`discoverOAuthEndpoints`), `oauth-flow.ts` (`MCPOAuthFlow`), and `config-writer.ts` (`addMCPServer`, `updateMCPServer`, `removeMCPServer`, `setMcpServerEnabled`, `validateServerName`, `readMCPConfigFile`), which `src/omp/mcp.ts` wraps for the tickets page, Settings › Integrations, and Settings › MCP servers.
  The MCP sign-ins and sign-outs read and write omp's credential store through the same `discoverAuthStorage`, opened and closed on each call.
  `pi-coding-agent/src/commands/token.ts` uses `refreshStoredManagedMcpOAuthCredential` from `oauth-credentials.ts` to refresh a managed token and persist its rotated refresh token before printing the access token.
- Completions: `pi-tui/src/autocomplete.ts`, and the skills and slash commands in `pi-coding-agent/src/extensibility/`.
- Paths: `pi-utils/src/dirs.ts`, which names omp's sessions directory, and `getWorktreesDir`, its directory of isolation sandboxes.
- Isolation sandboxes: `ISOLATION_OWNER_FILE` and `hasLiveIsolationOwner` in `pi-coding-agent/src/task/isolation-ownership.ts`, the marker `ensureIsolation` in `task/worktree.ts` writes and the check of its process id and start time, and `stopRetainedMount` in `pi-coding-agent/src/cli/worktree-cli.ts`, the teardown `omp worktree clear` runs on a retained mount, which `src/omp/isolation.ts` hands the sweep; see [Isolation sandboxes](routines.md#isolation-sandboxes).
- Daemon brokers: `collectReports` and `scopeClient` in `pi-coding-agent/src/cli/ps-data.ts`, what `omp ps` lists without starting a broker and the client whose `stop` ends one generation of a service, `TERMINAL_STATES` in `pi-tui/src/apps/ps-data.ts`, the states with no process behind them, and `canonicalProjectDir` in `pi-coding-agent/src/launch/paths.ts`, the directory a project's broker is keyed by, which `src/omp/daemons.ts` hands the process watch; see [Session processes](session-processes.md).
- Request usage: `omp-stats/src/aggregator.ts` (`getDashboardStats`, `getToolDashboardStats`, `getTimeRangeConfig`), `rollup.ts` (`getProviderTimeSeries`), `live.ts` (`statsLive`), and `db.ts` (`initDb`).
  `src/omp/stats.ts` reads omp-stats' database and starts its live sync on its first read, which the provider check makes at startup.
  `pi-catalog/src/models.ts` provides `getBundledModel` and `calculateCost`, which `listPrice` in `src/omp/stats.ts` uses to price Claude Code and Codex requests.
  `pi-catalog/src/types.ts` defines their model and usage arguments, including Anthropic's cache-write lifetimes.
- Request context: `buildSessionContext` in `pi-coding-agent/src/session/session-context.ts`, the messages a request on a branch sends, `Tokenizer` in `pi-agent-core/src/tokenizer.ts`, and `resolveModelTokenizer` in `pi-catalog/src/model-tokenizer.ts`, which `src/omp/context-index.ts` uses to count each request's context sources; `getStatsDbPath` in `pi-utils/src/dirs.ts` places its index beside omp-stats' database.
- Request errors: `is402BillingCapBody` in `pi-ai/src/error/rate-limit.ts`, the test omp's credential rotation applies to a 402, which `creditRuns` in `src/omp/stats.ts` uses to tell a provider out of prepaid credits from a 402 that asks for a smaller request.
  `classifyMessage`, `is`, `Flag.UsageLimit`, and `Flag.Transient` in `pi-ai/src/error/flags.ts`, and `extractRetryHint` in `pi-utils/src/fetch-retry.ts`, tell a turn that a usage limit or a transient connection or provider fault ended, and the wait a limit's error names, for `turnFailureOf` in `src/omp/turn-failure.ts`; see [Dashboard sessions](dashboard-sessions.md).
- Updates: `getLatestRelease` in `pi-coding-agent/src/cli/update-cli.ts`, the `startup.checkUpdate` and `update.channel` readers in `pi-coding-agent/src/modes/settings.ts`, and `classifyModel` in `pi-catalog/src/identity/index.ts`, which `src/omp/release.ts` and `src/omp/model-updates.ts` use; see [Notifications](notifications.md).
