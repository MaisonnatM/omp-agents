/**
 * omp's own settings as its terminal settings panel lays them out, read from the registry and the panel's definitions,
 * and one setting's write to the user's `config.yml` through omp's handle.
 */
import type { AgentSettingControl, AgentSettingEdit, AgentSettingOption, AgentSettingRow, AgentSettings, AgentSettingTab } from "../shared/agent-settings";
import type { OmpSettingsInstance, SettingDef, SettingHandle, SettingOption, SettingsDisplayEntry, SettingUi } from "./module-types/config";
import { allSettings, settingsDefs, settingsRegistry } from "./modules";

const TERMINAL_PREFIXES = ["tui.", "statusLine.", "display.", "theme.", "composer.", "terminal."];
const TERMINAL_IDS: ReadonlySet<string> = new Set(["symbolPreset", "colorBlindMode"]);
/** omp's panel shows these rows only in a terminal that can draw them. */
const TERMINAL_CONDITIONS: ReadonlySet<string> = new Set(["hasImageProtocol", "nativeRendering", "vimModeEnabled"]);

/** Whether a setting changes only how omp's terminal draws; sessions the dashboard starts run over RPC, with no terminal. */
function terminalOnly(handle: SettingHandle): boolean {
	const condition = handle.ui?.condition;
	return TERMINAL_IDS.has(handle.id) || TERMINAL_PREFIXES.some(prefix => handle.id.startsWith(prefix)) || (condition !== undefined && TERMINAL_CONDITIONS.has(condition));
}

/** The codes Whisper takes for the language it transcribes, which omp's local Whisper models and cloud transcription read from `stt.language`. */
const WHISPER_LANGUAGES = "af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu ha haw he hi hr ht hu hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo yue zh";
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * Panel metadata for settings a session reads that omp's panel gives no control, so they show in the tab and group of
 * their siblings rather than only in `config.yml`.
 */
const ADDED_UI: Readonly<Record<string, SettingUi>> = {
	"stt.language": {
		tab: "interaction",
		group: "Speech",
		label: "Speech-to-Text Language",
		description: "The language you dictate in, for Whisper and cloud models; Parakeet recognizes it on its own",
		options: WHISPER_LANGUAGES.split(" ")
			.map(code => ({ value: code, label: LANGUAGE_NAMES.of(code) ?? code }))
			.sort((a, b) => a.label.localeCompare(b.label)),
	},
};

/** The setting `id` names, `undefined` when omp has none or it only changes how omp's terminal draws. */
export function agentSetting(id: string): SettingHandle | undefined {
	const handle = settingsRegistry.lookup(id);
	return handle && !terminalOnly(handle) ? handle : undefined;
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

/** A row's part that hangs on omp's registry alone, with the handle that reads its value from each layer. */
interface PanelRow {
	handle: SettingHandle;
	fixed: Omit<AgentSettingRow, "user" | "workspace" | "env">;
}

/** omp's panel for the settings that reach a session: its tabs and groups, and the settings it gives no row. */
interface Panel {
	tabs: (Omit<AgentSettingTab, "groups"> & { groups: { label: string | null; rows: PanelRow[] }[] })[];
	unlisted: string[];
}

/** Built once: the registry is fixed while the server runs. */
let built: Panel | undefined;
function panel(): Panel {
	if (built) return built;
	const handles = new Map(
		allSettings
			.orderedSettings()
			.filter(handle => !terminalOnly(handle))
			.map(handle => [handle.id, handle]),
	);
	const entries: SettingsDisplayEntry[] = [...handles.values()]
		.map(handle => ({ handle, ui: handle.ui ?? ADDED_UI[handle.id] }))
		.filter(({ ui }) => ui !== undefined)
		.map(({ handle, ui }) => ({ path: handle.id, type: handle.type, defaultValue: handle.default, ui, enumValues: handle.enumValues, credential: handle.isCredential }));
	const listed = new Set<string>();
	const tabs = settingsDefs.SETTING_TABS.flatMap((tab): Panel["tabs"] => {
		const groups: Panel["tabs"][number]["groups"] = [];
		for (const def of settingsDefs.getSettingsForTab(entries, tab)) {
			// Every def comes from an entry built from one of `handles`.
			const handle = handles.get(def.path)!;
			listed.add(def.path);
			const row: PanelRow = {
				handle,
				fixed: {
					id: def.path,
					label: def.label,
					description: def.description,
					...(def.warning ? { warning: def.warning } : {}),
					control: controlOf(def),
					default: handle.isCredential ? undefined : handle.default,
					credential: handle.isCredential,
				},
			};
			const label = def.group ?? null;
			const last = groups.at(-1);
			if (last?.label === label) last.rows.push(row);
			else groups.push({ label, rows: [row] });
		}
		return groups.length === 0 ? [] : [{ id: tab, label: settingsDefs.TAB_METADATA[tab]?.label ?? tab, groups }];
	});
	built = { tabs, unlisted: [...handles.keys()].filter(id => !listed.has(id)) };
	return built;
}

/** One row with its values; `global` and `workspace` are the layers, read once per request since omp clones them on every read. */
export function rowOf({ handle, fixed }: PanelRow, settings: OmpSettingsInstance, global: Record<string, unknown>, workspace: Record<string, unknown> | null): AgentSettingRow {
	const user = shown(handle, global);
	const project = workspace === null ? undefined : shown(handle, workspace);
	return {
		...fixed,
		...(user === undefined ? {} : { user }),
		...(project === undefined ? {} : { workspace: project }),
		...(handle.envName && handle.provenance(settings) === "env" ? { env: handle.envName } : {}),
	};
}

/** omp's settings as `settings`, a session's read-only load, holds them; the workspace's layer only when `workspace`. */
export function readAgentSettings(settings: OmpSettingsInstance, workspace: boolean): AgentSettings {
	const global = settings.getGlobalSettings();
	const project = workspace ? settings.getProjectSettings() : null;
	const { tabs, unlisted } = panel();
	return {
		tabs: tabs.map(tab => ({ ...tab, groups: tab.groups.map(group => ({ label: group.label, rows: group.rows.map(row => rowOf(row, settings, global, project)) })) })),
		unlisted,
	};
}

/** The user value of `handle` the page shows, `null` when `config.yml` holds none: what an edit's `expected` must equal. */
export function userValue(handle: SettingHandle, settings: OmpSettingsInstance, edit?: AgentSettingEdit): unknown {
	const value = shown(handle, settings.getGlobalSettings());
	return edit?.entry === undefined ? value ?? null : value && typeof value === "object" && Object.hasOwn(value, edit.entry) ? (value as Record<string, unknown>)[edit.entry] ?? null : null;
}

/**
 * Writes `change` to the user's `config.yml` through omp's handle. `settings` is a load for a write, `handle` is
 * {@link agentSetting}'s, and the caller has checked the change against omp and against the value the page showed.
 */
export async function writeAgentSetting(settings: OmpSettingsInstance, handle: SettingHandle, edit: AgentSettingEdit): Promise<void> {
	if (edit.entry !== undefined) handle.setEntry(settings, edit.entry, "reset" in edit ? undefined : edit.value);
	else if ("reset" in edit) handle.unset(settings);
	else handle.set(settings, edit.value);
	await settings.flush();
}
