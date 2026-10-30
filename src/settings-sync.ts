/**
 * Settings › Sync on the server: reads the portable files of {@link SYNC_ITEMS} on this machine, merges them three ways
 * with the remote's against the last commit this machine applied, pushes the result, and writes what changed here. It
 * can also point sync at a private GitHub repository, which `ensurePrivateRepo` in `github.ts` creates through `gh`.
 */
import { mkdir, readdir, readFile, realpath, rm, rmdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { atomicWriteText, JsonFile, type ReducerFile } from "./fs";
import { ensurePrivateRepo } from "./github";
import { errorText, isObject, type Parsed, parseJson } from "./json";
import { SerialLane } from "./serial-lane";
import type { HiddenCalendars } from "./server/calendars-file";
import type { ListKind } from "./server/list-registry";
import type { PagePreferences } from "./shared/preferences";
import type { ProcessSettings } from "./shared/processes";
import { DEFAULT_SYNC_SETTINGS, isSyncOutcome, neverSynced, parseSyncSettings, SYNC_ITEMS, type SyncAnswer, type SyncConflict, type SyncItem, type SyncOutcome, type SyncSettings, type SyncSide, type SyncSkip, type SyncStoreId } from "./shared/settings-sync";
import type { SourceControlSettings } from "./shared/source-control";
import type { WorkspaceList } from "./shared/workspaces";
import { parseSourceControlSettings, type SourceControl } from "./source-control";
import { plainPath, type RepoFile, SyncRepo } from "./sync-repo";
import type { UserNoteList } from "./user-notes-shared";
import type { UserTodoList } from "./user-todos-shared";

/** `path` with `home` shortened to `~`, as every machine names it. */
export const portablePath = (path: string, home: string): string => (path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

/** A `~` path from another machine, under this machine's `home`. */
export const localPath = (path: string, home: string): string => (path === "~" || path.startsWith("~/") ? `${home}${path.slice(1)}` : path);

/** `text` with each mention of the directory `home`, or of a path under it, shortened to `~`; `/Users/ab` is not under `/Users/a`. */
export function portableText(text: string, home: string): string {
	const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return text.replace(new RegExp(`(?<![\\w./-])${escaped}(?![\\w.-])`, "g"), "~");
}

/** Text shaped like a credential: a file that holds one stays on this machine. */
export const CREDENTIAL_SHAPES: readonly RegExp[] = [
	/\bgh[pousr]_[A-Za-z0-9]{30,}/,
	/\bgithub_pat_[A-Za-z0-9_]{40,}/,
	/\bglpat-[A-Za-z0-9_-]{20,}/,
	/\bsk-ant-[A-Za-z0-9_-]{20,}/,
	/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/,
	/\bxox[abposr]-[A-Za-z0-9-]{10,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bAIza[0-9A-Za-z_-]{35}/,
	/\blin_api_[A-Za-z0-9]{30,}/,
	/\bnpm_[A-Za-z0-9]{36}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const MAX_BYTES = 1024 * 1024;
/** How much of each side a conflict keeps for the page to show. */
const SHOWN_CHARS = 20_000;

type Version = RepoFile | null;

const same = (a: Version | undefined, b: Version | undefined): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && a.text === b.text && a.executable === b.executable);

/** `value` as JSON text that does not depend on the order its keys were written in. */
export function canonicalJson(value: unknown): string {
	const sorted = (node: unknown): unknown =>
		Array.isArray(node) ? node.map(sorted) : isObject(node) ? Object.fromEntries(Object.keys(node).sort().map(key => [key, sorted(node[key])])) : node;
	return `${JSON.stringify(sorted(value), null, "\t")}\n`;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => isObject(value) && !Array.isArray(value);

/**
 * `entries` by the identity a list merges each by, in order: a string is its own, an object its string `id`. `null` when
 * one has none or two share one, which leaves the list one value.
 */
function byIdentity(entries: readonly unknown[]): Map<string, unknown> | null {
	const map = new Map<string, unknown>();
	for (const entry of entries) {
		const id = typeof entry === "string" ? `s:${entry}` : isPlainObject(entry) && typeof entry.id === "string" ? `o:${entry.id}` : undefined;
		if (id === undefined || map.has(id)) return null;
		map.set(id, entry);
	}
	return map;
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Merges three lists entry by entry. An entry on both sides merges with {@link mergeJson}; one a side added stays; one a
 * side deleted goes, unless the other side changed it, which conflicts. The order follows the side that reordered the
 * entries all three hold, and puts the other side's additions after the entry before each there.
 */
function mergeList(base: Map<string, unknown>, local: Map<string, unknown>, remote: Map<string, unknown>, prefer: SyncSide | undefined): { ok: unknown[] } | null {
	const kept = new Map<string, unknown>();
	for (const id of new Set([...local.keys(), ...remote.keys()])) {
		if (local.has(id) && remote.has(id)) {
			const entry = mergeJson(base.get(id), local.get(id), remote.get(id), prefer);
			if (!entry) return null;
			kept.set(id, entry.ok);
			continue;
		}
		const side: SyncSide = local.has(id) ? "local" : "remote";
		const entry = (side === "local" ? local : remote).get(id);
		const changed = !base.has(id) || !Bun.deepEquals(entry, base.get(id));
		if (changed && base.has(id) && !prefer) return null;
		if (!base.has(id) || (changed && prefer === side)) kept.set(id, entry);
	}
	const shared = (side: Map<string, unknown>): string[] => [...side.keys()].filter(id => base.has(id) && local.has(id) && remote.has(id));
	const [inBase, inLocal, inRemote] = [shared(base), shared(local), shared(remote)];
	let lead: Map<string, unknown>;
	if (sameOrder(inLocal, inBase)) lead = remote;
	else if (sameOrder(inRemote, inBase) || sameOrder(inLocal, inRemote)) lead = local;
	else if (prefer) lead = prefer === "local" ? local : remote;
	else return null;
	const merged = [...lead.keys()].filter(id => kept.has(id));
	let cursor = -1;
	for (const id of (lead === local ? remote : local).keys()) {
		if (!kept.has(id)) continue;
		const at = merged.indexOf(id);
		if (at >= 0) cursor = at;
		else merged.splice(++cursor, 0, id);
	}
	return { ok: merged.map(id => kept.get(id)) };
}

/**
 * Merges JSON values key by key where both sides changed an object, and entry by entry where both changed a list whose
 * entries each have their own identity; `undefined` is an absent key, and `null` the conflict.
 */
export function mergeJson(base: unknown, local: unknown, remote: unknown, prefer: SyncSide | undefined): { ok: unknown } | null {
	if (Bun.deepEquals(local, remote)) return { ok: local };
	if (Bun.deepEquals(local, base)) return { ok: remote };
	if (Bun.deepEquals(remote, base)) return { ok: local };
	if (isPlainObject(local) && isPlainObject(remote)) {
		const from = isPlainObject(base) ? base : {};
		const merged: Record<string, unknown> = {};
		for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
			const entry = mergeJson(from[key], local[key], remote[key], prefer);
			if (!entry) return null;
			if (entry.ok !== undefined) merged[key] = entry.ok;
		}
		return { ok: merged };
	}
	if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base))) {
		const [from, mine, theirs] = [base ?? [], local, remote].map(byIdentity);
		if (from && mine && theirs) return mergeList(from, mine, theirs, prefer);
	}
	return prefer ? { ok: prefer === "local" ? local : remote } : null;
}

/**
 * One file's three-way merge: `null` is a file that is absent. A side that did not change since `base` takes the other's;
 * two different changes conflict, unless `prefer` names the side to keep. With `json`, two changes merge with
 * {@link mergeJson} first.
 */
export function mergeFile(base: Version, local: Version, remote: Version, json: boolean, prefer?: SyncSide): { ok: Version } | { conflict: true } {
	if (same(local, remote)) return { ok: local };
	if (same(local, base)) return { ok: remote };
	if (same(remote, base)) return { ok: local };
	if (json && local && remote) {
		const parsed = [base, local, remote].map(file => (file ? parseJson(file.text) : undefined));
		if (parsed[1] !== undefined && parsed[2] !== undefined) {
			const merged = mergeJson(parsed[0], parsed[1], parsed[2], prefer);
			if (merged) return { ok: { text: canonicalJson(merged.ok), executable: false } };
		}
	}
	return prefer ? { ok: prefer === "local" ? local : remote } : { conflict: true };
}

/** The item a repository path belongs to, among `items`. */
const itemOf = (items: readonly SyncItem[], path: string): SyncItem | undefined =>
	items.find(item => (item.source.kind === "omp-tree" ? path.startsWith(`${item.path}/`) : path === item.path));

export interface SyncInput {
	items: readonly SyncItem[];
	base: ReadonlyMap<string, RepoFile>;
	local: ReadonlyMap<string, RepoFile>;
	remote: ReadonlyMap<string, RepoFile>;
	/** Paths this machine left out, with everything under them: the remote's versions stay as they are. */
	skipped: readonly string[];
	choices: Readonly<Record<string, SyncSide>>;
}

export type SyncPlan = { conflicts: SyncConflict[] } | { conflicts: null; toRemote: Map<string, Version>; toLocal: Map<string, Version> };

/** What a sync changes on each side, or the files that conflict; files outside `items` stay as the remote has them. */
export function planSync({ items, base, local, remote, skipped, choices }: SyncInput): SyncPlan {
	const conflicts: SyncConflict[] = [];
	const toRemote = new Map<string, Version>();
	const toLocal = new Map<string, Version>();
	const left = (path: string): boolean => neverSynced(path) || !plainPath(path) || skipped.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
	for (const path of [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort()) {
		const item = itemOf(items, path);
		if (!item || left(path)) continue;
		const [b, l, r] = [base.get(path) ?? null, local.get(path) ?? null, remote.get(path) ?? null];
		const merged = mergeFile(b, l, r, item.json, choices[path]);
		if ("conflict" in merged) {
			conflicts.push({ path, item: item.id, local: l?.text.slice(0, SHOWN_CHARS) ?? null, remote: r?.text.slice(0, SHOWN_CHARS) ?? null });
			continue;
		}
		// A store always has a value, so the remote deleting its file leaves this machine's.
		const value = merged.ok === null && item.source.kind === "store" ? l : merged.ok;
		if (!same(value, r)) toRemote.set(path, value);
		if (!same(value, l)) toLocal.set(path, value);
	}
	return conflicts.length > 0 ? { conflicts } : { conflicts: null, toRemote, toLocal };
}

/** A store the server holds in memory, as sync reads and replaces it, with its values in the form every machine keeps. */
export interface SyncStore {
	read(): unknown;
	/** `value`, from a merge or the remote, as {@link read} gives it once {@link write} took it; `null` for one it does not take. */
	parse(value: unknown): Parsed<unknown>;
	write(value: unknown): void;
}

/** The source control settings, each repository named from `home` on the remote. */
export function sourceControlStore(store: SourceControl, home: string): SyncStore {
	return {
		read: () => ({ ...store.settings, repos: Object.fromEntries(Object.entries(store.settings.repos).map(([repo, on]) => [portablePath(repo, home), on])) }),
		parse: value => {
			const settings = parseSourceControlSettings(value);
			return settings && { ok: settings };
		},
		write: value => {
			const settings = parseSourceControlSettings(value) as SourceControlSettings;
			store.replace({ ...settings, repos: Object.fromEntries(Object.entries(settings.repos).map(([repo, on]) => [localPath(repo, home), on])) });
		},
	};
}

/** What sync needs of a {@link ReducerFile}. */
type SyncedFile<S> = Pick<ReducerFile<S, never>, "json" | "parse" | "replace">;

/** How a file's JSON travels: `portable` turns it into what every machine keeps, and `local` turns that back. */
interface Carriage {
	portable(json: unknown): unknown;
	local(json: unknown): unknown;
}

const AS_IS: Carriage = { portable: json => json, local: json => json };

/** A store over `file`, carried as its file's JSON through `carriage`; `changed` runs after a write that changed what it reads. */
function fileStore<S>(file: SyncedFile<S>, changed: () => void = () => {}, carriage: Carriage = AS_IS): SyncStore {
	const read = (): unknown => carriage.portable(file.json());
	return {
		read,
		parse: value => {
			const parsed = file.parse(carriage.local(value));
			return parsed === null ? null : { ok: carriage.portable(file.json(parsed)) };
		},
		write: value => {
			const parsed = file.parse(carriage.local(value));
			if (parsed === null) throw new Error("Sync cannot write a value its store does not keep");
			if (Bun.deepEquals(carriage.portable(file.json(parsed)), read())) return;
			file.replace(parsed);
			changed();
		},
	};
}

/** One store over several, carried as an object of each one's value under its name. */
function partsStore(parts: Readonly<Record<string, SyncStore>>): SyncStore {
	const named = Object.entries(parts);
	return {
		read: () => Object.fromEntries(named.map(([name, part]) => [name, part.read()])),
		parse: value => {
			const ok: Record<string, unknown> = {};
			for (const [name, part] of named) {
				const parsed = part.parse(isPlainObject(value) ? value[name] : undefined);
				if (!parsed) return null;
				ok[name] = parsed.ok;
			}
			return { ok };
		},
		write: value => {
			for (const [name, part] of named) part.write(isPlainObject(value) ? value[name] : undefined);
		},
	};
}

/** Notes by id: each edit moves its note first, so as a list two machines' edits of two notes would disagree on the order. */
const NOTES_BY_ID: Carriage = {
	portable: json => (isPlainObject(json) && Array.isArray(json.notes) ? { ...json, notes: Object.fromEntries(json.notes.map(note => [note.id, note])) } : json),
	local: json => (isPlainObject(json) && isPlainObject(json.notes) ? { ...json, notes: Object.values(json.notes) } : json),
};

/** Each todo once, where the list first holds it: a todo two machines moved to two places arrives in both. */
function todosOnce(json: unknown): unknown {
	if (!isPlainObject(json)) return json;
	const seen = new Set<unknown>();
	const once = (todos: unknown): unknown =>
		Array.isArray(todos)
			? todos.flatMap(todo => {
					if (!isPlainObject(todo)) return [todo];
					if (seen.has(todo.id)) return [];
					seen.add(todo.id);
					return [Array.isArray(todo.children) ? { ...todo, children: once(todo.children) } : todo];
				})
			: todos;
	return { ...json, todos: once(json.todos), archive: once(json.archive) };
}

/** Each top-level todo's Workspace, of the list and of the archive, named from `home`, and each todo once on the way back. */
function todoCarriage(home: string): Carriage {
	const workspaces = (json: unknown, path: (path: string, home: string) => string): unknown => {
		if (!isPlainObject(json)) return json;
		const each = (todos: unknown): unknown =>
			Array.isArray(todos) ? todos.map(todo => (isPlainObject(todo) && typeof todo.workspace === "string" ? { ...todo, workspace: path(todo.workspace, home) } : todo)) : todos;
		return { ...json, todos: each(json.todos), archive: each(json.archive) };
	};
	return { portable: json => workspaces(json, portablePath), local: json => todosOnce(workspaces(json, localPath)) };
}

/** The page's preferences, `{}` while no page has handed the server any. */
const PAGE_VALUES: Carriage = {
	portable: json => (isPlainObject(json) && isPlainObject(json.values) ? json.values : {}),
	local: values => ({ values }),
};

/** Each directory of each list under `home` named from it. */
function homePaths(home: string): Carriage {
	const each = (json: unknown, path: (path: string, home: string) => string): unknown =>
		isPlainObject(json) ? Object.fromEntries(Object.entries(json).map(([key, list]) => [key, Array.isArray(list) ? list.map(entry => (typeof entry === "string" ? path(entry, home) : entry)) : list])) : json;
	return { portable: json => each(json, portablePath), local: json => each(json, localPath) };
}

/** The files sync carries beside omp's. */
export interface SyncedFiles {
	sourceControl: SourceControl;
	notes: SyncedFile<UserNoteList>;
	todos: SyncedFile<UserTodoList>;
	preferences: SyncedFile<PagePreferences | null>;
	processes: SyncedFile<ProcessSettings>;
	workspaces: SyncedFile<WorkspaceList>;
	calendars: SyncedFile<HiddenCalendars>;
}

/** Every store sync carries, over `files`; `changed` hears each list a sync rewrote, for the pages that show it. */
export function syncStores(files: SyncedFiles, home: string, changed: (list: ListKind) => void): Record<SyncStoreId, SyncStore> {
	return {
		"source-control": sourceControlStore(files.sourceControl, home),
		notes: fileStore(files.notes, () => changed("user-notes"), NOTES_BY_ID),
		todos: fileStore(files.todos, () => changed("user-todos"), todoCarriage(home)),
		preferences: partsStore({ page: fileStore(files.preferences, () => changed("preferences"), PAGE_VALUES), processes: fileStore(files.processes) }),
		workspaces: fileStore(files.workspaces, () => changed("workspaces"), homePaths(home)),
		// The Calendar page asks for its calendars again, and the server reads which are hidden as it answers.
		calendars: fileStore(files.calendars),
	};
}

export interface SyncPlaces {
	/** omp's agent directory, `~/.omp/agent`. */
	omp: string;
	home: string;
	stores: Record<SyncStoreId, SyncStore>;
}

type Read = { file: RepoFile } | { skip: SyncSkip["reason"] } | null;

/** The file at `path` as sync carries it, or why it stays here; `null` when there is none. */
async function readText(path: string, home: string): Promise<Read> {
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return null;
	if (info.size > MAX_BYTES) return { skip: "large" };
	const bytes = await readFile(path);
	if (bytes.includes(0)) return { skip: "binary" };
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return { skip: "binary" };
	}
	if (CREDENTIAL_SHAPES.some(shape => shape.test(text))) return { skip: "credential" };
	return { file: { text: portableText(text, home), executable: (info.mode & 0o111) !== 0 } };
}

/** Where a file or directory under omp's agent directory lives here; a link at its top is followed, so a dotfiles link stays one. */
const topOf = (path: string, places: SyncPlaces): Promise<string> => realpath(join(places.omp, path)).catch(() => join(places.omp, path));

/**
 * The portable files of `items` on this machine, by repository path, and those it leaves out: links, binaries, large
 * files, and credentials, a store's included.
 */
export async function readLocal(items: readonly SyncItem[], places: SyncPlaces): Promise<{ files: Map<string, RepoFile>; skipped: SyncSkip[] }> {
	const files = new Map<string, RepoFile>();
	const skipped: SyncSkip[] = [];
	const take = (path: string, read: Read): void => {
		if (!read) return;
		if ("file" in read) files.set(path, read.file);
		else skipped.push({ path, reason: read.skip });
	};
	for (const item of items) {
		const { source } = item;
		if (source.kind === "store") {
			const text = canonicalJson(places.stores[source.store].read());
			take(item.path, CREDENTIAL_SHAPES.some(shape => shape.test(text)) ? { skip: "credential" } : { file: { text, executable: false } });
			continue;
		}
		const top = await topOf(source.path, places);
		if (source.kind === "omp-file") {
			take(item.path, await readText(top, places.home));
			continue;
		}
		const walk = async (dir: string): Promise<void> => {
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
			for (const entry of entries) {
				const full = join(dir, entry.name);
				const path = `${item.path}/${relative(top, full)}`;
				if (neverSynced(path)) continue;
				if (entry.isSymbolicLink()) skipped.push({ path, reason: "link" });
				else if (entry.isDirectory()) await walk(full);
				else if (entry.isFile()) take(path, await readText(full, places.home));
			}
		};
		await walk(top);
	}
	return { files, skipped };
}

/**
 * Writes `changes` here: a store through the server's own store, a file through an atomic replace, `null` as a delete.
 * `read` is what {@link readLocal} read before the sync: a store changed since keeps that change over the sync's.
 */
export async function applyLocal(items: readonly SyncItem[], changes: ReadonlyMap<string, Version>, places: SyncPlaces, read: ReadonlyMap<string, RepoFile>): Promise<void> {
	for (const [path, file] of changes) {
		const item = itemOf(items, path);
		if (!item) continue;
		if (item.source.kind === "store") {
			const store = places.stores[item.source.store];
			const now = { text: canonicalJson(store.read()), executable: false };
			const before = read.get(path) ?? null;
			const kept = same(now, before) ? { ok: file } : mergeFile(before, now, file, true, "local");
			if ("ok" in kept && kept.ok) store.write(JSON.parse(kept.ok.text));
			continue;
		}
		const top = await topOf(item.source.path, places);
		const target = item.source.kind === "omp-file" ? top : join(top, path.slice(item.path.length + 1));
		const inside = relative(top, target);
		if (item.source.kind === "omp-tree" && (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) throw new Error(`${path} names a file outside ${item.path}`);
		if (file) {
			await mkdir(dirname(target), { recursive: true });
			await atomicWriteText(target, file.text, file.executable ? 0o755 : 0o644);
			continue;
		}
		await rm(target, { force: true });
		if (item.source.kind !== "omp-tree") continue;
		for (let dir = dirname(target); dir.startsWith(`${top}/`); dir = dirname(dir)) {
			if ((await readdir(dir).catch(() => [dir])).length > 0) break;
			await rmdir(dir);
		}
	}
}

interface SyncState {
	settings: SyncSettings;
	last: SyncOutcome | null;
}

function parseState(value: unknown): SyncState | null {
	if (!isObject(value)) return null;
	const settings = parseSyncSettings(value.settings);
	if (!("ok" in settings)) return null;
	return { settings: settings.ok, last: isSyncOutcome(value.last) ? value.last : null };
}

/** Settings sync: its settings and last outcome, kept in `settings-sync.json`, and one sync at a time. */
export class SettingsSync {
	readonly #file: JsonFile<SyncState>;
	readonly #repo: SyncRepo;
	readonly #places: SyncPlaces;
	readonly #lane = new SerialLane();
	#state: SyncState;

	constructor(file: string, repoDir: string, places: SyncPlaces) {
		this.#file = new JsonFile(file, { parse: parseState, holds: "the settings sync settings", onInvalid: "aside", indent: "\t", mode: 0o600 });
		this.#state = this.#file.load() ?? { settings: DEFAULT_SYNC_SETTINGS, last: null };
		this.#repo = new SyncRepo(repoDir);
		this.#places = places;
	}

	answer(): SyncAnswer {
		return { settings: this.#state.settings, last: this.#state.last };
	}

	/** Saves `settings`; another remote or branch drops the last outcome, which was about the old one. */
	configure(settings: SyncSettings): SyncAnswer {
		const { remote, branch } = this.#state.settings;
		const moved = settings.remote !== remote || settings.branch !== branch;
		this.#save({ settings, last: moved ? null : this.#state.last });
		return this.answer();
	}

	/** Points sync at the private GitHub repository `name` names, created when it does not exist, and saves; the last outcome was about another remote, or this one before it existed. */
	async createRemote(name: string): Promise<SyncAnswer> {
		return this.#lane.run(async () => {
			const remote = await ensurePrivateRepo(name);
			this.#save({ settings: { ...this.#state.settings, remote }, last: null });
			return this.answer();
		});
	}

	/** Runs one sync after any under way; `choices` settles the conflicts the last one found. */
	sync(choices: Readonly<Record<string, SyncSide>> = {}): Promise<SyncAnswer> {
		return this.#lane.run(async () => {
			const at = Date.now();
			const last = await this.#run(choices).catch((err: unknown): SyncOutcome => ({ kind: "failed", at, error: errorText(err) }));
			this.#save({ ...this.#state, last });
			return this.answer();
		});
	}

	#save(state: SyncState): void {
		this.#state = state;
		this.#file.save(state);
	}

	async #run(choices: Readonly<Record<string, SyncSide>>): Promise<SyncOutcome> {
		const { remote, branch, excluded } = this.#state.settings;
		if (remote === "") throw new Error("Name a Git remote first");
		const items = SYNC_ITEMS.filter(item => !excluded.includes(item.id));
		const repo = this.#repo;
		await repo.prepare(remote);
		const head = await repo.fetch(branch);
		const baseRef = SyncRepo.baseRef(remote, branch);
		// With the branch gone from the remote, nothing was applied from it: the next commit starts it again from this machine.
		const baseCommit = head ? await repo.resolve(baseRef) : null;
		const [base, remoteFiles, local] = await Promise.all([
			baseCommit ? repo.files(baseCommit) : new Map<string, RepoFile>(),
			head ? repo.files(head) : new Map<string, RepoFile>(),
			readLocal(items, this.#places),
		]);
		const at = Date.now();
		const plan = planSync({ items, base, local: local.files, remote: remoteFiles, skipped: local.skipped.map(skip => skip.path), choices });
		if (plan.conflicts) return { kind: "conflict", at, conflicts: plan.conflicts, skipped: local.skipped };
		// A merged list may not be in the form its store keeps, such as todos to do before done, so each side gets that form.
		for (const path of new Set([...plan.toLocal.keys(), ...plan.toRemote.keys()])) {
			const item = itemOf(items, path);
			const file = plan.toLocal.get(path) ?? plan.toRemote.get(path);
			if (item?.source.kind !== "store" || !file) continue;
			const parsed = this.#places.stores[item.source.store].parse(parseJson(file.text));
			if (!parsed) throw new Error(`${path} from the remote is not ${item.label.toLowerCase()}`);
			const settled = { text: canonicalJson(parsed.ok), executable: false };
			plan.toLocal.delete(path);
			plan.toRemote.delete(path);
			if (!same(settled, local.files.get(path))) plan.toLocal.set(path, settled);
			if (!same(settled, remoteFiles.get(path))) plan.toRemote.set(path, settled);
		}
		// Pushing before writing here means a sync that stops halfway leaves this machine as the next sync expects to find it.
		let applied = head;
		if (plan.toRemote.size > 0) {
			applied = await repo.commit(head, plan.toRemote, `Sync from ${hostname()}`);
			await repo.push(applied, branch);
		}
		await applyLocal(items, plan.toLocal, this.#places, local.files);
		if (applied) await repo.setRef(baseRef, applied);
		return { kind: "synced", at, received: [...plan.toLocal.keys()].sort(), sent: [...plan.toRemote.keys()].sort(), skipped: local.skipped };
	}
}
