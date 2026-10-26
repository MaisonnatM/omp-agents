import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { OwnerLock } from "./owner-lock";

export type GitHubBudget = "graphql" | "rest";
const QUOTA_EXHAUSTED = /RATE_LIMITED|API rate limit exceeded|rate limit exceeded|secondary rate limit|abuse detection|(?:GraphQL|REST) quota exhausted/i;

export class GitHubQuotaError extends Error {
	constructor(readonly budget: GitHubBudget, readonly resetAt: number) {
		super(`GitHub ${budget === "graphql" ? "GraphQL" : "REST"} quota exhausted; next request after ${new Date(resetAt).toISOString()}. No fresh data was read.`);
	}
}

/** Only error envelopes count: a PR body that discusses rate limits is ordinary data. */
export function quotaExhausted(value: unknown): boolean {
	if (value instanceof GitHubQuotaError) return true;
	if (value instanceof Error && QUOTA_EXHAUSTED.test(value.message)) return true;
	if (typeof value === "string") return QUOTA_EXHAUSTED.test(value);
	if (Array.isArray(value)) return value.some(quotaExhausted);
	if (!value || typeof value !== "object") return false;
	if ("errors" in value && Array.isArray(value.errors)) return value.errors.some(error => error && typeof error === "object" && (QUOTA_EXHAUSTED.test(String(error.type ?? "")) || QUOTA_EXHAUSTED.test(String(error.message ?? ""))));
	if ("message" in value && typeof value.message === "string" && QUOTA_EXHAUSTED.test(value.message)) return true;
	if ("stdout" in value && typeof value.stdout === "string") {
		try {
			return quotaExhausted(JSON.parse(value.stdout));
		} catch {
			return false;
		}
	}
	return false;
}

interface State {
	resetAt: number;
	cache: Record<string, { at: number; value: unknown }>;
}
const CACHE_MS = 5000;
/** Same-process callers share one pid in a lock file, so each lock path also queues them here. */
const queues = new Map<string, Promise<unknown>>();
const reads = new Map<string, Promise<unknown>>();

/** Shared by dashboard servers and installed coding-agent extensions; no automatic network retries or stale successes. */
export class GitHubAccess {
	readonly #directory: string;
	readonly #now: () => number;
	constructor(directory?: string, now = Date.now) {
		let credential = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
		if (!credential) {
			try {
				credential = readFileSync(join(process.env.GH_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh"), "hosts.yml"), "utf8");
			} catch {
				credential = "default";
			}
		}
		const identity = createHash("sha256").update(process.env.GH_HOST || "github.com").update("\0").update(credential).digest("hex");
		this.#directory = directory ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "github", identity);
		this.#now = now;
	}

	/** A `fresh` read never joins a read in flight, which may answer from the cache. */
	read<T>(budget: GitHubBudget, key: string, load: () => Promise<T>, reset: () => Promise<number | undefined>, fresh = false): Promise<T> {
		if (fresh) return this.#request(budget, key, load, reset, true);
		const identity = JSON.stringify([this.#directory, budget, key]);
		const pending = reads.get(identity);
		if (pending) return pending as Promise<T>;
		const answer = this.#request(budget, key, load, reset, false).finally(() => {
			if (reads.get(identity) === answer) reads.delete(identity);
		});
		reads.set(identity, answer);
		return answer;
	}

	async write<T>(budget: GitHubBudget, load: () => Promise<T>, reset: () => Promise<number | undefined>): Promise<T> {
		try {
			return await this.#request(budget, undefined, load, reset, true);
		} finally {
			// A partial mutation may have succeeded even when the command failed.
			for (const resource of ["rest", "graphql"] as const) await this.#state(resource, (state, changed) => { state.cache = {}; changed(); });
		}
	}

	/**
	 * The shared state file is locked only to read or record it, never across the network call. A read also holds a lock
	 * named for its key while it loads, so another process asking the same thing waits and then answers from the cache.
	 * Only a failed command is classified: a successful answer is data, whatever its text says.
	 */
	async #request<T>(budget: GitHubBudget, key: string | undefined, load: () => Promise<T>, reset: () => Promise<number | undefined>, fresh: boolean): Promise<T> {
		const release = key === undefined ? undefined : await this.#hold(join(this.#directory, `${budget}-${createHash("sha256").update(key).digest("hex")}.lock`), 60_000);
		try {
			const cached = await this.#state(budget, state => {
				if (state.resetAt > this.#now()) throw new GitHubQuotaError(budget, state.resetAt);
				const entry = key === undefined || fresh ? undefined : state.cache[key];
				return entry && this.#now() - entry.at < CACHE_MS ? entry : undefined;
			});
			if (cached) return cached.value as T;
			let value: T;
			try {
				value = await load();
			} catch (error) {
				if (!quotaExhausted(error)) throw error;
				// /rate_limit does not consume the REST budget. One metadata probe, never a retry of the refused operation.
				const reported = await reset().catch(() => undefined);
				const resetAt = reported && reported > this.#now() ? reported : this.#now() + 60_000;
				await this.#state(budget, (state, changed) => { state.resetAt = Math.max(state.resetAt, resetAt); changed(); });
				throw new GitHubQuotaError(budget, resetAt);
			}
			if (key !== undefined) {
				await this.#state(budget, (state, changed) => {
					for (const [name, entry] of Object.entries(state.cache)) if (this.#now() - entry.at >= CACHE_MS) delete state.cache[name];
					if (Object.keys(state.cache).length >= 100) state.cache = {};
					state.cache[key] = { at: this.#now(), value };
					changed();
				});
			}
			return value;
		} finally {
			release?.();
		}
	}

