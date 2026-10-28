/** omp's models, model routing, plan usage, and the files and settings it reads. */

/** One quota window of a provider plan. */
export interface PlanWindow {
	/** omp's id for the limit, e.g. `anthropic:7d:fable`; the window id when omp gives none. */
	id: string;
	/** Short name: the window id (`5h`, `7d`, `monthly`) plus its model tier, else omp's label when that is ambiguous. */
	label: string;
	/** omp's name for the limit, e.g. `Claude 7 Day (Fable)`. */
	title: string;
	/** Fraction of the window's quota left, 0 to 1. */
	remaining: number;
	resetsAt: number | null;
	/** Whether the window is used up: omp's `exhausted` status, else nothing left when omp's status is missing or `unknown`. */
	exhausted: boolean;
	/** The dollars behind {@link remaining}, when omp meters the window in USD, as Cursor's `Other Models`. */
	usd?: UsdAmount;
}

/** Dollars spent, and the cap on them; `limit` is `null` when the provider sets none. */
export interface UsdAmount {
	used: number;
	limit: number | null;
}

/** Pay-as-you-go spend past the plan's windows, such as Claude's extra usage: a USD limit without a window. */
export interface ExtraUsage extends UsdAmount {
	/** omp's name for the limit, e.g. `Claude Extra Usage`. */
	title: string;
	exhausted: boolean;
}

/** The reset credits a plan can redeem to clear a used-up window; `nextExpiresAt` is the soonest one's expiry. */
export interface ResetCredits {
	count: number;
	nextExpiresAt: number | null;
}

/** A provider account that `omp usage` reports plan limits for. */
export interface PlanUsage {
	provider: string;
	name: string;
	account: string | null;
	windows: PlanWindow[];
	/** `null` when the plan reports no extra usage, or has it turned off. */
	extra: ExtraUsage | null;
	/** `null` when the plan has no credit to redeem. */
	resetCredits: ResetCredits | null;
}

/** A model a session can switch to; `provider/id` is omp's model selector. */
export interface ModelOption {
	provider: string;
	id: string;
}

/** A model a picker offers, with what omp says of it. */
export interface ModelEntry extends ModelOption {
	/** omp's name for it, such as `Claude Opus 5.5`. */
	name: string;
	/** In tokens, `null` when omp does not say. */
	contextWindow: number | null;
	/** Named by `modelRoles` or `retry.fallbackChains`, so a picker lists it before you search. */
	curated: boolean;
}

/** A model the new-session draft can start on. `thinkingLevels` are the ones omp's catalog lists for it. */
export interface DraftModel extends ModelEntry {
	thinkingLevels: string[];
}

/** The models a new-session draft can start on. */
export interface ConnectedModels {
	models: DraftModel[];
}

/** `model` as omp's selector names it. */
export const selectorOf = ({ provider, id }: ModelOption): string => `${provider}/${id}`;

/** A role in omp's `modelRoles`, such as `plan`, as the model and thinking level its selector names. */
export interface ModelRole {
	role: string;
	model: ModelOption;
	/** The selector's `:level` suffix; `null` keeps the session's thinking level. */
	thinking: string | null;
}

/** A model role: the selector omp uses for it and the fallbacks it walks after that selector, in order. */
export interface RoleRoute {
	role: string;
	/** `null` when only a fallback chain names the role. */
	primary: string | null;
	fallbacks: string[];
	/** The role has no chain of its own, so omp walks the `default` chain. */
	inheritsDefault: boolean;
}

/** A chain keyed by a model selector or a `provider/*` wildcard. It applies whenever that model is active, whatever the role. */
export interface ModelChain {
	key: string;
	fallbacks: string[];
}

/** omp's `retry.*` settings, defaults filled in. */
export interface RetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	waitForUsageReset: boolean;
	modelFallback: boolean;
	usageAwareFallback: boolean;
	usageReservePct: number;
	usageReservePolicy: string;
	fallbackRevertPolicy: string;
}

export interface ModelRouting {
	roles: RoleRoute[];
	modelChains: ModelChain[];
	retry: RetrySettings;
	/** The values omp accepts for each enum `retry.*` setting. */
	retryChoices: Partial<Record<keyof RetrySettings, readonly string[]>>;
	modelProviderOrder: string[];
}

