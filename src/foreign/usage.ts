import { existsSync } from "node:fs";
import { FoldedFile, type LineFold } from "../line-reader";
import type { SessionFormat } from "../session-formats";

/** One request's tokens in omp's buckets: `input` leaves out what the cache read or wrote. */
export interface RequestTokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Anthropic's cache writes by lifetime, which bill at different rates; their sum is `cacheWrite`. */
	cttl?: { ephemeral5m: number; ephemeral1h: number };
}

/** omp's API list price in dollars of `tokens` sent to `provider/model` at `timestamp` (ms). */
export type Pricer = (provider: string, model: string, tokens: RequestTokens, timestamp: number) => number;

/** One model request another agent's transcript records, priced when it was read. */
export interface ForeignRequest {
	provider: string;
	model: string;
	timestamp: number;
	failed: boolean;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/** One transcript's requests and the session they count toward, which is its parent's for a subagent's transcript. */
export interface FileUsage {
	readonly path: string;
	readonly sessionId: string;
	readonly subagent: boolean;
	/** The working directory the transcript records, `""` while it names none. */
	readonly cwd: string;
	readonly requests: Iterable<ForeignRequest>;
}

/** A transcript's {@link FileUsage}, folded as far as it has been read. */
export interface UsageFold extends LineFold, FileUsage {}

/** Where an agent's transcripts that record requests sit under its format's root, and how one folds. */
export interface UsageFiles {
	/** Globs under the root, subagents' transcripts included. */
	patterns: readonly string[];
	/** An empty fold of the transcript at `path`, pricing each request with `price`. */
	fold(path: string, price: Pricer): UsageFold;
}

const READ_BATCH = 16;

/** Every transcript the formats with {@link SessionFormat.usage} keep, each folded incrementally. */
export class ForeignUsage {
	readonly #formats: readonly SessionFormat[];
	readonly #price: Pricer;
	readonly #files = new Map<string, FoldedFile<UsageFold>>();

	constructor(formats: readonly SessionFormat[], price: Pricer) {
		this.#formats = formats;
		this.#price = price;
	}

	/** Every transcript's usage, each read past what earlier reads folded; a transcript gone from disk drops out. */
	async read(): Promise<FileUsage[]> {
		const listed = new Map<string, UsageFiles>();
		for (const { root, usage } of this.#formats) {
			if (!usage || !existsSync(root)) continue;
			for (const pattern of usage.patterns) for await (const path of new Bun.Glob(pattern).scan({ cwd: root, absolute: true })) listed.set(path, usage);
		}
		for (const path of this.#files.keys()) if (!listed.has(path)) this.#files.delete(path);
		for (const [path, usage] of listed) if (!this.#files.has(path)) this.#files.set(path, new FoldedFile(path, () => usage.fold(path, this.#price)));
		const files = [...this.#files.values()];
		for (let at = 0; at < files.length; at += READ_BATCH) await Promise.all(files.slice(at, at + READ_BATCH).map(file => file.read()));
		return files.map(file => file.fold);
	}
}
