/**
 * Every module this app loads from the installed omp package, in one place. The module location is the user's
 * omp install, only known at runtime, so each is a dynamic import; the interfaces below are the subset this app
 * reads, trusted through a cast. Each load checks the exports it lists, so an omp whose internals moved fails here at
 * startup, naming the omp version and the export, instead of as a `TypeError` inside some later request.
 */
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Database } from "bun:sqlite";
import type { RetrySettings } from "../shared/models";
import type { Access, CollabSocket, HostSnapshot, LinkErrorCode } from "./collab";
import { ompVersion, packageDir } from "./install";
import type { AutocompleteProvider, FileSlashCommand, Skill } from "./prompts";
import type { RpcClient } from "./rpc";

export interface ParsedLink {
	wsUrl: string;
	key: Uint8Array;
	writeToken?: Uint8Array;
}

export interface RegistryModule {
	listCollabHosts(): Promise<HostSnapshot[]>;
	resolveCollabHostLink(selector: string, access: Access): Promise<{ generation: number; access: Access; url: string }>;
	CollabLinkError: new (...args: never[]) => Error & { code: LinkErrorCode };
}
export interface ProtocolModule {
	COLLAB_PROTO: number;
	parseCollabLink(link: string): ParsedLink | { error: string };
}
export interface CryptoModule {
	importRoomKey(raw: Uint8Array): Promise<CryptoKey>;
}
export interface RelayModule {
	CollabSocket: new (opts: { wsUrl: string; role: "guest"; key: CryptoKey }) => CollabSocket;
}

/** Subset of omp's `SessionInfo` (src/session/session-listing.ts) this app reads. */
export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	title?: string;
	modified: Date;
	firstMessage: string;
}
export interface ListingModule {
	listAllSessions(storage: unknown, sessionsRoot: string): Promise<SessionInfo[]>;
	/** Scans the `*.jsonl` files `storage` lists in `sessionDir`; omp's scan cache skips files whose stat did not change. */
	listSessionsReadOnly(sessionDir: string, storage: unknown): Promise<SessionInfo[]>;
	isEmptySession(session: SessionInfo): boolean;
}
/** omp's `FileSessionStorage` (src/session/session-storage.ts); the listing's scan cache recognises it by class. */
export interface StorageModule {
	FileSessionStorage: new () => { listFilesSync(dir: string, pattern: string): string[] };
}
export interface DirsModule {
	getSessionsDir(): string;
	getAgentDir(): string;
	/** omp's user-level MCP config, `mcp.json` in the agent directory. */
	getMCPConfigPath(scope: "user"): string;
	getBlobsDir(): string;
	/** omp-stats' database, `stats.db` in omp's data root. */
	getStatsDbPath(): string;
}
/** Subset of omp's `SessionEntry` (src/session/session-entries.ts); the header has `type: "session"`. */
export interface FileEntry {
	type: string;
	id: string;
	parentId?: string | null;
}
export interface LoaderModule {
	loadEntriesFromFile(filePath: string): Promise<FileEntry[]>;
}
/** omp's session context (src/session/session-context.ts): the messages a request on the branch ending at `leafId` sends. */
export interface SessionContextModule {
	buildSessionContext(entries: FileEntry[], leafId: string | null, byId: Map<string, FileEntry>): { messages: object[] };
}
/** omp's tokenizer (pi-agent-core src/tokenizer.ts): exact counts for the catalog's tokenizer families, else about 4 bytes a token. */
export interface TokenizerModule {
	Tokenizer: new (model: { tokenizer?: string; api: string; provider: string; id: string }) => {
		countMessage(message: object): number;
		countTokens(text: string, mode: "approximate"): number;
	};
}
export interface ModelTokenizerModule {
	/** The tokenizer family pi-catalog knows `modelId` by, `undefined` when it knows none. */
	resolveModelTokenizer(modelId: string, provider: string): string | undefined;
}
export interface ExitDiagnosticsModule {
	createInterruptedTurnAbortMessage(
		entries: readonly FileEntry[],
		fallbackModel?: { api: string; provider: string; model: string },
	): object | undefined;
}

/** omp's `RpcAgentProcess` (src/modes/rpc/rpc-client.ts): the transport `RpcClient` drives, which `ptree.ChildProcess` implements. */
export interface RpcProcess {
	readonly pid: number;
	readonly exited: Promise<number>;
	readonly stdin: { write(data: string): unknown; flush?(): unknown };
	readonly stdout: ReadableStream<Uint8Array>;
	peekStderr(): string;
	kill(reason?: unknown, graceMs?: number): void;
}
/**
 * Subset of omp's `RpcClientCustomTool` (src/modes/rpc/rpc-client.ts): a tool this process serves to the session over RPC.
 * omp's adapter (src/modes/rpc/host-tools.ts) makes it strict, so `parameters` sets `additionalProperties: false` and
 * requires every property, an optional one as nullable; without `loadMode: "essential"` omp only makes it discoverable.
 * A thrown error reaches the model as the tool's error.
 */
