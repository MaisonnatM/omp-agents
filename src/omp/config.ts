/** omp's config: the settings a session loads, and writing the model routing back through omp's own path. */
import type { RetrySettings, RoutingEdit } from "../shared";
import { ompVersion } from "./install";
import { config, dirs, extensionSettings, fallbackChains, modelSettings, type SettingHandle, sessionSettings, settingsRegistry } from "./modules";

/** omp's user config directory, `~/.omp/agent` unless `PI_CODING_AGENT_DIR` moves it. */
export const agentDir: string = dirs.getAgentDir();
/** Where omp keeps the images it moves out of session files, each in a file named by the SHA-256 of its bytes. */
export const blobsDir: string = dirs.getBlobsDir();

export const { expandDefaultRetryFallbackChains, parseRetryFallbackSelector } = fallbackChains;

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

/**
 * Writes `edit` to the global `config.yml` through omp's own write path, as `omp config set` does: omp re-reads
 * the file under its lock and writes back only the paths the edit set, so every other key survives.
 * The caller has validated `edit`.
 */
export async function writeRouting(cwd: string, edit: RoutingEdit): Promise<void> {
	// Loading a config to write moves one omp cannot parse aside; refuse while it is broken instead.
	await config.Settings.loadReadOnly({ cwd });
	const settings = await config.Settings.loadIsolated({ cwd });
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
