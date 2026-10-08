/**
 * The bell's notices: what the last checks found, how each update the user started went, and which notices the user saw
 * or cleared, which `notices.json` keeps across restarts.
 */
import { JsonFile } from "../fs";
import { errorText, isObject } from "../json";
import { type ModelUpdate, type Notice, type NoticeOp, type NoticeStatus, type NoticeSubject, usesClause } from "../shared/notices";

export interface NoticeSources {
	/** The newest omp release, or `null` when omp's settings turn the check off. */
	latestOmp(): Promise<string | null>;
	/** The version of the omp installed on disk. */
	installedOmp(): string;
	/** Runs `omp update`; answers with the version it installed, at least `latest`. */
	updateOmp(latest: string): Promise<string>;
	modelUpdates(): Promise<ModelUpdate[]>;
	upgradeModel(update: ModelUpdate): Promise<void>;
}

interface Marks {
	seen: string[];
	cleared: string[];
}

type Found = { id: string } & NoticeSubject;

const AVAILABLE: NoticeStatus = { state: "available" };

const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string");

function parseMarks(value: unknown): Marks | null {
	return isObject(value) && isIds(value.seen) && isIds(value.cleared) ? { seen: value.seen, cleared: value.cleared } : null;
}

export class Notices {
	readonly #file: JsonFile<Marks>;
	readonly #sources: NoticeSources;
	readonly #changed: () => void;
	readonly #seen: Set<string>;
	readonly #cleared: Set<string>;
	/** By id, omp's notice first. */
	#found = new Map<string, Found>();
	/** The status of each notice the user updated; any other is available. */
	readonly #status = new Map<string, NoticeStatus>();

	constructor(path: string, sources: NoticeSources, changed: () => void) {
		this.#file = new JsonFile(path, { parse: parseMarks, holds: "notice marks", onInvalid: "ignore" });
		const marks = this.#file.load();
		this.#seen = new Set(marks?.seen);
		this.#cleared = new Set(marks?.cleared);
		this.#sources = sources;
		this.#changed = changed;
	}

	/** What the bell lists: every notice found but not cleared. */
	get list(): Notice[] {
		return [...this.#found.values()]
			.filter(({ id }) => !this.#cleared.has(id))
			.map(found => ({ ...found, seen: this.#seen.has(found.id), status: this.#status.get(found.id) ?? AVAILABLE }));
	}

	/**
	 * Looks for a newer omp and newer routed models. A check that fails keeps what the last one found; a notice whose
	 * update ran or runs stays until the user clears it, so its outcome shows even once the check no longer finds it.
	 */
	async check(): Promise<void> {
		const [omp, model] = await Promise.allSettled([this.#ompNotices(), this.#modelNotices()]);
		const next = new Map<string, Found>();
		const checked = new Set<string>();
		for (const [kind, result] of [["omp", omp], ["model", model]] as const) {
			const before = [...this.#found.values()].filter(found => found.kind === kind);
			if (result.status === "rejected") console.error(`omp-agents: could not check for ${kind === "omp" ? "a newer omp" : "newer models"}: ${errorText(result.reason)}`);
			else checked.add(kind);
			const kept = result.status === "rejected" ? before : [...result.value, ...before.filter(({ id }) => this.#updateStarted(id))];
			for (const found of kept) if (!next.has(found.id)) next.set(found.id, found);
		}
		this.#found = next;
		for (const id of this.#status.keys()) if (!next.has(id)) this.#status.delete(id);
		// A mark outlives a failed check, so a notice the user saw does not show as a toast again once the check works.
		const stale = (id: string): boolean => checked.has(id.slice(0, id.indexOf(":"))) && !next.has(id);
		let forgot = false;
		for (const marks of [this.#seen, this.#cleared]) {
			for (const id of marks) if (stale(id)) forgot = marks.delete(id);
		}
		if (forgot) this.#save();
		this.#changed();
	}

	/** Whether an update of notice `id` runs or ran. */
	#updateStarted(id: string): boolean {
		const state = this.#status.get(id)?.state;
		return state === "updating" || state === "updated";
	}

	/** `update` runs the update and, once it succeeds, checks again; `seen` and `clear` mark notice `id`. An unlisted id does nothing. */
	async apply(id: string, op: NoticeOp): Promise<void> {
		const found = this.#found.get(id);
		if (!found) return;
		if (op === "update") return this.#update(found);
		(op === "seen" ? this.#seen : this.#cleared).add(id);
		this.#save();
		this.#changed();
	}

	async #update(found: Found): Promise<void> {
		if (this.#updateStarted(found.id)) return;
		this.#seen.add(found.id);
		this.#save();
		this.#setStatus(found.id, { state: "updating" });
		try {
			const note = found.kind === "omp" ? `omp ${await this.#sources.updateOmp(found.latest)} is installed. Restart omp-agents to load it.` : await this.#upgrade(found);
			this.#setStatus(found.id, { state: "updated", note });
		} catch (err) {
			this.#setStatus(found.id, { state: "failed", error: errorText(err) });
			return;
		}
		await this.check();
	}

	async #upgrade(update: ModelUpdate): Promise<string> {
		await this.#sources.upgradeModel(update);
		return `${usesClause(update.uses)} ${update.to.name} now.`;
	}

	async #ompNotices(): Promise<Found[]> {
		const latest = await this.#sources.latestOmp();
		const current = this.#sources.installedOmp();
		return latest !== null && Bun.semver.order(latest, current) > 0 ? [{ id: `omp:${latest}`, kind: "omp", current, latest }] : [];
	}

	async #modelNotices(): Promise<Found[]> {
		return (await this.#sources.modelUpdates()).map(update => ({ id: `model:${update.provider}/${update.from.id}>${update.to.id}`, kind: "model", ...update }));
	}

	#setStatus(id: string, status: NoticeStatus): void {
		this.#status.set(id, status);
		this.#changed();
	}

	#save(): void {
		this.#file.save({ seen: [...this.#seen], cleared: [...this.#cleared] });
	}
}