export interface RpcHostTool {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	loadMode: "essential";
	execute(params: Record<string, unknown>, context: { toolCallId: string; signal: AbortSignal }): Promise<string>;
}
export interface RpcClientModule {
	/** `customTools` are sent with every `start()`, so a new process for the same session gets them again. */
	RpcClient: new (options: { spawn: (agentArgs: string[]) => RpcProcess; args: string[]; customTools: RpcHostTool[] }) => RpcClient;
}
export interface RpcFrameModule {
	/** Reassembles protocol v2 chunk frames from parsed JSONL lines. */
	RpcFrameDecoder: new () => { push(value: unknown): object | undefined };
}
export interface UtilsModule {
	ptree: { spawn(cmd: string[], options: { cwd: string; stdin: "pipe" }): RpcProcess };
	readJsonl(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown>;
}

export interface AutocompleteModule {
	CombinedAutocompleteProvider: new (
		commands: { name: string; description?: string }[],
		basePath: string,
	) => AutocompleteProvider;
}
export interface SkillsModule {
	loadSkills(options: Record<string, unknown> & { cwd: string }): Promise<{ skills: Skill[] }>;
	parseSkillInvocation(text: string): { name: string; args: string; prompt: string } | undefined;
	buildSkillPromptMessage(skill: Skill, input: { args: string; prompt?: string }): Promise<{ message: string }>;
}
export interface SlashCommandsModule {
	loadSlashCommands(options: { cwd: string }): Promise<FileSlashCommand[]>;
	expandSlashCommand(text: string, fileCommands: FileSlashCommand[]): string;
}

/** omp settings descriptors (`register`/`combine` in src/config); `get` reads one from a loaded Settings. */
export interface SettingsReader<T> {
	get(settings: unknown): T;
}
/** Subset of omp's `Settings` (src/config/settings.ts) this app reads and writes. */
export interface OmpSettingsInstance {
	/** `modelRoles` as configured, in config order. */
	getModelRoles(): Record<string, string>;
	/** Stages one role in the global `config.yml`; `flush` writes it, leaving every other role as it is on disk. */
	setModelRole(role: string, selector: string | undefined): void;
	/** Writes staged changes into the re-read global `config.yml` under omp's lock. */
	flush(): Promise<void>;
}
export interface ConfigModule {
	Settings: {
		loadReadOnly(options: { cwd: string }): Promise<OmpSettingsInstance>;
		/** A private instance that persists what is set on it, unlike omp's process-wide `Settings.init`. */
		loadIsolated(options: { cwd: string }): Promise<OmpSettingsInstance>;
	};
}
/** Subset of omp's `Setting` handle (src/config/registry.ts). `set`/`setEntry` stage a global write; `undefined` removes. */
export interface SettingHandle {
	readonly enumValues: readonly string[] | undefined;
	/** @throws Error when `value` does not fit the setting. */
	assertWritable(value: unknown): void;
	set(settings: OmpSettingsInstance, value: unknown): void;
	setEntry(settings: OmpSettingsInstance, key: string, value: unknown): void;
}
export interface SettingsRegistryModule {
	lookup(id: string): SettingHandle | undefined;
}
export interface ExtensionSettingsModule {
	cfgSkills: SettingsReader<Record<string, unknown> & { enableSkillCommands?: boolean }>;
	cfgDisabledExtensions: SettingsReader<string[]>;
}
export interface SessionSettingsModule {
	cfgRetry: SettingsReader<Omit<RetrySettings, "fallbackRevertPolicy">>;
	cfgRetryFallbackChains: SettingsReader<Record<string, string[]>>;
	cfgRetryFallbackRevertPolicy: SettingsReader<string>;
}
export interface ModelSettingsModule {
	cfgModelProviderOrder: SettingsReader<string[]>;
}
/** Where a provider's credential comes from (pi-ai src/auth/types.ts `CredentialOrigin`). */
export interface CredentialOrigin {
	kind: "runtime" | "config" | "oauth" | "api_key" | "env";
	/** The variable's name when `kind` is `env` and one variable holds the key. */
	envVar?: string;
}
/** One stored credential row (pi-ai src/auth/types.ts `StoredAuthCredential`); the credential's fields stay omp's. */
export interface StoredCredential {
	id: number;
	provider: string;
	credential: { type: "oauth" | "api_key" };
}
/** What a provider's sign-in asks the page for (pi-ai src/registry/oauth/types.ts `OAuthPrompt`). */
export interface OAuthPrompt {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
	secret?: boolean;
}
/** The callbacks a provider's sign-in drives (pi-ai src/auth/types.ts `OAuthLoginController`). */
export interface OAuthLoginController {
	onAuth(info: { url: string; launchUrl?: string; instructions?: string }): void;
	onProgress(message: string): void;
	onPrompt(prompt: OAuthPrompt): Promise<string>;
	onBrowserSession?(request: unknown, signal?: AbortSignal): Promise<string>;
	signal: AbortSignal;
}
/** The account a sign-in stored (pi-ai src/auth/types.ts `OAuthLoginIdentity`). */
export interface OAuthLoginIdentity {
	type: "oauth" | "api_key";
}
/** Subset of omp's `AuthStorage` (pi-ai src/auth-storage.ts) this app reads and writes. */
export interface AuthStorage {
	/** Where `provider`'s credential comes from (a login, a stored key, an environment variable), `undefined` with none. */
	keys: { source(provider: string): CredentialOrigin | undefined };
	/** The stored credential rows, by provider id; an MCP server's sign-in is filed under its credential id. */
	credentials: {
		hasOAuth(provider: string): boolean;
		list(provider: string): StoredCredential[];
		set(provider: string, credential: Record<string, unknown> & { type: "oauth" }): Promise<void>;
	};
	/** Runs `provider`'s `/login` flow and stores what it returns; `undefined` when it stored nothing. */
	oauth: { login(provider: string, controller: OAuthLoginController): Promise<OAuthLoginIdentity | undefined> };
	close(): void;
}
export interface AuthModule {
	/** omp's credential store, through its auth broker when one is configured. */
	discoverAuthStorage(): Promise<AuthStorage>;
}
export interface OAuthModule {
	/** Every provider omp's `/login` offers; `storeCredentialsAs` names the provider its credential is filed under when that differs from `id`. */
	getOAuthProviders(): { id: string; name: string; available: boolean; storeCredentialsAs?: string }[];
}
/** omp's model registry (src/config/model-registry.ts), built over a credential store. */
export interface ModelRegistryModule {
	ModelRegistry: new (storage: AuthStorage) => { refreshProvider(provider: string, strategy: "online"): Promise<void> };
}
/** What `/logout` shows and removes (src/slash-commands/helpers/logout.ts). */
export interface LogoutModule {
	toLogoutAccounts(provider: string, credentials: StoredCredential[]): { credentialId: number; label: string; detail: string; type: "oauth" | "api_key" }[];
	/** Removes credential row `credentialId` of `loginProvider` and refreshes its models; `removed` is false when it was already gone. */
	logoutCredential(registry: InstanceType<ModelRegistryModule["ModelRegistry"]>, loginProvider: string, credentialId: number, sessionId: string): Promise<{ removed: boolean }>;
}
export interface OAuthTerminalModule {
	/** `email (org)`, `email`, or `org` for an OAuth sign-in; `undefined` for an API key or a sign-in that named no account. */
	formatLoginIdentity(identity: OAuthLoginIdentity | undefined): string | undefined;
}
export interface BrowserSessionModule {
	/** Opens an isolated Chromium for a sign-in that reads a cookie, as `/login` does for Perplexity. */
	captureBrowserSession(request: unknown, signal?: AbortSignal): Promise<string>;
}
/** The fields of omp's `Model` (pi-ai src/types.ts) that decide its service tiers. */
export interface ServiceTierModel {
	provider: string;
	api: string;
	identity: { class: string };
	serviceTiers?: string[];
}
export interface ServiceTierModule {
	/** The family whose service-tier knob governs `model`, `undefined` when it has none. */
	serviceTierFamily(model: ServiceTierModel): string | undefined;
	/** Whether omp sends `tier` to `model`'s provider. */
	shouldSendServiceTier(tier: string, model: ServiceTierModel): boolean;
}
export interface FallbackChainsModule {
	/** Gives every chat role without a chain of its own the `default` chain. */
	expandDefaultRetryFallbackChains(configured: Record<string, string[]>, roleNames: readonly string[]): Record<string, string[]>;
	/** omp's reading of a selector: `provider/id`, then an optional `:level` once `find` knows the id without it. */
	parseRetryFallbackSelector(
		selector: string,
		lookup: { find(provider: string, id: string): unknown },
	): { provider: string; id: string; thinkingLevel: string | undefined } | undefined;
}
export interface ModelResolverModule {
	/** The listed model that omp runs for `provider/id`, following retired variant ids such as `grok-4.7-high` and dotted revision spellings. */
	resolveProviderModelReference<M extends { provider: string; id: string }>(provider: string, modelId: string, models: readonly M[]): M | undefined;
}
/** omp's release lookup (src/cli/update-cli.ts), the one `omp update` makes. */
export interface UpdateCliModule {
	getLatestRelease(options: { timeoutMs: number; channel: string }): Promise<{ version: string }>;
}
export interface UpdateSettingsModule {
	cfgStartupCheckUpdate: SettingsReader<boolean>;
	cfgUpdateChannel: SettingsReader<string>;
}
/** pi-catalog's model identity (src/identity): the vendor lineage, product family, and `major.minor.patch` revision an id names. */
export interface ModelIdentityModule {
	classifyModel(provider: string, modelId: string, options: { lenient: true }): { class: string; family?: string; revision?: string };
}
/** pi-catalog's `Model` (src/types.ts), opaque here: what `calculateCost` prices with. */
export interface CatalogModel {
	cost: object;
}
/** The fields of pi-catalog's `Usage` (src/types.ts) that `calculateCost` reads; it writes the prices into `cost`. */
export interface CatalogUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	/** Anthropic's cache writes by lifetime, each billed at its own rate. */
	cttl?: { ephemeral5m: number; ephemeral1h: number };
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}
/** pi-catalog's bundled models (src/models.ts), with the list prices omp records on its own requests. */
export interface CatalogModule {
	/** `undefined` for a provider or model the bundle does not list. */
	getBundledModel(provider: string, modelId: string): CatalogModel | undefined;
	/** Prices `usage` at `timestamp` (ms), with the rate card and long-context tier in force then. */
	calculateCost(model: CatalogModel, usage: CatalogUsage, timestamp: number): CatalogUsage["cost"];
}

