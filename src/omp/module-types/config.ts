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
	/** The workspace's layer: `.omp/settings.json` and the other project files omp merges, without the global one. */
	getProjectSettings(): Record<string, unknown>;
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
	/** {@link id} split at its dots, the path it sits at within a settings layer. */
	readonly segments: readonly string[];
	readonly definition: { protocolDefault?: readonly string[] };
	readonly type: "boolean" | "string" | "number" | "enum" | "array" | "record";
	readonly default: unknown;
	/** Settings-panel metadata; `undefined` for a setting only `config.yml` edits. */
	readonly ui: SettingUi | undefined;
	/** A credential, which omp never prints. */
	readonly isCredential: boolean;
	/** The environment variable that can supply the value. */
	readonly envName: string | undefined;
	pinDefault(settings: OmpSettingsInstance): void;
	readonly enumValues: readonly string[] | undefined;
	/** @throws Error when `value` does not fit the setting. */
	assertWritable(value: unknown): void;
	set(settings: OmpSettingsInstance, value: unknown): void;
	setEntry(settings: OmpSettingsInstance, key: string, value: unknown): void;
	/** Stages the removal of the key from the global `config.yml`, so the workspace's value, the variable's, or the default applies. */
	unset(settings: OmpSettingsInstance): void;
	/** The layer the value in effect comes from; `"env"` when {@link envName} overrides the settings. */
	provenance(settings: OmpSettingsInstance): "env" | "runtime" | "overlay" | "project" | "global" | "default";
}
export interface SettingsRegistryModule {
	all(): readonly SettingHandle[];
	lookup(id: string): SettingHandle | undefined;
}
/** omp's settings-panel metadata for one setting (pi-tui src/overlays/settings-defs.ts `AnyUiMetadata`). */
export interface SettingUi {
	tab: string;
	group?: string;
	label: string;
	description: string;
	warning?: string;
	/** The name of a check, private to omp's terminal, that hides the row when false. */
	condition?: string;
	options?: readonly SettingOption[] | "runtime";
	secret?: boolean;
	ordered?: boolean;
	editor?: "json";
}
export interface SettingOption {
	value: string;
	label: string;
	description?: string;
}
/** omp's registry in the order its settings panel walks it (src/config/all-settings.ts). */
export interface AllSettingsModule {
	orderedSettings(): readonly SettingHandle[];
}
/** What omp's settings panel shows a setting as (pi-tui src/overlays/settings-defs.ts `SettingsDisplayEntry`). */
export interface SettingsDisplayEntry {
	path: string;
	type: string;
	defaultValue: unknown;
	ui?: SettingUi;
	enumValues?: readonly string[];
	credential?: boolean;
}
/** The control omp's settings panel edits a setting with (`SettingDef`). */
export type SettingDef = { path: string; schemaType: string; label: string; description: string; warning?: string; tab: string; group?: string } & (
	| { type: "boolean" }
	| { type: "enum"; values: readonly string[] }
	| { type: "submenu"; options: readonly SettingOption[] }
	| { type: "text"; secret: boolean }
	| { type: "providerLimits" }
	| { type: "multiselect"; options: readonly SettingOption[]; ordered: boolean }
);
/** omp's settings-panel layout: its tabs in order, each one's label and group order, and each setting's control. */
export interface SettingsDefsModule {
	SETTING_TABS: readonly string[];
	TAB_METADATA: Record<string, { label: string }>;
	/** Each tab's settings in its group order, the rows omp leaves without a control left out. */
	getSettingsForTab(entries: readonly SettingsDisplayEntry[], tab: string): SettingDef[];
	/** The number a numeric choice stands for, `-1` for `default`; `undefined` when it is not numeric. */
	numericOption(value: string): number | undefined;
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
/** omp's release lookup (src/cli/update-cli.ts), the one `omp update` makes. */
export interface UpdateCliModule {
	getLatestRelease(options: { timeoutMs: number; channel: string }): Promise<{ version: string }>;
}
export interface UpdateSettingsModule {
	cfgStartupCheckUpdate: SettingsReader<boolean>;
	cfgUpdateChannel: SettingsReader<string>;
}
