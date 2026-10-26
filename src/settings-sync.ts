/**
 * Settings › Sync on the server: reads the portable files of {@link SYNC_ITEMS} on this machine, merges them three ways
 * with the remote's against the last commit this machine applied, pushes the result, and writes what changed here.
 */
import { lstat, mkdir, readdir, readFile, realpath, rm, rmdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { atomicWriteText, JsonFile } from "./fs";
import { errorText, isObject, parseJson } from "./json";
import { SerialLane } from "./serial-lane";
import { DEFAULT_SYNC_SETTINGS, isSyncOutcome, neverSynced, parseSyncSettings, SYNC_ITEMS, type SyncAnswer, type SyncConflict, type SyncItem, type SyncOutcome, type SyncSettings, type SyncSide, type SyncSkip } from "./shared/settings-sync";
import type { SourceControlSettings } from "./shared/source-control";
import { parseSourceControlSettings, type SourceControl } from "./source-control";
import { plainPath, type RepoFile, SyncRepo } from "./sync-repo";

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

/** Merges JSON values key by key where both sides changed an object; `undefined` is an absent key, and `null` the conflict. */
function mergeJson(base: unknown, local: unknown, remote: unknown, prefer: SyncSide | undefined): { ok: unknown } | null {
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
	return prefer ? { ok: prefer === "local" ? local : remote } : null;
}

/**
 * One file's three-way merge: `null` is a file that is absent. A side that did not change since `base` takes the other's;
 * two different changes conflict, unless `prefer` names the side to keep. With `json`, two changes to an object merge key
 * by key first.
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
	/** Whether `value`, from the remote, is one {@link write} takes. */
	accepts(value: unknown): boolean;
	write(value: unknown): void;
}

/** The source control settings, each repository named from `home` on the remote. */
export function sourceControlStore(store: SourceControl, home: string): SyncStore {
	return {
		read: () => ({ ...store.settings, repos: Object.fromEntries(Object.entries(store.settings.repos).map(([repo, on]) => [portablePath(repo, home), on])) }),
		accepts: value => parseSourceControlSettings(value) !== null,
		write: value => {
			const settings = parseSourceControlSettings(value) as SourceControlSettings;
			store.replace({ ...settings, repos: Object.fromEntries(Object.entries(settings.repos).map(([repo, on]) => [localPath(repo, home), on])) });
		},
	};
}

export interface SyncPlaces {
	/** omp's agent directory, `~/.omp/agent`. */
	omp: string;
	home: string;
	stores: Record<"source-control", SyncStore>;
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

/** The portable files of `items` on this machine, by repository path, and those it leaves out: links, binaries, large files, and credentials. */
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
			take(item.path, { file: { text: canonicalJson(places.stores[source.store].read()), executable: false } });
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

/** Writes `changes` here: a store through the server's own store, a file through an atomic replace, `null` as a delete. */
export async function applyLocal(items: readonly SyncItem[], changes: ReadonlyMap<string, Version>, places: SyncPlaces): Promise<void> {
	for (const [path, file] of changes) {
		const item = itemOf(items, path);
		if (!item) continue;
		if (item.source.kind === "store") {
			if (file) places.stores[item.source.store].write(JSON.parse(file.text));
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
		for (const [path, file] of plan.toLocal) {
			const item = itemOf(items, path);
			if (item?.source.kind === "store" && file && !this.#places.stores[item.source.store].accepts(parseJson(file.text))) throw new Error(`${path} on the remote is not ${item.label.toLowerCase()}`);
		}
		// Pushing before writing here means a sync that stops halfway leaves this machine as the next sync expects to find it.
		let applied = head;
		if (plan.toRemote.size > 0) {
			applied = await repo.commit(head, plan.toRemote, `Sync from ${hostname()}`);
			await repo.push(applied, branch);
		}
		await applyLocal(items, plan.toLocal, this.#places);
		if (applied) await repo.setRef(baseRef, applied);
		return { kind: "synced", at, received: [...plan.toLocal.keys()], sent: [...plan.toRemote.keys()], skipped: local.skipped };
	}
}