/** Subset of omp's capability items (src/capability/types.ts): every item names the file it came from. */
export interface CapabilityItem {
	_source: { provider: string; path: string; level: "user" | "project" | "native" };
}
export interface DiscoveryModule {
	loadCapability(id: string, options: { cwd: string; disabledExtensions?: string[] }): Promise<{ items: CapabilityItem[] }>;
}
export interface AgentDiscoveryModule {
	discoverAgents(cwd: string): Promise<{ agents: { source: string; filePath?: string }[] }>;
}
export interface ConfigFilesModule {
	findConfigFile(subpath: string, options: { user?: boolean; project?: boolean; cwd?: string }): string | undefined;
}
/** omp's document conversion (src/utils/markit.ts), the one its read tool and `@file` arguments use. */
export interface MarkitModule {
	convertBufferWithMarkit(buffer: Uint8Array, extension: string): Promise<{ content: string; ok: boolean; error?: string }>;
}

/** Subset of omp's `JsonRpcResponse` (src/mcp/types.ts). */
export interface McpResponse {
	result?: unknown;
	error?: { code: number; message: string };
}
export interface McpRpcModule {
	/** JSON-RPC 2.0 over HTTP, reading a JSON or `text/event-stream` answer; `onHttpError` maps a non-2xx response to the error thrown. */
	callMCP(
		url: string,
		method: string,
		params: Record<string, unknown>,
		options: { headers?: Record<string, string>; signal?: AbortSignal; onHttpError?: (response: Response, body: string) => Error },
	): Promise<McpResponse>;
}
/** Subset of omp's `MCPServerConfig` (src/mcp/types.ts) this app reads and writes back. Extra fields on a parsed server are kept by spreading it. */
export interface McpServerConfig {
	type?: string;
	url?: string;
	command?: string;
	enabled?: boolean;
	timeout?: number;
	headers?: Record<string, string>;
	auth?: { type: string; credentialId?: string; tokenUrl?: string; clientId?: string; clientSecret?: string; resource?: string };
	oauth?: {
		clientId?: string;
		clientSecret?: string;
		scope?: string;
		redirectUri?: string;
		callbackPort?: number;
		callbackPath?: string;
		prompt?: string;
	};
}
/** Subset of omp's `SourceMeta` (src/capability/types.ts): where omp found a server's config. */
export interface McpSourceMeta {
	/** `native` for omp's own `mcp.json`, else the tool whose config named it, such as `claude`. */
	provider: string;
	providerName: string;
	path: string;
	level: "user" | "project" | "native";
}
export interface McpConfigModule {
	/** The MCP servers omp would start in `cwd`, with where each was found: disabled ones (`disabledServers`, `enabled: false`) left out, `url` env vars not yet expanded. */
	loadAllMCPConfigs(cwd: string, options?: { enableProjectConfig?: boolean }): Promise<{ configs: Record<string, McpServerConfig>; sources: Record<string, McpSourceMeta> }>;
}
/** Subset of omp's `MCPToolDefinition` (src/mcp/types.ts). */
export interface McpToolDefinition {
	name: string;
	description?: string;
}
/** omp's `MCPServerConnection` (src/mcp/types.ts), opaque here: a connected server's transport. */
export interface McpConnection {
	name: string;
}
export interface McpClientModule {
	/** Connects and initializes `config` as omp's sessions do, over its HTTP, SSE, or stdio transport. */
	connectToServer(name: string, config: McpServerConfig, options?: { signal?: AbortSignal }): Promise<McpConnection>;
	/** Every tool the connected server offers, following its cursor. */
	listTools(connection: McpConnection, options?: { signal?: AbortSignal }): Promise<McpToolDefinition[]>;
	disconnectServer(connection: McpConnection): Promise<void>;
}
export interface McpCredentialsModule {
	/** The credential ids omp looks a server's OAuth sign-in up under when its config names none. */
	mcpOAuthCredentialIdsForServerUrl(serverUrl: string | undefined): string[];
	/** Removes the OAuth sign-ins omp manages under `credentialIds`, as `/mcp unauth` does; whether it removed any. */
	removeManagedMcpOAuthCredentials(storage: AuthStorage, credentialIds: readonly (string | undefined)[]): Promise<boolean>;
}
/** Subset of omp's `OAuthEndpoints` (src/mcp/oauth-discovery.ts). */
export interface McpOAuthEndpoints {
	authorizationUrl: string;
	tokenUrl: string;
	issuerUrl?: string;
	clientId?: string;
	/** Dynamic client registration endpoint, when the authorization server offers one. */
	registrationUrl?: string;
	scopes?: string;
	resource?: string;
}
export interface McpOAuthDiscoveryModule {
	/** The OAuth endpoints a server's well-known metadata names, or `null` when it names none. */
	discoverOAuthEndpoints(serverUrl: string): Promise<McpOAuthEndpoints | null>;
}
/** Subset of omp's `MCPOAuthConfig` (src/mcp/oauth-flow.ts). */
export interface McpOAuthConfig {
	authorizationUrl: string;
	tokenUrl: string;
	issuerUrl?: string;
	registrationUrl?: string;
	clientId?: string;
	clientSecret?: string;
	scopes?: string;
	prompt?: string;
	redirectUri?: string;
	callbackPort?: number;
	callbackPath?: string;
	resource?: string;
	/** The `resource` is the server URL, not one the metadata advertised. */
	stripSameOriginResource?: boolean;
}
/** omp's `MCPOAuthFlow` (src/mcp/oauth-flow.ts): an authorization-code flow with PKCE and a local callback server. */
export interface McpOAuthFlow {
	/** Waits for the browser to come back to the callback; resolves with pi-ai's `OAuthCredentials`. */
	login(): Promise<Record<string, unknown>>;
	readonly resolvedClientId: string | undefined;
	readonly registeredClientSecret: string | undefined;
	readonly resource: string | undefined;
	readonly authorizationUrl: string;
}
export interface McpOAuthFlowModule {
	MCPOAuthFlow: new (config: McpOAuthConfig, ctrl: { onAuth(info: { url: string }): void; signal: AbortSignal }) => McpOAuthFlow;
}
export interface McpConfigFile {
	mcpServers?: Record<string, McpServerConfig>;
	disabledServers?: string[];
}
export interface McpConfigWriterModule {
	/** Adds a server to an MCP config file; throws when the file already has one by that name or omp rejects the name or config. */
	addMCPServer(filePath: string, name: string, config: McpServerConfig): Promise<void>;
	/** Replaces one server, or adds it, under the config file lock. The file mode stays owner-only. */
	updateMCPServer(filePath: string, name: string, config: McpServerConfig): Promise<void>;
	/** Removes a server from an MCP config file; throws when the file has none by that name. */
	removeMCPServer(filePath: string, name: string): Promise<void>;
	/**
	 * Enables or disables `name` as omp's `/mcp enable` and `/mcp disable` do: writes `enabled` on the first of the paths that
	 * defines it, else adds it to the user file's `disabledServers` or `enabledServers` list.
	 */
	setMcpServerEnabled(options: { userPath: string; projectPath?: string; sourcePath?: string; name: string; enabled: boolean }): Promise<void>;
	/** The parsed MCP file, or `{ mcpServers: {} }` when it is not there yet. */
	readMCPConfigFile(filePath: string): Promise<McpConfigFile>;
	/** Why omp refuses `name` as a server name, or `undefined` when it accepts it. */
	validateServerName(name: string): string | undefined;
}

