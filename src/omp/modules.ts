/**
 * Every module this app loads from the installed omp package, in one place. The module location is the user's
 * omp install, only known at runtime, so each is a dynamic import; the interfaces in `module-types/` are the subset
 * this app reads, trusted through a cast. Each load checks the exports it lists, so an omp whose internals moved fails
 * here at startup, naming the omp version and the export, instead of as a `TypeError` inside some later request.
 */
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CollabAutoStart } from "../shared/readiness";
import { ompVersion, packageDir } from "./install";
import type { CryptoModule, ProtocolModule, RegistryModule, RelayModule } from "./module-types/collab";
import type {
	AllSettingsModule,
	AdvisorConfigModule,
	AdvisorSettingsModule,
	CompactionModule,
	ModelCompactionSettingsModule,
	GoalSettingsModule,
	ConfigModule,
	DirsModule,
	GcAutoCompressModule,
	ExtensionSettingsModule,
	ModelSettingsModule,
	SessionSettingsModule,
	SettingsDefsModule,
	SettingsRegistryModule,
	UpdateCliModule,
	UpdateSettingsModule,
} from "./module-types/config";
import type {
	AgentDiscoveryModule,
	AgentReadOnlyModule,
	AgentRootsModule,
	AgentPluginRootsModule,
	AutocompleteModule,
	ConfigFilesModule,
	ConfigFileSourcesModule,
	CustomCommandsModule,
	DiscoveryModule,
	MarkitModule,
	SkillsModule,
	SlashCommandsModule,
} from "./module-types/discovery";
import type { MarketplaceModule, PluginManagerModule, PluginEntriesModule, SkillClientModule, SkillInstallerModule, SkillManifestModule } from "./module-types/extensions";
import type {
	DiscoveryHelpersModule,
	McpClientModule,
	McpConfigModule,
	McpConfigWriterModule,
	McpCredentialsModule,
	McpOAuthDiscoveryModule,
	McpOAuthFlowModule,
	McpRpcModule,
} from "./module-types/mcp";
import type {
	HindsightBankModule,
	HindsightClientModule,
	HindsightConfigModule,
	LocalMemoryModule,
	MemoryBackendModule,
	MemoryRedactModule,
	MnemopiConfigModule,
	MnemopiStateModule,
	SharpshooterPathsModule,
	SharpshooterQueueModule,
	SharpshooterTypesModule,
} from "./module-types/memory";
import type {
	AccountPolicyModule,
	AuthModule,
	BrowserSessionModule,
	CatalogModule,
	FallbackChainsModule,
	LogoutModule,
	ModelIdentityModule,
	ModelRegistryModule,
	ModelResolverModule,
	OAuthModule,
	OAuthTerminalModule,
	ServiceTierModule,
} from "./module-types/models";
import type {
	IsolationOwnershipModule,
	LaunchClientModule,
	LaunchPathsModule,
	OvnfsClientModule,
	OvnfsDaemonModule,
	OvnfsTaskModule,
	PsDataModule,
	PsTableModule,
	WorktreeCliModule,
} from "./module-types/processes";
import type { RpcClientModule, RpcFrameModule, UtilsModule } from "./module-types/rpc";
import type {
	ExitDiagnosticsModule,
	ListingModule,
	LoaderModule,
	ModelTokenizerModule,
	SessionContextModule,
	SessionEntriesModule,
	SessionPathsModule,
	StorageModule,
	TokenizerModule,
} from "./module-types/session";
import type { ModelRolesModule, RpcDictationModule, SttControllerModule, SttModelsModule, SttSettingsModule } from "./module-types/speech";
import type {
	ErrorFlagsModule,
	FetchRetryModule,
	RateLimitModule,
	StatsAggregatorModule,
	StatsDbModule,
	StatsLiveModule,
	StatsRollupModule,
} from "./module-types/stats";

type Kind = "function" | "number" | "object" | "string";

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

export const collabSettings = await load<{ cfgCollabAutoStart: { readonly default: CollabAutoStart } }>(join(srcDir, "collab", "settings.ts"), {
	"cfgCollabAutoStart.default": "string",
});

/** Read-only plugin registries; no CLI config initialization or project discovery writes. */
export const marketplaceRegistry = await load<{
	getMarketplacesRegistryPath(): string;
	getInstalledPluginsRegistryPath(): string;
	getMarketplacesCacheDir(): string;
	getPluginsCacheDir(): string;
	readMarketplacesRegistry(path: string): Promise<{ marketplaces: { name: string }[] }>;
	readInstalledPluginsRegistry(path: string): Promise<{ plugins: Record<string, unknown> }>;
}>(join(srcDir, "extensibility", "plugins", "marketplace", "registry.ts"), {
	getMarketplacesRegistryPath: "function",
	getInstalledPluginsRegistryPath: "function",
	readMarketplacesRegistry: "function",
	getMarketplacesCacheDir: "function",
	getPluginsCacheDir: "function",
	readInstalledPluginsRegistry: "function",
});
export const pluginRegistryDiscovery = await load<{
	resolveOrDefaultProjectRegistryPath(cwd: string): Promise<string | undefined>;
	clearClaudePluginRootsCache(): void;
}>(join(srcDir, "discovery", "helpers.ts"), {
	resolveOrDefaultProjectRegistryPath: "function",
	clearClaudePluginRootsCache: "function",
});

