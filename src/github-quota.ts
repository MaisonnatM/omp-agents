/**
 * The dashboard's share of GitHub's GraphQL budget. Every `gh` call runs on the user's own token, which each agent's
 * `gh` and `gt` share, so the reads the dashboard makes on its own stop while the hour's budget runs low, and the
 * agents keep what is left.
 */
import { createCache } from "./cache";
import { isObject, num } from "./json";

/**
 * The GraphQL points the dashboard's own reads leave to agents, of GitHub's 5000 an hour: a `gh pr` or `gt` command
 * costs a point or a few, so a fifth of the hour carries a busy hour of agents' submits and edits to the reset.
 */
export const GRAPHQL_RESERVE = 1000;

/** How long a read of the quota is kept: `gh api rate_limit` costs no points, but each read spawns `gh`. */
const QUOTA_TTL_MS = 30_000;

/** How long the dashboard's own reads wait after GitHub refuses a call when the quota does not say when it resets. */
const UNKNOWN_RESET_MS = 15 * 60_000;

/** GraphQL's points left this hour, and when GitHub resets them, in milliseconds. */
export interface GraphqlQuota {
	remaining: number;
	reset: number;
}

/** The GraphQL quota in `gh api rate_limit`'s answer, or `null` for an answer without one. */
export function parseRateLimit(answer: unknown): GraphqlQuota | null {
	const graphql = isObject(answer) && isObject(answer.resources) && isObject(answer.resources.graphql) ? answer.resources.graphql : {};
	const remaining = num(graphql.remaining);
	const reset = num(graphql.reset);
	return remaining === undefined || reset === undefined ? null : { remaining, reset: reset * 1000 };
}

/** Why a GraphQL call waits until `until`, the dashboard's own read or a user's call GitHub refused. */
export const pausedText = (until: number): string => `GitHub quota low until ${new Date(until).toTimeString().slice(0, 5)}`;

/** A GraphQL call refused while GitHub's quota is low, by the dashboard before asking or by GitHub; its message says until when. */
export class GithubQuotaPaused extends Error {}

/** Whether the dashboard's own GraphQL reads may spend points now; `read` answers the quota, `null` when it cannot tell. */
export class GithubQuota {
	readonly #read: () => Promise<GraphqlQuota | null>;
	readonly #kept = createCache<GraphqlQuota | null>(QUOTA_TTL_MS);
	/** Until when the dashboard's own reads wait; in the past while they run. */
	#until = 0;
	/** The quota read a refusal started, which refusals arriving before it answers wait for rather than read again. */
	#pausing: Promise<void> | null = null;

	constructor(read: () => Promise<GraphqlQuota | null>) {
		this.#read = read;
	}

	/**
	 * Settles when one of the dashboard's own reads may run, else throws {@link GithubQuotaPaused}: while fewer than
	 * {@link GRAPHQL_RESERVE} points are left, until GitHub resets them. A quota it cannot read lets the read run.
	 */
	async admit(): Promise<void> {
		if (Date.now() >= this.#until) {
			const quota = await this.#kept.get("graphql", this.#readOrNull);
			if (quota && quota.remaining < GRAPHQL_RESERVE) this.#until = quota.reset;
		}
		if (Date.now() < this.#until) throw new GithubQuotaPaused(pausedText(this.#until));
	}

	/**
	 * GitHub refused a GraphQL call for its rate limit: the dashboard's own reads wait until it resets, without retrying before.
	 * Answers the pause for the refused call to throw; refusals that come while paused, or while the first reads the reset, read nothing.
	 */
	async refused(): Promise<GithubQuotaPaused> {
		if (Date.now() >= this.#until) {
			this.#pausing ??= this.#kept
				.get("graphql", this.#readOrNull, true)
				.then(quota => {
					const now = Date.now();
					this.#until = quota && quota.reset > now ? quota.reset : now + UNKNOWN_RESET_MS;
				})
				.finally(() => {
					this.#pausing = null;
				});
			await this.#pausing;
		}
		return new GithubQuotaPaused(pausedText(this.#until));
	}

	/** The quota, `null` when it cannot be read, so the cache keeps a failed read as long as an answer. */
	readonly #readOrNull = (): Promise<GraphqlQuota | null> => this.#read().catch(() => null);
}