export interface DiscoveryHelpersModule {
	/** Expands `${VAR}` references in a string the way omp does for an MCP server's `url`. */
	expandEnvVarsDeep<T>(value: T): T;
}

/** Subset of omp-stats' `AggregatedStats` (src/shared-types.ts): one set of requests. */
export interface StatsUsage {
	totalRequests: number;
	failedRequests: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	cacheRate: number;
	totalCost: number;
	avgTokensPerSecond: number | null;
}
/** Subset of omp-stats' `DashboardStats`. `agentType` is `main`, `subagent`, or `advisor`. */
export interface StatsDashboard {
	overall: StatsUsage;
	byModel: (StatsUsage & { model: string; provider: string })[];
	byAgentType: { agentType: "main" | "subagent" | "advisor"; totalInputTokens: number; totalOutputTokens: number; totalCacheReadTokens: number; totalCacheWriteTokens: number }[];
}
/** Subset of omp-stats' `ToolDashboardStats`. */
export interface StatsToolDashboard {
	byTool: { tool: string; calls: number; errors: number; totalTokensShare: number }[];
}
/** omp-stats' aggregator (src/aggregator.ts). Ranges it does not know read as `24h`. */
export interface StatsAggregatorModule {
	/** `cutoff` is null for all time. */
	getTimeRangeConfig(range: string): { cutoff: number | null; bucketMs: number };
}
/** Subset of omp-stats' `ProviderTimeSeriesPoint` (src/shared-types.ts); `timestamp` starts a bucket. */
export interface StatsProviderPoint {
	timestamp: number;
	provider: string;
	totalTokens: number;
	cost: number;
	requests: number;
}
/** omp-stats' rollup-aware queries (src/rollup.ts), each over requests since `cutoff` (null for all time). */
export interface StatsRollupModule {
	getOverallStats(cutoff: number | null): StatsDashboard["overall"];
	getStatsByModel(cutoff: number | null): StatsDashboard["byModel"];
	getStatsByAgentType(cutoff: number | null): StatsDashboard["byAgentType"];
	getToolStats(cutoff: number | null): StatsToolDashboard["byTool"];
	getProviderTimeSeries(window: { cutoff: number | null; bucketMs: number }): StatsProviderPoint[];
}
/** omp-stats' `LiveSyncStatus` (src/shared-types.ts). */
export interface StatsSync {
	phase: "idle" | "syncing" | "error";
	current: number;
	total: number;
	lastSyncedAt: number | null;
	error: string | null;
}
/** omp-stats' live ingest (src/live.ts): `start` syncs every session file, then watches them; both are idempotent. */
export interface StatsLiveModule {
	statsLive(): { start(): void; stop(): void; status(): { sync: StatsSync } };
}
/** omp-stats' database (src/db.ts): `~/.omp/stats.db`, under omp's config root, opened once. */
export interface StatsDbModule {
	initDb(): Promise<Database>;
}
/** omp's request-error classifier (pi-ai src/error/rate-limit.ts): whether a 402's body names a billing cap, as its credential rotation decides. */
export interface RateLimitModule {
	is402BillingCapBody(message: string | undefined): boolean;
}