export const marketplaceManager = await load<MarketplaceModule>(join(srcDir, "extensibility", "plugins", "marketplace", "manager.ts"), {
	MarketplaceManager: "function",
	...Object.fromEntries(["listMarketplaces", "listAvailablePlugins", "listInstalledPlugins", "checkForUpdates", "addMarketplace", "removeMarketplace", "updateMarketplace", "installPlugin", "uninstallPlugin", "setPluginEnabled", "upgradePlugin"].map(name => [`MarketplaceManager.prototype.${name}`, "function" as const])),
});
export const pluginManager = await load<PluginManagerModule>(join(srcDir, "extensibility", "plugins", "manager.ts"), {
	PluginManager: "function",
	...Object.fromEntries(["list", "install", "link", "uninstall", "upgrade", "validateUpgrade", "setEnabled"].map(name => [`PluginManager.prototype.${name}`, "function" as const])),
});
export const pluginEntries = await load<PluginEntriesModule>(join(srcDir, "extensibility", "plugins", "loader.ts"), { resolvePluginManifestEntries: "function" });
export const skillClient = await load<SkillClientModule>(join(srcDir, "skillshare", "client.ts"), { "SkillshareClient.create": "function", "SkillshareClient.prototype.search": "function", "SkillshareClient.prototype.close": "function" });
export const skillInstaller = await load<SkillInstallerModule>(join(srcDir, "skillshare", "installer.ts"), {
	listInstalledSkills: "function", installSkillPackages: "function", updateSkillPackages: "function", uninstallSkillPackages: "function",
});
export const skillManifest = await load<SkillManifestModule>(join(srcDir, "skillshare", "manifest.ts"), {
	parseSkillId: "function", getSkillStorePath: "function", getSkillsInstallPaths: "function",
});

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
	findSessionContinuation: "function",
});
export const storage = await load<StorageModule>(join(srcDir, "session", "session-storage.ts"), { FileSessionStorage: "function" });
export const loader = await load<LoaderModule>(join(srcDir, "session", "session-loader.ts"), {
	loadEntriesFromFile: "function",
	visitEntriesFromFileStream: "function",
});
export const sessionEntries = await load<SessionEntriesModule>(join(srcDir, "session", "session-entries.ts"), { resolveSessionLeafId: "function" });
export const sessionPaths = await load<SessionPathsModule>(join(srcDir, "session", "session-paths.ts"), { sessionDirForCwd: "function" });
export const sessionManager = await load<{
	SessionManager: {
		/** Retitles a file no process here loads, under omp's lease on the session; `null` when it did not, as when another process holds it. */
		renameSessionTitle(sessionPath: string, title: string, options?: { cwd?: string }): Promise<string | null>;
	};
}>(join(srcDir, "session", "session-manager.ts"), { SessionManager: "function", "SessionManager.renameSessionTitle": "function" });
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
	getPluginsDir: "function",
	getProjectDir: "function",
	getMCPConfigPath: "function",
	getBlobsDir: "function",
	getStatsDbPath: "function",
	getWorktreesDir: "function",
	getHistoryDbPath: "function",
	getCustomSessionFilesDir: "function",
	hashPath: "function",
});

export const gcAutoCompress = await load<GcAutoCompressModule>(join(srcDir, "cli", "gc-auto-compress.ts"), { GC_AUTO_COMPRESS_LOG: "string" });

