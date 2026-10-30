/** Live sessions' checkout evidence, read afresh from each live session's and each running child's native transcript. */
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { isObject } from "../json";
import { FoldedFile, type LineFold } from "../line-reader";
import { mapLimit, PROBE_PARALLEL } from "../map-limit";
import { readSessionCwd } from "../omp/sessions";
import { expandHome } from "../paths";
import { SessionFactsScan } from "../session-facts";
import { toolCallsOf } from "../session-entries";
import type { RosterHost } from "../shared/sessions";
import type { WorktreeOccupant } from "../worktrees";
import { located, within } from "../../templates/omp/agent/extensions/shell/commands";

/** The `[path#tag]` line that heads each file's section of an `edit` patch. */
const EDIT_TARGET = /^\[([^\]\n#]+)#/gm;
/** A shell word, or the value of its `--flag=`, that names a path from the root or the home directory. */
const ROOTED = /^(?:-[\w-]*=)?((?:\/|~\/|\$HOME\/|\$\{HOME\}\/).*)$/s;

/**
 * The paths a tool call names, as written: its `cwd` and `path` arguments, the files an `edit` patch heads, and, through the
 * worktree guard's shell walk, each directory a shell command runs in and each word of it rooted at `/` or the home directory.
 */
function namedPaths(args: Record<string, unknown>): string[] {
	const named: string[] = [];
	if (typeof args.cwd === "string") named.push(args.cwd);
	if (typeof args.path === "string") named.push(...args.path.split(";"));
	if (typeof args.input === "string") for (const [, path] of args.input.matchAll(EDIT_TARGET)) if (path) named.push(path);
	if (typeof args.command === "string") {
		for (const { words, dir } of located(args.command, typeof args.cwd === "string" ? within(null, args.cwd) : null)) {
			if (dir) named.push(dir);
			for (const word of words) {
				const rooted = ROOTED.exec(word)?.[1];
				const path = rooted === undefined ? null : within(null, rooted);
				if (path) named.push(path);
			}
		}
	}
	return named.filter(path => path.trim() && !path.includes("://"));
}

/**
 * A transcript's checkout evidence: the directories {@link SessionFactsScan} says its calls worked in, plus every path its tool calls name.
 * The named paths stay out of `SessionFactsScan`, whose work directories pick the checkout a session's end removes: protect broadly, remove narrowly.
 */
class CheckoutScan implements LineFold {
	readonly #facts = new SessionFactsScan(false);
	readonly #named = new Set<string>();
	#unreadable = false;

	applyLine(line: string): void {
		this.#facts.applyLine(line);
		if (!line.includes('"toolCall"')) return;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			this.#unreadable = true;
			return;
		}
		if (!isObject(entry) || entry.type !== "message" || !isObject(entry.message)) return;
		for (const call of toolCallsOf(entry.message)) for (const path of namedPaths(call.args)) this.#named.add(path);
	}

	/** Every path it worked in or named, as written: absolute, `~/`, or relative to the session's directory. */
	get paths(): Iterable<string> {
		return [...this.#facts.workDirs, ...this.#named];
	}

	/** A line that could hold evidence could not be read. */
	get unreadable(): boolean {
		return this.#unreadable || this.#facts.unreadableLines;
	}
}

interface LiveTranscript {
	file: FoldedFile<CheckoutScan>;
	cwd: string | null;
	readonly dirs: Set<string>;
	previous: Stats | null;
	fingerprint: string | null;
	retry: boolean;
}

interface Resident {
	host: RosterHost;
	label: string;
	path: string | null;
	files: Set<string>;
}

const sameFile = (a: Stats, b: Stats): boolean => a.dev === b.dev && a.ino === b.ino;
const sameWrite = (a: Stats, b: Stats): boolean => sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

async function fingerprint(path: string, size: number, oldSize: number): Promise<{ whole: string; prefix: string | null }> {
	const hash = createHash("sha256");
	let offset = 0;
	let prefix = oldSize === 0 ? hash.copy().digest("hex") : null;
	for await (const chunk of Bun.file(path).slice(0, size).stream()) {
		const boundary = oldSize - offset;
		if (prefix === null && boundary >= 0 && boundary <= chunk.length) {
			hash.update(chunk.subarray(0, boundary));
			prefix = hash.copy().digest("hex");
			hash.update(chunk.subarray(boundary));
		} else hash.update(chunk);
		offset += chunk.length;
	}
	if (offset !== size) throw new Error("The transcript changed while its prefix was read.");
	return { whole: hash.digest("hex"), prefix };
}

/** Owns residency and incomplete transcript evidence; Worktrees owns Git identity and containment. */
export class WorktreeOccupants {
	readonly #files = new Map<string, LiveTranscript>();
	readonly #residents = new Map<string, Resident>();
	#chain: Promise<unknown> = Promise.resolve();

	/**
	 * Where `hosts` and their running subagents work.
	 * `transcriptPath(host, null)` names a host's own transcript, `transcriptPath(host, id)` that of its subagent `id`.
	 */
	snapshot(hosts: readonly RosterHost[], transcriptPath: (host: RosterHost, agentId: string | null) => string | null): Promise<WorktreeOccupant[]> {
		const next = this.#chain.then(() => this.#snapshot(hosts, transcriptPath));
		this.#chain = next.catch(() => {});
		return next;
	}

	async #snapshot(hosts: readonly RosterHost[], transcriptPath: (host: RosterHost, agentId: string | null) => string | null): Promise<WorktreeOccupant[]> {
		const occupants: WorktreeOccupant[] = [];
		const residents: Resident[] = [];
		const own: { label: string; path: string }[] = [];
		const active = new Set<string>();
		const disconnected = new Map(hosts.filter(host => host.control.phase !== "live").map(host => [host.instanceId, host]));
		for (const host of hosts) {
			const label = host.sessionName ? `${host.sessionName} (${host.sessionId})` : host.sessionId;
			occupants.push({ kind: "located", cwd: host.cwd, label });
			if (host.worktree) occupants.push({ kind: "located", cwd: host.worktree, label });
			if (host.control.phase !== "live") {
				for (const scopeCwd of new Set([host.cwd, ...(host.worktree ? [host.worktree] : [])])) occupants.push({ kind: "unlocated", scopeCwd, label });
			}
			const ownPath = this.#track(transcriptPath(host, null));
			if (ownPath) own.push({ label, path: ownPath });
			for (const agent of host.agents) {
				if (host.source === "terminal" ? agent.status === "aborted" : agent.status !== "running") continue;
				const key = `${host.instanceId}\0${agent.id}`;
				active.add(key);
				const files = this.#residents.get(key)?.files ?? new Set<string>();
				const path = this.#track(transcriptPath(host, agent.id));
				if (path) files.add(path);
				const resident = { host, label: `${label}, subagent ${agent.id}`, path, files };
				this.#residents.set(key, resident);
				residents.push(resident);
			}
		}
		for (const [key, resident] of this.#residents) {
			if (active.has(key)) continue;
			const host = disconnected.get(resident.host.instanceId);
			if (host) {
				const retained = { ...resident, host, path: null };
				this.#residents.set(key, retained);
				residents.push(retained);
			} else this.#residents.delete(key);
		}
		const retained = new Set([...own.map(({ path }) => path), ...[...this.#residents.values()].flatMap(resident => [...resident.files])]);
		for (const path of this.#files.keys()) if (!retained.has(path)) this.#files.delete(path);
		const paths = [...new Set([...own.map(({ path }) => path), ...residents.flatMap(resident => resident.path ? [resident.path] : [])])];
		const complete = new Map(await mapLimit(paths, PROBE_PARALLEL, async path => [path, await this.#read(path, this.#files.get(path)!)] as const));
		// A session's own transcript only adds checkouts: its cwd already stands for it, so a missing or partial file widens nothing.
		for (const { label, path } of own) for (const cwd of this.#files.get(path)!.dirs) occupants.push({ kind: "located", cwd, label });
		for (const resident of residents) {
			const dirs = new Set<string>();
			for (const path of resident.files) for (const dir of this.#files.get(path)!.dirs) dirs.add(dir);
			for (const cwd of dirs) occupants.push({ kind: "located", cwd, label: resident.label });
			if (resident.host.control.phase === "live" && resident.path && complete.get(resident.path)) continue;
			const scopes = new Set([resident.host.cwd, ...(resident.host.worktree ? [resident.host.worktree] : []), ...dirs]);
			for (const scopeCwd of scopes) occupants.push({ kind: "unlocated", scopeCwd, label: resident.label });
		}
		return occupants;
	}

	/** Starts reading the transcript at `candidate`; the path to read, or null for none. */
	#track(candidate: string | null): string | null {
		if (!candidate || !isAbsolute(candidate)) return null;
		if (!this.#files.has(candidate)) this.#files.set(candidate, { file: new FoldedFile(candidate, () => new CheckoutScan()), cwd: null, dirs: new Set(), previous: null, fingerprint: null, retry: false });
		return candidate;
	}

	async #read(path: string, transcript: LiveTranscript): Promise<boolean> {
		const before = await stat(path).catch(() => null);
		if (!before?.isFile()) {
			transcript.retry = true;
			return false;
		}
		const previous = transcript.previous;
		const digest = previous && sameWrite(previous, before) && transcript.fingerprint
			? { whole: transcript.fingerprint, prefix: transcript.fingerprint }
			: await fingerprint(path, before.size, previous?.size ?? 0).catch(() => null);
		if (!digest) {
			transcript.retry = true;
			return false;
		}
		const replaced = previous !== null && (!sameFile(previous, before) || digest.prefix !== transcript.fingerprint);
		if (transcript.retry || replaced) {
			transcript.file = new FoldedFile(path, () => new CheckoutScan());
			transcript.cwd = null;
		}
		transcript.retry = false;
		transcript.previous = before;
		transcript.fingerprint = digest.whole;
		const read = await transcript.file.read().catch(() => null);
		if (read?.restarted) transcript.cwd = null;
		if (transcript.cwd === null) {
			transcript.cwd = await readSessionCwd(path).catch(() => null);
		}
		if (transcript.cwd) transcript.dirs.add(transcript.cwd);
		for (const raw of transcript.file.fold.paths) {
			const expanded = expandHome(raw);
			if (isAbsolute(expanded)) transcript.dirs.add(resolve(expanded));
			else if (transcript.cwd) transcript.dirs.add(resolve(transcript.cwd, expanded));
		}
		const file = Bun.file(path);
		const after = await file.stat().catch(() => null);
		const end = after?.isFile() && after.size > 0 ? await file.slice(after.size - 1, after.size).bytes().catch(() => null) : null;
		if (!read?.readable || !after || !sameWrite(before, after)) {
			transcript.retry = true;
			return false;
		}
		return transcript.cwd !== null && end?.[0] === 0x0a && !transcript.file.fold.unreadable;
	}
}