type Kind = "function" | "number";

/** The value at a dotted export path such as `Settings.loadReadOnly`. */
function exportAt(mod: unknown, path: string): unknown {
	let value = mod;
	for (const key of path.split(".")) {
		if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}

/** Imports `file` and checks that it has every export in `expected`, by dotted path and `typeof`. */
async function load<T>(file: string, expected: Record<string, Kind>): Promise<T> {
	const name = relative(packageDir, file);
	if (!existsSync(file)) throw new Error(`omp ${ompVersion} does not ship ${name} (omp too old or a compiled build)`);
	const mod: unknown = await import(file);
	for (const [path, kind] of Object.entries(expected)) {
		if (typeof exportAt(mod, path) !== kind) throw new Error(`omp ${ompVersion} does not export ${path} (a ${kind}) from ${name}`);
	}
	return mod as T;
}

const srcDir = join(packageDir, "src");
const utilsSrc = join(dirname(packageDir), "pi-utils", "src");

export const registry = await load<RegistryModule>(join(srcDir, "collab", "registry.ts"), {
	listCollabHosts: "function",
	resolveCollabHostLink: "function",
	CollabLinkError: "function",
});
export const protocol = await load<ProtocolModule>(join(srcDir, "collab", "protocol.ts"), {
	COLLAB_PROTO: "number",
	parseCollabLink: "function",
});
export const crypto = await load<CryptoModule>(join(srcDir, "collab", "crypto.ts"), { importRoomKey: "function" });
export const relay = await load<RelayModule>(join(srcDir, "collab", "relay-client.ts"), { CollabSocket: "function" });

export const listing = await load<ListingModule>(join(srcDir, "session", "session-listing.ts"), {
	listAllSessions: "function",
	listSessionsReadOnly: "function",
	isEmptySession: "function",
});
export const storage = await load<StorageModule>(join(srcDir, "session", "session-storage.ts"), { FileSessionStorage: "function" });
export const loader = await load<LoaderModule>(join(srcDir, "session", "session-loader.ts"), { loadEntriesFromFile: "function" });
export const sessionContext = await load<SessionContextModule>(join(srcDir, "session", "session-context.ts"), { buildSessionContext: "function" });
export const tokenizer = await load<TokenizerModule>(join(dirname(packageDir), "pi-agent-core", "src", "tokenizer.ts"), { Tokenizer: "function" });
export const modelTokenizer = await load<ModelTokenizerModule>(join(dirname(packageDir), "pi-catalog", "src", "model-tokenizer.ts"), {
	resolveModelTokenizer: "function",
});
export const exitDiagnostics = await load<ExitDiagnosticsModule>(join(srcDir, "session", "exit-diagnostics.ts"), {
	createInterruptedTurnAbortMessage: "function",
});
export const dirs = await load<DirsModule>(join(utilsSrc, "dirs.ts"), {
	getSessionsDir: "function",
	getAgentDir: "function",
	getMCPConfigPath: "function",
	getBlobsDir: "function",
	getStatsDbPath: "function",
});

export const rpc = await load<RpcClientModule>(join(srcDir, "modes", "rpc", "rpc-client.ts"), {
	RpcClient: "function",
	"RpcClient.prototype.steerSubagent": "function",
	"RpcClient.prototype.cancelSubagent": "function",
	"RpcClient.prototype.bash": "function",
	"RpcClient.prototype.setFastMode": "function",
	"RpcClient.prototype.onPromptResult": "function",
	// Sends the constructor's `customTools`; the option itself cannot be checked.
	"RpcClient.prototype.setCustomTools": "function",
});
export const rpcFrames = await load<RpcFrameModule>(join(srcDir, "modes", "rpc", "rpc-frame.ts"), { RpcFrameDecoder: "function" });
export const utils = await load<UtilsModule>(join(utilsSrc, "index.ts"), { "ptree.spawn": "function", readJsonl: "function" });

export const autocomplete = await load<AutocompleteModule>(join(dirname(packageDir), "pi-tui", "src", "autocomplete.ts"), {
	CombinedAutocompleteProvider: "function",
});
export const skills = await load<SkillsModule>(join(srcDir, "extensibility", "skills.ts"), {
	loadSkills: "function",
	parseSkillInvocation: "function",
	buildSkillPromptMessage: "function",
});
export const slashCommands = await load<SlashCommandsModule>(join(srcDir, "extensibility", "slash-commands.ts"), {
	loadSlashCommands: "function",
	expandSlashCommand: "function",
});

export const config = await load<ConfigModule>(join(srcDir, "config", "settings.ts"), {
	"Settings.loadReadOnly": "function",
	"Settings.loadIsolated": "function",
});
export const extensionSettings = await load<ExtensionSettingsModule>(join(srcDir, "extensibility", "settings.ts"), {
	"cfgSkills.get": "function",
	"cfgDisabledExtensions.get": "function",
});
export const sessionSettings = await load<SessionSettingsModule>(join(srcDir, "session", "settings.ts"), {
	"cfgRetry.get": "function",
	"cfgRetryFallbackChains.get": "function",
	"cfgRetryFallbackRevertPolicy.get": "function",
});
export const modelSettings = await load<ModelSettingsModule>(join(srcDir, "config", "model-settings.ts"), {
	"cfgModelProviderOrder.get": "function",
});
export const auth = await load<AuthModule>(join(srcDir, "session", "auth-broker-config.ts"), { discoverAuthStorage: "function" });
export const oauth = await load<OAuthModule>(join(dirname(packageDir), "pi-ai", "src", "registry", "oauth", "index.ts"), {
	getOAuthProviders: "function",
});
export const modelRegistry = await load<ModelRegistryModule>(join(srcDir, "config", "model-registry.ts"), {
	ModelRegistry: "function",
	"ModelRegistry.prototype.refreshProvider": "function",
});
export const logout = await load<LogoutModule>(join(srcDir, "slash-commands", "helpers", "logout.ts"), {
	toLogoutAccounts: "function",
	logoutCredential: "function",
});
export const oauthTerminal = await load<OAuthTerminalModule>(join(srcDir, "cli", "oauth-terminal.ts"), { formatLoginIdentity: "function" });
export const browserSession = await load<BrowserSessionModule>(join(srcDir, "utils", "browser-session.ts"), { captureBrowserSession: "function" });
export const serviceTiers = await load<ServiceTierModule>(join(dirname(packageDir), "pi-ai", "src", "types.ts"), {
	serviceTierFamily: "function",
	shouldSendServiceTier: "function",
});
export const fallbackChains = await load<FallbackChainsModule>(join(srcDir, "session", "retry-fallback-chains.ts"), {
	expandDefaultRetryFallbackChains: "function",
	parseRetryFallbackSelector: "function",
});
export const modelResolver = await load<ModelResolverModule>(join(srcDir, "config", "model-resolver.ts"), { resolveProviderModelReference: "function" });
export const settingsRegistry = await load<SettingsRegistryModule>(join(srcDir, "config", "registry.ts"), { lookup: "function" });
export const updateCli = await load<UpdateCliModule>(join(srcDir, "cli", "update-cli.ts"), { getLatestRelease: "function" });
export const updateSettings = await load<UpdateSettingsModule>(join(srcDir, "modes", "settings.ts"), {
	"cfgStartupCheckUpdate.get": "function",
	"cfgUpdateChannel.get": "function",
});
export const modelIdentity = await load<ModelIdentityModule>(join(dirname(packageDir), "pi-catalog", "src", "identity", "index.ts"), {
	classifyModel: "function",
});
export const catalog = await load<CatalogModule>(join(dirname(packageDir), "pi-catalog", "src", "models.ts"), {
	getBundledModel: "function",
	calculateCost: "function",
});

export const discovery = await load<DiscoveryModule>(join(srcDir, "discovery", "index.ts"), { loadCapability: "function" });
export const agentDiscovery = await load<AgentDiscoveryModule>(join(srcDir, "task", "discovery.ts"), { discoverAgents: "function" });
export const configFiles = await load<ConfigFilesModule>(join(srcDir, "config.ts"), { findConfigFile: "function" });
export const markit = await load<MarkitModule>(join(srcDir, "utils", "markit.ts"), { convertBufferWithMarkit: "function" });
export const mcpRpc = await load<McpRpcModule>(join(srcDir, "mcp", "json-rpc.ts"), { callMCP: "function" });
export const mcpConfig = await load<McpConfigModule>(join(srcDir, "mcp", "config.ts"), { loadAllMCPConfigs: "function" });
export const mcpClient = await load<McpClientModule>(join(srcDir, "mcp", "client.ts"), {
	connectToServer: "function",
	listTools: "function",
	disconnectServer: "function",
});
export const mcpCredentials = await load<McpCredentialsModule>(join(srcDir, "mcp", "oauth-credentials.ts"), {
	mcpOAuthCredentialIdsForServerUrl: "function",
	removeManagedMcpOAuthCredentials: "function",
});
export const discoveryHelpers = await load<DiscoveryHelpersModule>(join(srcDir, "discovery", "helpers.ts"), { expandEnvVarsDeep: "function" });
export const mcpOAuthDiscovery = await load<McpOAuthDiscoveryModule>(join(srcDir, "mcp", "oauth-discovery.ts"), {
	discoverOAuthEndpoints: "function",
});
export const mcpOAuthFlow = await load<McpOAuthFlowModule>(join(srcDir, "mcp", "oauth-flow.ts"), { MCPOAuthFlow: "function" });
export const mcpConfigWriter = await load<McpConfigWriterModule>(join(srcDir, "mcp", "config-writer.ts"), {
	addMCPServer: "function",
	updateMCPServer: "function",
	removeMCPServer: "function",
	setMcpServerEnabled: "function",
	readMCPConfigFile: "function",
	validateServerName: "function",
});

const statsSrc = join(dirname(packageDir), "omp-stats", "src");
export const statsAggregator = await load<StatsAggregatorModule>(join(statsSrc, "aggregator.ts"), { getTimeRangeConfig: "function" });
export const statsRollup = await load<StatsRollupModule>(join(statsSrc, "rollup.ts"), {
	getOverallStats: "function",
	getStatsByModel: "function",
	getStatsByAgentType: "function",
	getToolStats: "function",
	getProviderTimeSeries: "function",
});
export const statsLive = await load<StatsLiveModule>(join(statsSrc, "live.ts"), { statsLive: "function" });
export const statsDb = await load<StatsDbModule>(join(statsSrc, "db.ts"), { initDb: "function" });
export const rateLimit = await load<RateLimitModule>(join(dirname(packageDir), "pi-ai", "src", "error", "rate-limit.ts"), { is402BillingCapBody: "function" });