export const rpc = await load<RpcClientModule>(join(srcDir, "modes", "rpc", "rpc-client.ts"), {
	RpcClient: "function",
	"RpcClient.prototype.steerSubagent": "function",
	"RpcClient.prototype.cancelSubagent": "function",
	"RpcClient.prototype.bash": "function",
	"RpcClient.prototype.setFastMode": "function",
	"RpcClient.prototype.goal": "function",
	"RpcClient.prototype.setAutoCompaction": "function",
	"RpcClient.prototype.onPromptResult": "function",
	// Sends the constructor's `customTools`, and a reattached session's; the option itself cannot be checked.
	"RpcClient.prototype.setCustomTools": "function",
});
/** omp's frame codec, which a session keeper (`src/keeper.ts`) also loads to read omp's output frame by frame. */
export const rpcFrameFile = join(srcDir, "modes", "rpc", "rpc-frame.ts");
export const rpcFrames = await load<RpcFrameModule>(rpcFrameFile, { RpcFrameDecoder: "function" });
export const utils = await load<UtilsModule>(join(utilsSrc, "index.ts"), { readJsonl: "function" });

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
	"Settings.isolated": "function",
	"Settings.loadIsolated": "function",
	"Settings.prototype.getGlobalSettings": "function",
	"Settings.prototype.getProjectSettings": "function",
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
export const goalSettings = await load<GoalSettingsModule>(join(srcDir, "goals", "settings.ts"), { "cfgGoalEnabled.get": "function", "cfgGoalContinuationModes.get": "function" });
export const advisorSettings = await load<AdvisorSettingsModule>(join(srcDir, "advisor", "settings.ts"), { "cfgAdvisorEnabled.get": "function" });
export const advisorConfig = await load<AdvisorConfigModule>(join(srcDir, "advisor", "config.ts"), { discoverAdvisorConfigs: "function" });
export const modelCompactionSettings = await load<ModelCompactionSettingsModule>(join(srcDir, "session", "model-compaction-threshold.ts"), { resolveModelCompactionSettings: "function" });
export const compaction = await load<CompactionModule>(join(dirname(packageDir), "pi-agent-core", "src", "compaction", "compaction.ts"), { resolveThresholdTokens: "function" });
export const auth = await load<AuthModule>(join(srcDir, "session", "auth-broker-config.ts"), { discoverAuthStorage: "function" });
export const accountPolicy = await load<AccountPolicyModule>(join(dirname(packageDir), "pi-ai", "src", "auth", "policy.ts"), { matchesAuthAccountSelector: "function" });
export const oauth = await load<OAuthModule>(join(dirname(packageDir), "pi-ai", "src", "registry", "oauth", "index.ts"), {
	getOAuthProviders: "function",
});
export const modelRegistry = await load<ModelRegistryModule>(join(srcDir, "config", "model-registry.ts"), {
	ModelRegistry: "function",
	"ModelRegistry.prototype.refreshProvider": "function",
	"ModelRegistry.prototype.refresh": "function",
	"ModelRegistry.prototype.getAvailable": "function",
	"ModelRegistry.prototype.getAll": "function",
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
export const modelResolver = await load<ModelResolverModule>(join(srcDir, "config", "model-resolver.ts"), {
	resolveProviderModelReference: "function",
	resolveAgentModelSelection: "function",
	resolveModelOverride: "function",
	resolveRoleChain: "function",
});
export const modelRoles = await load<ModelRolesModule>(join(srcDir, "config", "model-roles.ts"), { roleCandidatePool: "function" });
export const sttSettings = await load<SttSettingsModule>(join(srcDir, "stt", "settings.ts"), {
	"cfgSttEnabled.get": "function",
	"cfgSttEnabled.provenance": "function",
	"cfgSttLanguage.get": "function",
});
export const sttModels = await load<SttModelsModule>(join(srcDir, "stt", "models.ts"), { resolveSttModelSpec: "function" });
export const sttController = await load<SttControllerModule>(join(srcDir, "stt", "stt-controller.ts"), { STTController: "function" });
export const rpcDictation = await load<RpcDictationModule>(join(srcDir, "modes", "rpc", "rpc-dictation.ts"), {
	RpcDictationBridge: "function",
	"RpcDictationBridge.prototype.start": "function",
	"RpcDictationBridge.prototype.stop": "function",
	"RpcDictationBridge.prototype.dispose": "function",
});
export const settingsRegistry = await load<SettingsRegistryModule>(join(srcDir, "config", "registry.ts"), { lookup: "function", all: "function" });
export const allSettings = await load<AllSettingsModule>(join(srcDir, "config", "all-settings.ts"), { orderedSettings: "function" });
export const settingsDefs = await load<SettingsDefsModule>(join(dirname(packageDir), "pi-tui", "src", "overlays", "settings-defs.ts"), {
	SETTING_TABS: "object",
	TAB_METADATA: "object",
	getSettingsForTab: "function",
	numericOption: "function",
});
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

export const discovery = await load<DiscoveryModule>(join(srcDir, "discovery", "index.ts"), {
	loadCapability: "function", reset: "function", initializeWithSettings: "function", getAllProvidersInfo: "function", isForeignUserProvider: "function", isUserSourceEnabled: "function",
});
export const customCommands = await load<CustomCommandsModule>(join(srcDir, "extensibility", "custom-commands", "loader.ts"), {
	discoverCustomCommands: "function",
});
export const agentDiscovery = await load<AgentDiscoveryModule>(join(srcDir, "task", "discovery.ts"), { discoverAgents: "function" });
export const agentReadOnly = await load<AgentReadOnlyModule>(join(srcDir, "task", "read-only-policy.ts"), { isReadOnlyAgent: "function" });
export const agentRoots = await load<AgentRootsModule>(join(srcDir, "discovery", "omp-extension-roots.ts"), { listOmpExtensionRoots: "function" });
export const agentPluginRoots = await load<AgentPluginRootsModule>(join(srcDir, "discovery", "helpers.ts"), { listClaudePluginRoots: "function" });
export const configFiles = await load<ConfigFilesModule>(join(srcDir, "config.ts"), { findConfigFile: "function", getConfigDirPaths: "function" });
export const configSources = await load<ConfigFileSourcesModule>(join(srcDir, "utils", "config-file-sources.ts"), { configFileSources: "function" });
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
export const rateLimit = await load<RateLimitModule>(join(dirname(packageDir), "pi-ai", "src", "error", "rate-limit.ts"), { isBillingCapUsageLimit: "function" });
export const errorFlags = await load<ErrorFlagsModule>(join(dirname(packageDir), "pi-ai", "src", "error", "flags.ts"), {
	"Flag.UsageLimit": "number",
	"Flag.Transient": "number",
	classifyMessage: "function",
	is: "function",
});
export const fetchRetry = await load<FetchRetryModule>(join(utilsSrc, "fetch-retry.ts"), { extractRetryHint: "function" });
export const isolationOwnership = await load<IsolationOwnershipModule>(join(srcDir, "task", "isolation-ownership.ts"), {
	ISOLATION_OWNER_FILE: "string",
	hasLiveIsolationOwner: "function",
});
export const worktreeCli = await load<WorktreeCliModule>(join(srcDir, "cli", "worktree-cli.ts"), { stopRetainedMount: "function" });
export const ovnfsTask = await load<OvnfsTaskModule>(join(srcDir, "task", "ovnfs.ts"), { OVNFS_CHECKOUT_FILE: "string" });
export const ovnfsDaemon = await load<OvnfsDaemonModule>(join(srcDir, "ovnfs", "daemon.ts"), { runningDaemon: "function", forgetDaemon: "function" });
export const ovnfsClient = await load<OvnfsClientModule>(join(srcDir, "ovnfs", "client.ts"), { callSocket: "function", OvnfsError: "function" });
export const psData = await load<PsDataModule>(join(srcDir, "cli", "ps-data.ts"), { collectReports: "function", scopeClient: "function" });
export const psTable = await load<PsTableModule>(join(dirname(packageDir), "pi-tui", "src", "apps", "ps-data.ts"), { TERMINAL_STATES: "object" });
export const launchPaths = await load<LaunchPathsModule>(join(srcDir, "launch", "paths.ts"), { canonicalProjectDir: "function" });
export const launchClient = await load<LaunchClientModule>(join(srcDir, "launch", "client.ts"), { createDaemonBrokerClient: "function" });
export const memoryBackend = await load<MemoryBackendModule>(join(srcDir, "memory-backend", "index.ts"), { resolveMemoryBackend: "function" });
export const memoryRedact = await load<MemoryRedactModule>(join(srcDir, "memory-backend", "redact.ts"), { redactMemorySecrets: "function" });
export const localMemory = await load<LocalMemoryModule>(join(srcDir, "memories", "index.ts"), { getMemoryRoot: "function" });
export const sharpshooterPaths = await load<SharpshooterPathsModule>(join(srcDir, "sharpshooter", "paths.ts"), { sharpshooterBankDir: "function" });
export const sharpshooterTypes = await load<SharpshooterTypesModule>(join(srcDir, "sharpshooter", "types.ts"), { SHARPSHOOTER_MEMORY_FILES: "object" });
export const sharpshooterQueue = await load<SharpshooterQueueModule>(join(srcDir, "sharpshooter", "queue.ts"), { sharpshooterQueueDepth: "function" });
export const mnemopiConfig = await load<MnemopiConfigModule>(join(srcDir, "mnemopi", "config.ts"), { loadMnemopiConfig: "function" });
export const mnemopiState = await load<MnemopiStateModule>(join(srcDir, "mnemopi", "state.ts"), {
	getMnemopiScopedBanks: "function",
	getMnemopiScopedDbPaths: "function",
	loadMnemopiCore: "function",
	loadMnemopi: "function",
});
export const hindsightConfig = await load<HindsightConfigModule>(join(srcDir, "hindsight", "config.ts"), {
	loadHindsightConfig: "function",
	isHindsightConfigured: "function",
});
export const hindsightBank = await load<HindsightBankModule>(join(srcDir, "hindsight", "bank.ts"), { computeBankScope: "function" });
export const hindsightClient = await load<HindsightClientModule>(join(srcDir, "hindsight", "client.ts"), { createHindsightClient: "function" });
