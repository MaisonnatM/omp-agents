/**
 * omp's own settings, as its terminal settings panel lists them: tabs, groups, and one row per setting with the control
 * omp edits it with. The page edits a row through `PUT /api/settings/agent`, which writes the user's `config.yml`.
 */
import { AGENT_SETTINGS, type AgentModelOverride } from "./agents";

/** One choice of a select or a list, as omp names it. */
export interface AgentSettingOption {
	/** What omp stores: a number for a numeric setting, else the text. */
	value: string | number;
	label: string;
	description?: string;
}

/** How a native setting is edited in omp settings or its owning dashboard section. */
export type AgentSettingControl =
	| { kind: "toggle" }
	| { kind: "select"; options: AgentSettingOption[] }
	| { kind: "number"; min: number }
	/** `secret`: a credential, whose value the page never receives. */
	| { kind: "text"; secret: boolean }
	/** A list or a map that omp edits as JSON text. */
	| { kind: "json" }
	/** Some of `options`; `ordered`: the order is a priority. */
	| { kind: "list"; options: AgentSettingOption[]; ordered: boolean }
	/** `providers.maxInFlightRequests`: a request limit per provider. */
	| { kind: "provider-limits" };

/**
 * One setting. `user` and `workspace` are the values the user's `config.yml` and the workspace's settings hold, absent
 * when they hold none; a credential's are `true` instead of its value. omp reads the workspace's over the user's, over
 * `default`. `env` names the environment variable that overrides all three right now.
 */
export interface AgentSettingRow {
	id: string;
	label: string;
	description: string;
	/** omp's risk note, for a setting that can get the user rate-limited or flagged. */
	warning?: string;
	control: AgentSettingControl;
	default: unknown;
	user?: unknown;
	workspace?: unknown;
	env?: string;
	credential: boolean;
}

export interface AgentSettingGroup {
	/** `null` for the rows omp lists before the tab's first heading. */
	label: string | null;
	rows: AgentSettingRow[];
}

/** One of omp's settings tabs, with its groups in omp's order. */
export interface AgentSettingTab {
	id: string;
	label: string;
	groups: AgentSettingGroup[];
}

/** `OmpSettings.agentSettings`: the tabs, and the ids of the settings omp gives no control, which only `config.yml` edits. */
export interface AgentSettings {
	tabs: AgentSettingTab[];
	unlisted: string[];
}

/** One setting's change: a new value, or the removal of the user's, which leaves the workspace's, the variable's, or omp's default. */
export type AgentSettingChange = { value: unknown } | { reset: true };

/**
 * `PUT /api/settings/agent`: one setting's change in the user's `config.yml`.
 * `expected` is the user value the page showed (`AgentSettingRow.user`, `null` when unset); another value refuses the edit.
 * The override-entry variant compares only the named user entry, not the whole map.
 */
export type AgentSettingEdit =
	| ({ id: string; expected: unknown; entry?: never } & AgentSettingChange)
	| AgentOverrideEntryEdit;

/** A single named override is a selector or an ordered list, never an arbitrary setting value. */
export type AgentOverrideEntryEdit = {
	id: typeof AGENT_SETTINGS.overrides;
	entry: string;
	expected: AgentModelOverride | null;
} & ({ value: AgentModelOverride } | { reset: true });
