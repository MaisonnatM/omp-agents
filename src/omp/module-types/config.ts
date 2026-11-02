/** omp's paths, settings, and release lookup (pi-utils src/dirs.ts, pi-coding-agent src/config, src/cli/update-cli.ts). */
import type { RetrySettings } from "../../shared/models";

export interface DirsModule {
	getSessionsDir(): string;
	getAgentDir(): string;
	getProjectDir(): string;
	/** omp's user-level MCP config, `mcp.json` in the agent directory. */
	getMCPConfigPath(scope: "user"): string;
	getBlobsDir(): string;
	/** omp-stats' database, `stats.db` in omp's data root. */
	getStatsDbPath(): string;
	/** Where omp puts its task-isolation sandboxes and PR checkouts, `~/.omp/wt` unless `OMP_WORKTREE_DIR` moves it. */
	getWorktreesDir(): string;
}
/** omp settings descriptors (`register`/`combine` in src/config); `get` reads one from a loaded Settings. */
export interface SettingsReader<T> {
	get(settings: unknown): T;
}
/** Subset of omp's `Settings` (src/config/settings.ts) this app reads and writes. */
export interface OmpSettingsInstance {
	/** `modelRoles` as configured, in config order. */
	getModelRoles(): Record<string, string>;
	/** The native global layer, without project/runtime overlays. */
	getGlobalSettings(): Record<string, unknown>;
	/** Stages one role in the global `config.yml`; `flush` writes it, leaving every other role as it is on disk. */
	setModelRole(role: string, selector: string | undefined): void;
	/** Writes staged changes into the re-read global `config.yml` under omp's lock. */
	flush(): Promise<void>;
	/** The shell omp's bash tool and services run commands in, from `shellPath` else the user's. */
	getShellConfig(): { shell: string; args: string[]; env: Record<string, string>; prefix: string | undefined };
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
	readonly id: string;
	readonly definition: { protocolDefault?: readonly string[] };
	pinDefault(settings: OmpSettingsInstance): void;
	readonly enumValues: readonly string[] | undefined;
	/** @throws Error when `value` does not fit the setting. */
	assertWritable(value: unknown): void;
	set(settings: OmpSettingsInstance, value: unknown): void;
	setEntry(settings: OmpSettingsInstance, key: string, value: unknown): void;
}
export interface SettingsRegistryModule {
	all(): readonly SettingHandle[];
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
export interface GoalSettingsModule {
	cfgGoalEnabled: SettingsReader<boolean>;
	cfgGoalContinuationModes: SettingsReader<string[]>;
}
export interface AdvisorConfigModule {
	discoverAdvisorConfigs(cwd: string): Promise<{ advisors: { model?: string; enabled?: boolean }[] }>;
}
export interface AdvisorSettingsModule {
	cfgAdvisorEnabled: SettingsReader<boolean>;
}
/** Opaque native settings passed straight from omp's model resolver to its threshold resolver. */
export type ModelCompactionSettings = Record<string, unknown>;
export interface ModelCompactionSettingsModule {
	resolveModelCompactionSettings(scope: OmpSettingsInstance, model: { provider: string; id: string } | undefined): ModelCompactionSettings;
}
export interface CompactionModule {
	resolveThresholdTokens(window: number, settings: ModelCompactionSettings): number;
}
/** omp's release lookup (src/cli/update-cli.ts), the one `omp update` makes. */
export interface UpdateCliModule {
	getLatestRelease(options: { timeoutMs: number; channel: string }): Promise<{ version: string }>;
}
export interface UpdateSettingsModule {
	cfgStartupCheckUpdate: SettingsReader<boolean>;
	cfgUpdateChannel: SettingsReader<string>;
}
