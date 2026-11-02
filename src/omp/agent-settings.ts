/**
 * omp's own settings as its terminal settings panel lays them out, read from the registry and the panel's definitions,
 * and one setting's write to the user's `config.yml` through omp's handle.
 */
import type { AgentSettingControl, AgentSettingEdit, AgentSettingOption, AgentSettingRow, AgentSettings, AgentSettingTab } from "../shared/agent-settings";
import { HOME } from "../paths";
import { loadGlobalForWrite } from "./config";
import type { OmpSettingsInstance, SettingDef, SettingHandle, SettingOption, SettingsDisplayEntry } from "./module-types/config";
import { allSettings, config, settingsDefs, settingsRegistry } from "./modules";

const TERMINAL_PREFIXES = ["tui.", "statusLine.", "display.", "theme.", "composer.", "terminal."];
const TERMINAL_IDS: Record<string, true> = { symbolPreset: true, colorBlindMode: true };
/** omp's panel shows these rows only in a terminal that can draw them. */
const TERMINAL_CONDITIONS: Record<string, true> = { hasImageProtocol: true, nativeRendering: true, vimModeEnabled: true };

/** Whether a setting changes only how omp's terminal draws; sessions the dashboard starts run over RPC, with no terminal. */
function terminalOnly(handle: SettingHandle): boolean {
	const condition = handle.ui?.condition;
	return TERMINAL_IDS[handle.id] === true || TERMINAL_PREFIXES.some(prefix => handle.id.startsWith(prefix)) || (condition !== undefined && TERMINAL_CONDITIONS[condition] === true);
}

/** The setting `id` names, `undefined` when omp has none or it only changes how omp's terminal draws. */
export function agentSetting(id: string): SettingHandle | undefined {
	const handle = settingsRegistry.lookup(id);
	return handle && !terminalOnly(handle) ? handle : undefined;
}

/** omp's panel entries for the settings that reach a session, built once: the registry is fixed while the server runs. */
let entries: SettingsDisplayEntry[] | undefined;
function displayEntries(): SettingsDisplayEntry[] {
	entries ??= allSettings
		.orderedSettings()
		.filter(handle => handle.ui !== undefined && !terminalOnly(handle))
		.map(handle => ({ path: handle.id, type: handle.type, defaultValue: handle.default, ui: handle.ui, enumValues: handle.enumValues, credential: handle.isCredential }));
	return entries;
}

/** A layer's value at `segments`; `undefined` when it holds none, as for omp a `null` is unset. */
function valueAt(layer: Record<string, unknown>, segments: readonly string[]): unknown {
	let value: unknown = layer;
	for (const segment of segments) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		value = (value as Record<string, unknown>)[segment];
	}
	return value ?? undefined;
}

/** A layer's value as the page receives it: a credential's as `true`, so its text never leaves the server. */
function shown(handle: SettingHandle, layer: Record<string, unknown>): unknown {
	const value = valueAt(layer, handle.segments);
	return handle.isCredential && value !== undefined ? true : value;
}

function optionOf(def: SettingDef, { value, label, description }: SettingOption): AgentSettingOption {
	return { value: def.schemaType === "number" ? (settingsDefs.numericOption(value) ?? value) : value, label, ...(description ? { description } : {}) };
}

function controlOf(def: SettingDef): AgentSettingControl {
	switch (def.type) {
		case "boolean":
			return { kind: "toggle" };
		case "enum":
			return { kind: "select", options: def.values.map(value => ({ value, label: value })) };
		case "submenu":
			// omp's terminal fills an empty list with choices it finds at run time, such as themes.
			return def.options.length === 0 ? { kind: "text", secret: false } : { kind: "select", options: def.options.map(option => optionOf(def, option)) };
		case "text":
			return def.schemaType === "string" ? { kind: "text", secret: def.secret } : { kind: "json" };
		case "multiselect":
			return { kind: "list", options: def.options.map(option => optionOf(def, option)), ordered: def.ordered };
		case "providerLimits":
			return { kind: "provider-limits" };
	}
}

/** One row; `global` and `workspace` are the layers, read once per request since omp clones them on every read. */
function rowOf(def: SettingDef, settings: OmpSettingsInstance, global: Record<string, unknown>, workspace: Record<string, unknown> | null): AgentSettingRow {
	const handle = settingsRegistry.lookup(def.path);
	if (!handle) throw new Error(`omp lists ${def.path} in its settings panel but has no such setting`);
	const user = shown(handle, global);
	const project = workspace === null ? undefined : shown(handle, workspace);
	return {
		id: def.path,
		label: def.label,
		description: def.description,
		...(def.warning ? { warning: def.warning } : {}),
		control: controlOf(def),
		default: handle.isCredential ? undefined : handle.default,
		...(user === undefined ? {} : { user }),
		...(project === undefined ? {} : { workspace: project }),
		...(handle.envName && handle.provenance(settings) === "env" ? { env: handle.envName } : {}),
		credential: handle.isCredential,
	};
}

/** omp's settings as a session in `cwd` loads them; the user's alone when `cwd` is `null`. */
export async function readAgentSettings(cwd: string | null): Promise<AgentSettings> {
	const settings = await config.Settings.loadReadOnly({ cwd: cwd ?? HOME });
	const global = settings.getGlobalSettings();
	const workspace = cwd === null ? null : settings.getProjectSettings();
	const listed = new Set<string>();
	const tabs: AgentSettingTab[] = settingsDefs.SETTING_TABS.flatMap(tab => {
		const groups: AgentSettingTab["groups"] = [];
		for (const def of settingsDefs.getSettingsForTab(displayEntries(), tab)) {
			listed.add(def.path);
			const label = def.group ?? null;
			const last = groups.at(-1);
			const row = rowOf(def, settings, global, workspace);
			if (last?.label === label) last.rows.push(row);
			else groups.push({ label, rows: [row] });
		}
		return groups.length === 0 ? [] : [{ id: tab, label: settingsDefs.TAB_METADATA[tab]?.label ?? tab, groups }];
	});
	const unlisted = allSettings
		.orderedSettings()
		.filter(handle => !listed.has(handle.id) && !terminalOnly(handle))
		.map(handle => handle.id);
	return { tabs, unlisted };
}

/**
 * Writes `edit` to the user's `config.yml` through omp, unless the file no longer holds the value the page showed.
 * Answers whether it wrote. `handle` is {@link agentSetting}'s for `edit.id`, and a value already passed its `assertWritable`.
 */
export async function writeAgentSetting(cwd: string, handle: SettingHandle, edit: AgentSettingEdit): Promise<boolean> {
	const settings = await loadGlobalForWrite(cwd);
	if (!Bun.deepEquals(shown(handle, settings.getGlobalSettings()) ?? null, edit.expected)) return false;
	if ("reset" in edit) handle.unset(settings);
	else handle.set(settings, edit.value);
	await settings.flush();
	return true;
}
