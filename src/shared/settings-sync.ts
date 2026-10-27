/**
 * Settings › Sync: what carries between machines through a Git repository of the user's, and what never does.
 * The registry is data, so the server, the page, and the docs read one list.
 */
import { arrayOf, fields, type Guard, isNumber, isObject, isString, nullable, oneOf, type Parsed, tagged } from "../json";

export const SYNC_ITEM_IDS = ["omp-config", "omp-agents-md", "omp-append-system", "omp-skills", "omp-rules", "omp-agents", "omp-commands", "source-control", "notes", "todos", "preferences", "workspaces", "calendars"] as const;
export type SyncItemId = (typeof SYNC_ITEM_IDS)[number];
export const isSyncItemId = oneOf(SYNC_ITEM_IDS);

/** A store the server holds, which sync reads and writes through its `SyncStore` rather than as a file. */
export type SyncStoreId = "source-control" | "notes" | "todos" | "preferences" | "workspaces" | "calendars";

/** Where an item lives on this machine: a file or a directory under omp's agent directory, or a store the server holds. */
export type SyncSource = { kind: "omp-file"; path: string } | { kind: "omp-tree"; path: string } | { kind: "store"; store: SyncStoreId };

export interface SyncItem {
	id: SyncItemId;
	label: string;
	detail: string;
	/** Its file, or the directory of its files, in the sync repository. */
	path: string;
	source: SyncSource;
	/** Whether both sides' changes merge entry by entry, as a JSON object's keys and a list's entries, before they conflict. */
	json: boolean;
}

/** What syncs, unless the user leaves an item out. */
export const SYNC_ITEMS: readonly SyncItem[] = [
	{ id: "omp-config", label: "omp settings", detail: "~/.omp/agent/config.yml", path: "omp/config.yml", source: { kind: "omp-file", path: "config.yml" }, json: false },
	{ id: "omp-agents-md", label: "Your AGENTS.md", detail: "~/.omp/agent/AGENTS.md", path: "omp/AGENTS.md", source: { kind: "omp-file", path: "AGENTS.md" }, json: false },
	{ id: "omp-append-system", label: "Appended system prompt", detail: "~/.omp/agent/APPEND_SYSTEM.md", path: "omp/APPEND_SYSTEM.md", source: { kind: "omp-file", path: "APPEND_SYSTEM.md" }, json: false },
	{ id: "omp-skills", label: "Skills", detail: "~/.omp/agent/skills", path: "omp/skills", source: { kind: "omp-tree", path: "skills" }, json: false },
	{ id: "omp-rules", label: "Rules", detail: "~/.omp/agent/rules", path: "omp/rules", source: { kind: "omp-tree", path: "rules" }, json: false },
	{ id: "omp-agents", label: "Custom agents", detail: "~/.omp/agent/agents", path: "omp/agents", source: { kind: "omp-tree", path: "agents" }, json: false },
	{ id: "omp-commands", label: "Commands", detail: "~/.omp/agent/commands", path: "omp/commands", source: { kind: "omp-tree", path: "commands" }, json: false },
	{
		id: "source-control",
		label: "Source control settings",
		detail: "Automatic pulls, each repository's choice, and the cleanup after a merge",
		path: "dashboard/source-control.json",
		source: { kind: "store", store: "source-control" },
		json: true,
	},
	{ id: "notes", label: "Notes", detail: "Every note on the Notes page", path: "dashboard/notes.json", source: { kind: "store", store: "notes" }, json: true },
	{ id: "todos", label: "Todos", detail: "The Todo page's todos, categories, and archive", path: "dashboard/todos.json", source: { kind: "store", store: "todos" }, json: true },
	{
		id: "preferences",
		label: "Preferences",
		detail: "Theme, what transcripts hide, sidebar tabs, notifications, merge method, diff view, calendar routines, and the idle stop",
		path: "dashboard/preferences.json",
		source: { kind: "store", store: "preferences" },
		json: true,
	},
	{ id: "workspaces", label: "Workspaces", detail: "The directories Settings › Workspaces added and hid", path: "dashboard/workspaces.json", source: { kind: "store", store: "workspaces" }, json: true },
	{ id: "calendars", label: "Hidden calendars", detail: "The Google calendars the Calendar page leaves out", path: "dashboard/calendars.json", source: { kind: "store", store: "calendars" }, json: true },
];

/**
 * What never syncs, even inside a synced directory or when the remote holds it, matched against paths in the sync repository.
 * Most never get read at all, since no item names them; the list still guards against an item that would.
 */
