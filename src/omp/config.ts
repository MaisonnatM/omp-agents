/** omp's config: the settings a session loads, and writing the model routing back through omp's own path. */
import { homedir } from "node:os";
import { isObject } from "../json";
import type { CollabAutoStart, TerminalAccess } from "../shared/readiness";
import { type RetrySettings, type RoutingEdit, selectorOf } from "../shared/models";
import { ompVersion } from "./install";
import { collabSettings, config, dirs, extensionSettings, fallbackChains, modelSettings, type OmpSettingsInstance, type SettingHandle, sessionSettings, settingsRegistry } from "./modules";

/** omp's user config directory, `~/.omp/agent` unless `PI_CODING_AGENT_DIR` moves it. */
export const agentDir: string = dirs.getAgentDir();
/** Where omp keeps the images it moves out of session files, each in a file named by the SHA-256 of its bytes. */
export const blobsDir: string = dirs.getBlobsDir();

export const { expandDefaultRetryFallbackChains } = fallbackChains;

/** A model selector as omp reads it: the model's `provider/id`, and what follows them, such as `:high` or `:auto`. */
export interface ReadSelector {
	provider: string;
	id: string;
	suffix: string;
}

/**
 * `selector` as omp's `parseRetryFallbackSelector` reads it against `known`, the `provider/id` of each listed model:
 * a `:level` splits off only once the id without it is listed, so an id that holds a colon stays whole.
 * The model it names need not be listed; {@link resolveSelector} also requires that.
 */
export function readSelector(selector: string, known: ReadonlySet<string>): ReadSelector | null {
	const parsed = fallbackChains.parseRetryFallbackSelector(selector, { find: (provider, id) => (known.has(selectorOf({ provider, id })) ? true : undefined) });
	if (!parsed) return null;
	const { provider, id } = parsed;
	return { provider, id, suffix: selector.trim().slice(selectorOf(parsed).length) };
}

/** {@link readSelector}, when the model `selector` names is one of `known`. */
export function resolveSelector(selector: string, known: ReadonlySet<string>): ReadSelector | null {
	const read = readSelector(selector, known);
	return read && known.has(selectorOf(read)) ? read : null;
}

/** Every selector the routing names: each role's, and each fallback chain's key and entries. */
export const routedSelectors = (routing: Pick<OmpConfig, "modelRoles" | "fallbackChains">): string[] => [
	...Object.values(routing.modelRoles),
	...Object.entries(routing.fallbackChains).flatMap(([key, chain]) => [key, ...chain]),
];

/** omp's config as a session in `cwd` loads it: the global `config.yml`, the project's, and omp's defaults. */
export interface OmpConfig {
	modelRoles: Record<string, string>;
	/** `retry.fallbackChains` as configured, before omp applies the `default` chain to other roles. */
	fallbackChains: Record<string, string[]>;
	retry: RetrySettings;
	modelProviderOrder: string[];
	disabledExtensions: string[];
}

/** Read-only: omp's `loadReadOnly` never writes the config files back. */
export async function loadOmpConfig(cwd: string): Promise<OmpConfig> {
	const settings = await config.Settings.loadReadOnly({ cwd });
	return {
		modelRoles: settings.getModelRoles(),
		fallbackChains: sessionSettings.cfgRetryFallbackChains.get(settings),
		retry: {
			...sessionSettings.cfgRetry.get(settings),
			fallbackRevertPolicy: sessionSettings.cfgRetryFallbackRevertPolicy.get(settings),
		},
		modelProviderOrder: modelSettings.cfgModelProviderOrder.get(settings),
		disabledExtensions: extensionSettings.cfgDisabledExtensions.get(settings),
	};
}

function setting(id: string): SettingHandle {
	const handle = settingsRegistry.lookup(id);
	if (!handle) throw new Error(`omp ${ompVersion} has no setting ${id}`);
	return handle;
}

/** The values omp accepts for `retry.<key>`, or `undefined` when it is not an enum. */
export const retryChoices = (key: keyof RetrySettings): readonly string[] | undefined => setting(`retry.${key}`).enumValues;

/** @throws Error, with omp's message, when omp would not write `value` to `retry.<key>`. */
export const assertRetryValue = (key: keyof RetrySettings, value: unknown): void => setting(`retry.${key}`).assertWritable(value);

/** Loads the global config for a write; refuses while omp cannot parse it, since loading one to write moves it aside. */
async function loadGlobalForWrite(cwd: string): Promise<OmpSettingsInstance> {
	await config.Settings.loadReadOnly({ cwd });
	return config.Settings.loadIsolated({ cwd });
}

/**
 * Writes `edit` to the global `config.yml` through omp's own write path, as `omp config set` does: omp re-reads
 * the file under its lock and writes back only the paths the edit set, so every other key survives.
 * The caller has validated `edit`.
 */
export async function writeRouting(cwd: string, edit: RoutingEdit): Promise<void> {
	const settings = await loadGlobalForWrite(cwd);
	const setChain = (key: string, fallbacks: string[]): void =>
		setting("retry.fallbackChains").setEntry(settings, key, fallbacks.length > 0 ? fallbacks : undefined);
	switch (edit.kind) {
		case "role":
			if (edit.primary !== undefined) settings.setModelRole(edit.role, edit.primary);
			if (edit.fallbacks !== undefined) setChain(edit.role, edit.fallbacks);
			break;
		case "model-chain":
			setChain(edit.key, edit.fallbacks);
			break;
		case "retry":
			for (const [key, value] of Object.entries(edit.values)) setting(`retry.${key}`).set(settings, value);
			break;
		case "provider-order":
			setting("modelProviderOrder").set(settings, edit.providers.length > 0 ? edit.providers : undefined);
			break;
	}
	await settings.flush();
}

function globalCollabAutoStart(settings: OmpSettingsInstance): CollabAutoStart {
	const global = settings.getGlobalSettings();
	const value = (isObject(global.collab) ? global.collab.autoStart : undefined) ?? collabSettings.cfgCollabAutoStart.default;
	if (value === "off" || value === "view" || value === "control") return value;
	throw new Error("omp's global collab.autoStart is not off, view, or control");
}

/** Global terminal publishing, without any workspace's overrides or writes. */
export async function readCollabAutoStart(): Promise<CollabAutoStart> {
	return globalCollabAutoStart(await config.Settings.loadReadOnly({ cwd: homedir() }));
}

/** Stages only `collab.autoStart` as `access` and flushes through omp's locked global config writer; a matching value writes nothing. */
export async function shareTerminalSessions(access: TerminalAccess): Promise<void> {
	const settings = await loadGlobalForWrite(homedir());
	if (globalCollabAutoStart(settings) === access) return;
	setting("collab.autoStart").set(settings, access);
	await settings.flush();
}
