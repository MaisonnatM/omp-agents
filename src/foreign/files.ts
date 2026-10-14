import { existsSync, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import type { SavedSession } from "../omp/sessions";
import type { SessionSource } from "../shared/sessions";

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 64 * 1024;
const READ_BATCH = 16;

/** The complete lines in the first {@link HEAD_BYTES} and in the last {@link TAIL_BYTES} after those of a file. */
export interface FileEdges {
	head: string[];
	tail: string[];
}

export interface SessionSummary {
	id: string;
	cwd: string;
	/** The session's own title, else its first prompt as one line. */
	title: string | null;
	/** No prompt and no reply. */
	empty: boolean;
}

const completeLines = (text: string, fromLineStart: boolean): string[] => {
	const lines = text.split("\n");
	lines.pop();
	if (!fromLineStart) lines.shift();
	return lines.filter(Boolean);
};

async function readEdges(path: string, size: number): Promise<FileEdges> {
	const file = Bun.file(path);
	const head = completeLines(await file.slice(0, HEAD_BYTES).text(), true);
	if (size <= HEAD_BYTES) return { head, tail: [] };
	return { head, tail: completeLines(await file.slice(Math.max(HEAD_BYTES, size - TAIL_BYTES), size).text(), false) };
}

interface Cached {
	stamp: string;
	summary: SessionSummary | null;
	saved: SavedSession | null;
}

/** The session files `pattern` matches under `root`, each summarized by `summarize`, which returns `null` for a file that holds no session to list. */
export class ForeignFiles {
	readonly #root: string;
	readonly #glob: Bun.Glob;
	readonly #source: SessionSource;
	readonly #summarize: (edges: FileEdges, path: string) => SessionSummary | null;
	readonly #cache = new Map<string, Cached>();

	constructor(root: string, pattern: string, source: SessionSource, summarize: (edges: FileEdges, path: string) => SessionSummary | null) {
		this.#root = root;
		this.#glob = new Bun.Glob(pattern);
		this.#source = source;
		this.#summarize = summarize;
	}

	/** Every session file under the root; none while the root does not exist. `titleOf` names a title kept outside the files. */
	async list(titleOf: (id: string) => string | undefined = () => undefined): Promise<SavedSession[]> {
		if (!existsSync(this.#root)) {
			this.#cache.clear();
			return [];
		}
		const paths = await Array.fromAsync(this.#glob.scan({ cwd: this.#root, absolute: true }));
		const listed = new Set(paths);
		for (const path of this.#cache.keys()) if (!listed.has(path)) this.#cache.delete(path);
		const sessions: SavedSession[] = [];
		for (let at = 0; at < paths.length; at += READ_BATCH) {
			for (const session of await Promise.all(paths.slice(at, at + READ_BATCH).map(path => this.read(path, titleOf)))) if (session) sessions.push(session);
		}
		return sessions;
	}

	/** One file as {@link list} gives it; `null` when it is gone or holds no session to list. */
	async read(path: string, titleOf: (id: string) => string | undefined = () => undefined): Promise<SavedSession | null> {
		let stats: Stats;
		try {
			stats = await stat(path);
		} catch {
			this.#cache.delete(path);
			return null;
		}
		const stamp = `${stats.mtimeMs}:${stats.size}`;
		let cached = this.#cache.get(path);
		if (cached?.stamp !== stamp) {
			cached = { stamp, summary: this.#summarize(await readEdges(path, stats.size), path), saved: null };
			this.#cache.set(path, cached);
		}
		const { summary } = cached;
		if (!summary) return null;
		const title = titleOf(summary.id) ?? summary.title;
		if (cached.saved?.title !== title) {
			cached.saved = { id: summary.id, path, source: this.#source, cwd: summary.cwd, title, modifiedAt: stats.mtimeMs, empty: summary.empty };
		}
		return cached.saved;
	}
}