export const NEVER_SYNCED: readonly { what: string; pattern: RegExp }[] = [
	{ what: "Databases, such as omp's credentials and session index in agent.db", pattern: /(^|\/)[^/]*\.db(-shm|-wal|-journal)?$/ },
	{ what: "omp's MCP servers, which can hold OAuth client secrets, and its secrets: mcp.json, secrets.yml, secret-placeholder.key", pattern: /^omp\/(mcp\.json|secrets\.ya?ml|secret-placeholder\.key)$/ },
	{ what: "Key and credential files, such as .env, *.pem, *.key, id_rsa, and auth.json", pattern: /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|credentials[^/]*|auth\.json|\.netrc|\.npmrc)$/i },
	{ what: "omp's session files", pattern: /^omp\/sessions(\/|$)/ },
	{ what: "Lock files", pattern: /\.lock$/ },
	{ what: "The dashboard's access token, interrupted sessions, queued merges, and the lock between servers", pattern: /^dashboard\/(token|interrupted\.json|merges\.json|server\.lock|sessions(\/|$))/ },
	{ what: "Repositories and installed packages inside a synced directory", pattern: /(^|\/)(\.git|node_modules)(\/|$)/ },
	{ what: "Finder metadata", pattern: /(^|\/)\.DS_Store$/ },
];

export const neverSynced = (path: string): boolean => NEVER_SYNCED.some(rule => rule.pattern.test(path));

/** Kept in `settings-sync.json` beside the access token. */
export interface SyncSettings {
	/** The Git remote's address, `""` before the user names one. */
	remote: string;
	branch: string;
	excluded: SyncItemId[];
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = { remote: "", branch: "main", excluded: [] };

/** Which side's version a conflicting file keeps. */
export type SyncSide = "local" | "remote";
export const isSyncSide = oneOf<SyncSide>(["local", "remote"]);

/** A file this machine left out of a sync, and why. */
export interface SyncSkip {
	path: string;
	reason: "link" | "binary" | "large" | "credential";
}

/** A file both sides changed differently since the last sync, with each side's text, `null` where it was deleted. */
export interface SyncConflict {
	path: string;
	item: SyncItemId;
	local: string | null;
	remote: string | null;
}

/** What the last sync did: the files it changed here (`received`) and on the remote (`sent`). */
export type SyncOutcome =
	| { kind: "synced"; at: number; received: string[]; sent: string[]; skipped: SyncSkip[] }
	| { kind: "conflict"; at: number; conflicts: SyncConflict[]; skipped: SyncSkip[] }
	| { kind: "failed"; at: number; error: string };

/** `GET /api/sync`. */
export interface SyncAnswer {
	settings: SyncSettings;
	last: SyncOutcome | null;
}

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]+(?<![./])$/;

/**
 * The settings `value` names, or why not. The remote is any address git takes, without a password in it: sync uses this
 * machine's git credentials. An address that starts with `-` would read as an option.
 */
export function parseSyncSettings(value: unknown): Parsed<SyncSettings, { error: string }> {
	if (!isObject(value) || typeof value.remote !== "string" || typeof value.branch !== "string" || !Array.isArray(value.excluded)) return { error: "Expected { remote, branch, excluded }" };
	const remote = value.remote.trim();
	const branch = value.branch.trim();
	if (remote.startsWith("-") || /\s/.test(remote)) return { error: "That is not a Git remote address" };
	if (/^[a-z][a-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/i.test(remote)) return { error: "Leave the password out of the address; sync uses this machine's git credentials" };
	if (!BRANCH.test(branch)) return { error: "That is not a branch name" };
	if (!value.excluded.every(isSyncItemId)) return { error: "Unknown sync item" };
	return { ok: { remote, branch, excluded: SYNC_ITEM_IDS.filter(id => (value.excluded as unknown[]).includes(id)) } };
}

const isSkip: Guard<SyncSkip> = fields<SyncSkip>({ path: isString, reason: oneOf(["link", "binary", "large", "credential"] as const) });
const isConflict: Guard<SyncConflict> = fields<SyncConflict>({ path: isString, item: isSyncItemId, local: nullable(isString), remote: nullable(isString) });

export const isSyncOutcome: Guard<SyncOutcome> = tagged<SyncOutcome, "kind">("kind", {
	synced: { at: isNumber, received: arrayOf(isString), sent: arrayOf(isString), skipped: arrayOf(isSkip) },
	conflict: { at: isNumber, conflicts: arrayOf(isConflict), skipped: arrayOf(isSkip) },
	failed: { at: isNumber, error: isString },
});
