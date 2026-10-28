import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CommandError } from "./command";
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
	if (value instanceof CommandError) return QUOTA_EXHAUSTED.test(value.message) || quotaExhausted(value.answer);
	if (typeof value === "string") return QUOTA_EXHAUSTED.test(value);
	if (Array.isArray(value)) return value.some(quotaExhausted);
	if (!value || typeof value !== "object") return false;
	if ("errors" in value && Array.isArray(value.errors)) return value.errors.some(error => error && typeof error === "object" && (QUOTA_EXHAUSTED.test(String(error.type ?? "")) || QUOTA_EXHAUSTED.test(String(error.message ?? ""))));
	return "message" in value && typeof value.message === "string" && QUOTA_EXHAUSTED.test(value.message);
}

/** How long a budget pauses when GitHub refused it without reporting a spent window, as a secondary limit does. */
const FALLBACK_COOLDOWN_MS = 60_000;

/**
 * Shared by dashboard servers and installed coding-agent extensions: a budget that GitHub reported exhausted pauses for
 * every process until its reset. No automatic network retries, and no answers kept: callers cache in memory.
 */
export class GitHubAccess {
	#directory: string | undefined;
	readonly #now: () => number;
	/** `directory` holds the cooldowns; by default one per GitHub host and credential, found on first use. */
	constructor(directory?: string, now = Date.now) {
		this.#directory = directory;
		this.#now = now;
	}

	/**
	 * `load`'s answer, unless another request, in any process, found `budget` exhausted until a reset still ahead.
	 * Only a failed command is classified: a successful answer is data, whatever its text says.
	 */
	async request<T>(budget: GitHubBudget, load: () => Promise<T>, reset: () => Promise<number | undefined>): Promise<T> {
		const paused = this.#resetAt(budget);
		if (paused > this.#now()) throw new GitHubQuotaError(budget, paused);
		try {
			return await load();
		} catch (error) {
			if (!quotaExhausted(error)) throw error;
			// /rate_limit does not consume the REST budget. One metadata probe, never a retry of the refused operation.
			const reported = await reset().catch(() => undefined);
			const resetAt = reported && reported > this.#now() ? reported : this.#now() + FALLBACK_COOLDOWN_MS;
			this.#record(budget, resetAt);
			throw new GitHubQuotaError(budget, resetAt);
		}
	}

	get #dir(): string {
		return (this.#directory ??= cooldownDirectory());
	}

	/** When `budget`'s recorded cooldown ends, 0 for none; a corrupt record refuses the request. */
	#resetAt(budget: GitHubBudget): number {
		let stored: unknown;
		try {
			stored = JSON.parse(readFileSync(join(this.#dir, `${budget}.json`), "utf8"));
		} catch (error) {
			if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
			throw new Error("Cannot read the shared GitHub quota state; no request was sent.");
		}
		if (stored && typeof stored === "object" && "resetAt" in stored && typeof stored.resetAt === "number") return stored.resetAt;
		throw new Error("Cannot read the shared GitHub quota state; no request was sent.");
	}

	/** Extends `budget`'s cooldown to `resetAt`, under a short lock so a later reset another process recorded stands. */
	#record(budget: GitHubBudget, resetAt: number): void {
		mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
		const path = join(this.#dir, `${budget}.json`);
		const lock = new OwnerLock(`${path}.lock`, 0);
		lock.wait();
		const temp = join(this.#dir, `${budget}.${randomUUID()}.tmp`);
		try {
			writeFileSync(temp, JSON.stringify({ resetAt: Math.max(this.#resetAt(budget), resetAt) }), { mode: 0o600, flag: "wx" });
			renameSync(temp, path);
		} finally {
			rmSync(temp, { force: true });
			lock.release();
		}
	}
}

/** The directory of the cooldowns of the credential gh uses when it runs without the `unset` environment variables: named for the host and a hash of the credential, never the credential itself. */
export function cooldownDirectory(unset: readonly string[] = []): string {
	const env = (name: string) => (unset.includes(name) ? undefined : process.env[name]);
	let credential = env("GH_TOKEN") || env("GITHUB_TOKEN");
	if (!credential) {
		try {
			credential = readFileSync(join(process.env.GH_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh"), "hosts.yml"), "utf8");
		} catch {
			credential = "default";
		}
	}
	const identity = createHash("sha256").update(process.env.GH_HOST || "github.com").update("\0").update(credential).digest("hex");
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents", "github", identity);
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