	/** Reads and records `budget`'s shared state under its lock; a corrupt state file refuses the request. */
	async #state<T>(budget: GitHubBudget, apply: (state: State, changed: () => void) => T): Promise<T> {
		const path = join(this.#directory, `${budget}.json`);
		const release = await this.#hold(`${path}.lock`, 5000);
		try {
			let state: State = { resetAt: 0, cache: {} };
			try {
				const stored: unknown = JSON.parse(readFileSync(path, "utf8"));
				if (stored && typeof stored === "object" && "resetAt" in stored && typeof stored.resetAt === "number" && "cache" in stored && stored.cache && typeof stored.cache === "object") state = stored as State;
				else throw new Error("Cannot read the shared GitHub quota state; no request was sent.");
			} catch (error) {
				if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
			}
			let changed = false;
			const answer = apply(state, () => { changed = true; });
			if (changed) {
				const temp = join(dirname(path), `${budget}.${randomUUID()}.tmp`);
				try {
					writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
					renameSync(temp, path);
				} finally {
					rmSync(temp, { force: true });
				}
			}
			return answer;
		} finally {
			release();
		}
	}

	/** Takes the interprocess lock at `file` behind this process's earlier holders of it; resolves to its release. */
	async #hold(file: string, timeoutMs: number): Promise<() => void> {
		const previous = queues.get(file) ?? Promise.resolve();
		const { promise: done, resolve: finish } = Promise.withResolvers<void>();
		const turn = previous.then(() => done);
		queues.set(file, turn);
		await previous;
		const lock = new OwnerLock(file, 0);
		const release = () => {
			lock.release();
			if (queues.get(file) === turn) queues.delete(file);
			finish();
		};
		try {
			mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
			const deadline = Date.now() + timeoutMs;
			while (!lock.acquire()) {
				if (Date.now() >= deadline) throw new Error("Timed out waiting for coordinated GitHub access; no request was sent.");
				await Bun.sleep(25);
			}
		} catch (error) {
			release();
			throw error;
		}
		return release;
	}
}

/** GitHub's free rate-limit resource reports separate reset clocks for GraphQL and REST core. */
export function quotaReset(answer: unknown, budget: GitHubBudget): number | undefined {
	if (!answer || typeof answer !== "object" || !("resources" in answer)) return undefined;
	const resources = answer.resources;
	if (!resources || typeof resources !== "object") return undefined;
	const resource = budget === "graphql" ? "graphql" : "core";
	const entry = Reflect.get(resources, resource);
	// A reset time is reported for every window; it is the wait only once the window is spent. Otherwise a secondary limit refused the request, and the caller waits briefly.
	return entry && entry.remaining === 0 && typeof entry.reset === "number" ? entry.reset * 1000 : undefined;
}