/** A model `omp models` lists. `thinking` holds the levels it takes as a `:level` suffix on its selector. */
export interface CatalogModel {
	selector: string;
	provider: string;
	name: string;
	contextWindow: number | null;
	thinking: string[];
}

/** The model `provider/id` names, as omp writes a selector; `null` when either part is empty. */
export function modelOfSelector(selector: string): ModelOption | null {
	const slash = selector.indexOf("/");
	return slash > 0 && slash < selector.length - 1 ? { provider: selector.slice(0, slash), id: selector.slice(slash + 1) } : null;
}

/**
 * A selector as the model `omp models` lists and its `:level` thinking suffix. Model ids can hold colons
 * (`minimax-m3:batch`), so the suffix splits off only when the rest is a listed model and the whole is not.
 */
export function splitSelector(selector: string, models: { has(selector: string): boolean }): { model: string; level: string | null } {
	const colon = selector.lastIndexOf(":");
	if (colon < 0 || models.has(selector) || !models.has(selector.slice(0, colon))) return { model: selector, level: null };
	return { model: selector.slice(0, colon), level: selector.slice(colon + 1) };
}

/**
 * `PUT /api/settings/routing`: one change to omp's model routing, written to the user's `config.yml` through omp.
 * An absent field stays as it is. An empty `fallbacks` removes the chain, so a role walks the `default` chain again.
 */
export type RoutingEdit =
	| { kind: "role"; role: string; primary?: string; fallbacks?: string[] }
	| { kind: "model-chain"; key: string; fallbacks: string[] }
	| { kind: "retry"; values: Partial<RetrySettings> }
	| { kind: "provider-order"; providers: string[] };

/** `PUT /api/settings/file`: new text for a file the page listed. `baseHash` is the hash it was read with, `null` if it was missing. */
export interface FileEdit {
	path: string;
	text: string;
	baseHash: string | null;
}

/** The body of every failed settings request. `conflict`: the file changed on disk since the page read it. */
export interface SettingsError {
	error: string;
	conflict?: true;
}

/** What a file feeds into omp: instructions, settings, or something it can run. */
export type OmpFileKind = "context" | "system-prompt" | "append-system" | "settings" | "agent" | "command" | "rule" | "skill" | "hook";

/** A file omp reads, as found on disk. */
export interface OmpFile {
	kind: OmpFileKind;
	scope: "user" | "project";
	path: string;
	/** `path` with the home directory shortened to `~`. */
	pathDisplay: string;
	/** `hash` is the SHA-256 of `text`; a save must name it, so a file changed on disk since is not overwritten. */
	body: { state: "read"; size: number; modifiedAt: number; text: string; hash: string } | { state: "missing" } | { state: "unreadable"; error: string };
}

/**
 * A skill tagged `workflow` in its frontmatter's `metadata.tags`. `skill` is its file's path among `OmpSettings.files`;
 * `command` is the path of the slash command of the same name that starts it, if any.
 */
export interface Workflow {
	name: string;
	description: string;
	skill: string;
	command: string | null;
}

/** `GET /api/settings`: omp's model routing and files, as a session in `cwd` would load them. */
export interface OmpSettings {
	/** The workspace whose project files and settings are included; `null` for user-level only. */
	cwd: string | null;
	/** `error` is omp's reason when it cannot load the settings, for example a malformed `config.yml`. */
	routing: ModelRouting | { error: string };
	files: OmpFile[];
	/** The workflow skills among `files`, by name. */
	workflows: Workflow[];
}

/** One decision record, a Markdown file in a repository's records directory, as the `decision-records` skill writes them. */
export interface DecisionRecord {
	/** The file name without `.md`, which records cite each other by. */
	name: string;
	/** The `# ` title, else the file name. */
	title: string;
	/** The frontmatter's `status`; `null` when the file has none. */
	status: string | null;
	/** `YYYY-MM-DD`, from the frontmatter, else the file name's date prefix; `null` when neither has one. */
	date: string | null;
	decisionMakers: string[];
	supersedes: string[];
	supersededBy: string[];
	/** The Markdown after the title. */
	body: string;
}

/** `GET /api/decisions?cwd=<dir>`: the decision records of `cwd`'s repository, newest first. */
export interface DecisionRecords {
	/** The records directory, absolute; `null` when the repository keeps none. */
	dir: string | null;
	dirDisplay: string | null;
	records: DecisionRecord[];
}
