/**
 * What Settings › omp settings shows of omp's own settings: which other section edits a setting, the value a session
 * reads, whether it differs from omp's default, and the tabs and groups a search leaves.
 */
import type { AgentSettingRow, AgentSettingTab } from "../src/shared/agent-settings";
import { AGENT_SETTINGS } from "../src/shared/agents";
import { everyWord } from "../src/shared/every-word";
import type { SettingsSection } from "./routing";

/** The Settings section that edits a setting, and its name in the line that links there. */
export interface SettingOwner {
	section: SettingsSection;
	label: string;
}

const MODELS: SettingOwner = { section: "models", label: "Models" };
const AGENTS: SettingOwner = { section: "agents", label: "Agents" };
const STORAGE: SettingOwner = { section: "storage", label: "Storage" };

/**
 * omp settings another Settings section edits, by id. Settings › omp settings counts them and links to that section
 * rather than listing them twice. A section that starts editing a setting adds it here.
 */
export const OWNED_SETTINGS: Readonly<Record<string, SettingOwner>> = {
	modelRoles: MODELS,
	modelProviderOrder: MODELS,
	"retry.fallbackChains": MODELS,
	// The `retry.*` settings Models lists under "Retry and fallback"; omp's other `retry.*` settings stay here.
	"retry.enabled": MODELS,
	"retry.maxRetries": MODELS,
	"retry.baseDelayMs": MODELS,
	"retry.maxDelayMs": MODELS,
	"retry.waitForUsageReset": MODELS,
	"retry.modelFallback": MODELS,
	"retry.usageAwareFallback": MODELS,
	"retry.usageReservePct": MODELS,
	"retry.usageReservePolicy": MODELS,
	"retry.fallbackRevertPolicy": MODELS,
	...Object.fromEntries(Object.values(AGENT_SETTINGS).map(id => [id, AGENTS])),
	"gc.blobs": STORAGE,
	"gc.archive": STORAGE,
	"gc.wal": STORAGE,
	"gc.stale": STORAGE,
	"gc.compress": STORAGE,
	"gc.coldArchiveAfterDays": STORAGE,
	"gc.retainNewestGlobal": STORAGE,
	"gc.retainNewestPerCwd": STORAGE,
	"gc.staleRetainNewest": STORAGE,
	"gc.staleRetainDays": STORAGE,
	"gc.compressAfterDays": STORAGE,
	"gc.autoCompress": STORAGE,
};

/** The section that edits `id`, from {@link OWNED_SETTINGS}; `undefined` when this section does. */
export const ownerOf = (id: string): SettingOwner | undefined => (Object.hasOwn(OWNED_SETTINGS, id) ? OWNED_SETTINGS[id] : undefined);

/** The value a session reads, the environment aside: the workspace's over the user's over omp's default. */
export const valueOf = (row: AgentSettingRow): unknown => (row.workspace !== undefined ? row.workspace : row.user !== undefined ? row.user : row.default);

/**
 * Whether a session reads something other than omp's default; for a credential, whether any layer sets one. JSON text
 * compares lists and maps by content; a map's key order counts, which holds since the server writes back what the page sent.
 */
export const isChanged = (row: AgentSettingRow): boolean =>
	row.credential ? row.workspace !== undefined || row.user !== undefined : JSON.stringify(valueOf(row)) !== JSON.stringify(row.default);

const optionLabel = (options: { value: string | number; label: string }[], value: unknown): string => options.find(option => option.value === value)?.label ?? String(value);

/** `value` as the row's control names it, in a line: an option's label, On or Off, a list's entries. */
export function formatValue(row: AgentSettingRow, value: unknown): string {
	const { control } = row;
	if (row.credential) return value === undefined ? "Not set" : "Set";
	switch (control.kind) {
		case "toggle":
			return value === true ? "On" : "Off";
		case "select":
			return optionLabel(control.options, value);
		case "list":
			if (!Array.isArray(value) || value.length === 0) return "None";
			return value.map(entry => optionLabel(control.options, entry)).join(control.ordered ? " → " : ", ");
		case "provider-limits": {
			const limits = typeof value === "object" && value !== null ? Object.entries(value) : [];
			return limits.length === 0 ? "No limit" : limits.map(([provider, limit]) => `${provider}: ${String(limit)}`).join(", ");
		}
		case "json":
			return value === undefined ? "Not set" : JSON.stringify(value);
		case "text":
			return value === undefined || value === "" ? "Not set" : String(value);
	}
}

/** A group as the section shows it: the rows it edits, and per other section how many of the group's rows it edits. */
export interface ShownGroup {
	label: string | null;
	rows: AgentSettingRow[];
	owned: { owner: SettingOwner; count: number }[];
}

/** A tab as the section shows it: its groups with something to show, and how many of its own rows differ from the default. */
export interface ShownTab {
	tab: AgentSettingTab;
	groups: ShownGroup[];
	changed: number;
}

/** Every tab, each with the groups and rows that hold every word of `query` in a label, id, description, or value. */
export function shownTabs(tabs: AgentSettingTab[], query: string): ShownTab[] {
	const matches = everyWord(query);
	return tabs.map(tab => {
		// Counted over the whole tab, whatever the search, so the rail's counts stay put while you type.
		const changed = tab.groups.flatMap(group => group.rows).filter(row => !ownerOf(row.id) && isChanged(row)).length;
		const groups = tab.groups.flatMap(({ label, rows }): ShownGroup[] => {
			const shown: AgentSettingRow[] = [];
			const owned = new Map<SettingsSection, { owner: SettingOwner; count: number }>();
			for (const row of rows) {
				const owner = ownerOf(row.id);
				if (!matches(`${row.label} ${row.id} ${row.description} ${formatValue(row, valueOf(row))}`)) continue;
				if (!owner) shown.push(row);
				else owned.set(owner.section, { owner, count: (owned.get(owner.section)?.count ?? 0) + 1 });
			}
			return shown.length === 0 && owned.size === 0 ? [] : [{ label, rows: shown, owned: [...owned.values()] }];
		});
		return { tab, groups, changed };
	});
}
