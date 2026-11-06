/**
 * Picks a dashboard session's work back up after a provider's error ended its turn: schedules a `continue`, as a
 * scheduled send that the scheduled runner delivers, for when a usage limit resets, or after a backoff that grows with
 * each transient connection or provider fault in a row. A turn the session starts first, from any prompt, cancels it,
 * and so does an edited prompt or End session. While `scheduled.json` holds the session's continue, the session is held:
 * it stays on its task for its merge cleanup, across a server restart too, including one while its usage read runs.
 */
import { randomUUID } from "node:crypto";
import type { TurnFailure } from "../omp/turn-failure";
import type { PlanUsage } from "../shared/models";
import type { HostStatus } from "../shared/sessions";
import { RESET_MARGIN_MS, resetName, type ScheduledSend, type ScheduledTarget } from "../shared/scheduled";
import { providerName } from "../usage";
import type { ScheduledFile } from "./scheduled-file";

type UsageLimit = Extract<TurnFailure, { kind: "usage-limit" }>;

/** How long a continue waits when neither `omp usage` nor the provider's error tells when the limit resets. */
export const UNKNOWN_RESET_WAIT_MS = 60 * 60_000;

/** How long each retry waits after a transient fault, by how many faults in a row came before it; one more fault than it lists leaves the session idle. */
const TRANSIENT_RETRY_WAITS_MS = [1, 2, 4, 8, 16].map(minutes => minutes * 60_000);

/** Whether a session with live `status` is still on its task: a turn runs or waits on a question, or it is `held` for its usage limit's continue. */
export const occupiedBy = (status: HostStatus, held: boolean): boolean => status === "working" || status === "needs-input" || held;

/** When a continue goes, what it waits for as a scheduled send's `reset` names it, and the provider's name the page shows. */
export interface ContinueWhen {
	at: number;
	reset: string | null;
	provider: string;
}

/**
 * When to continue after `hit`, which happened at `now`, each time {@link RESET_MARGIN_MS} after the reset:
 * the reset of `hit.provider`'s used-up plan window in `plans`, else the wait the provider's error named, else
 * {@link UNKNOWN_RESET_WAIT_MS} from now with no `reset`.
 * An account serves again once every window it used up reset, so its latest reset counts; omp moves to any account
 * of the provider that serves, so the soonest account counts. An account with no used-up window could serve now, so
 * then no account's reset counts.
 */
export function continueWhen(hit: UsageLimit, plans: readonly PlanUsage[], now: number): ContinueWhen {
	const own = plans.filter(plan => plan.provider === hit.provider);
	const provider = own[0]?.name ?? providerName(hit.provider);
	let soonest: { resetsAt: number; reset: string } | null = null;
	let someFree = false;
	for (const plan of own) {
		const usedUp = plan.windows.filter(window => window.exhausted && (window.resetsAt === null || window.resetsAt > now));
		if (usedUp.length === 0) {
			someFree = true;
			continue;
		}
		const resets = usedUp.flatMap(window => (window.resetsAt === null ? [] : [{ window, resetsAt: window.resetsAt }]));
		// An account with a used-up window of unknown reset may stay refused past every reset it does name.
		if (resets.length < usedUp.length) continue;
		const last = resets.reduce((a, b) => (b.resetsAt > a.resetsAt ? b : a));
		if (!soonest || last.resetsAt < soonest.resetsAt) soonest = { resetsAt: last.resetsAt, reset: resetName(plans, plan, last.window) };
	}
	if (soonest && !someFree) return { at: soonest.resetsAt + RESET_MARGIN_MS, reset: soonest.reset, provider };
	if (hit.retryAfterMs !== null) return { at: now + hit.retryAfterMs + RESET_MARGIN_MS, reset: `${provider} limit`, provider };
	return { at: now + UNKNOWN_RESET_WAIT_MS, reset: null, provider };
}

export interface AutoContinueDeps {
	file: ScheduledFile;
	/** The plans as `omp usage` reports them, read after the limit; rejects when it fails. */
	plans(): Promise<readonly PlanUsage[]>;
	now(): number;
	/** The continues changed: every socket should hear the sends. */
	onChange(): void;
}

export class AutoContinue {
	readonly #deps: AutoContinueDeps;
	/** How many transient faults in a row each session's retries followed; the count lives in memory and starts over with the server. */
	readonly #retries = new Map<string, number>();

	constructor(deps: AutoContinueDeps) {
		this.#deps = deps;
	}

	/** Whether session `sessionId` waits on its continue, so its merge cleanup counts it as still on its task. */
	held(sessionId: string): boolean {
		return this.#deps.file.value.some(send => holds(send) && send.target.sessionId === sessionId);
	}

	/**
	 * A turn of session `sessionId`, which this server started, ended on `failure`. A usage limit schedules a continue with
	 * {@link limited}, and a transient fault one after the next of {@link TRANSIENT_RETRY_WAITS_MS}, none past the last. A turn
	 * that ended any other way starts the retries over.
	 */
	turnEnded(sessionId: string, failure: TurnFailure | null): void {
		switch (failure?.kind) {
			case "usage-limit":
				void this.limited(sessionId, failure);
				return;
			case "transient":
				this.#retry(sessionId, failure.provider);
				return;
			default:
				this.#retries.delete(sessionId);
		}
	}

	/**
	 * A turn of session `sessionId` ended on `hit`: schedules its continue at once, in place of one it waits on, from the
	 * provider's error, then moves it to when plan usage read now says, unless it no longer waits meanwhile. Its transient
	 * retries start over.
	 */
	async limited(sessionId: string, hit: UsageLimit): Promise<void> {
		const { file, plans, now, onChange } = this.#deps;
		this.#retries.delete(sessionId);
		const at = now();
		const id = randomUUID();
		const schedule = (read: readonly PlanUsage[]): void => {
			const when = continueWhen(hit, read, at);
			file.apply({ op: "continue", send: { id, at: when.at, reset: when.reset, target: { kind: "continue", sessionId, provider: when.provider, cause: "usage-limit" } } }, now());
			onChange();
		};
		// The provider's own wait holds the session in the file while the read runs, so a restart meanwhile keeps the
		// continue; it waits at least RESET_MARGIN_MS, longer than a usage read takes.
		schedule([]);
		const read = await plans().catch(() => null);
		// A turn start, a cancel, a retry, or the page's edit that dropped or replaced the continue meanwhile leaves it be.
		if (read && file.value.some(send => send.id === id && send.state.phase === "waiting")) schedule(read);
	}

	/** Schedules session `sessionId`'s next retry after `provider`'s transient fault, in place of the continue it waits on, unless none is left. */
	#retry(sessionId: string, provider: string): void {
		const { file, now, onChange } = this.#deps;
		const retried = this.#retries.get(sessionId) ?? 0;
		const wait = TRANSIENT_RETRY_WAITS_MS[retried];
		if (wait === undefined) {
			this.#retries.delete(sessionId);
			return;
		}
		this.#retries.set(sessionId, retried + 1);
		const at = now();
		file.apply({ op: "continue", send: { id: randomUUID(), at: at + wait, reset: null, target: { kind: "continue", sessionId, provider: providerName(provider), cause: "transient" } } }, at);
		onChange();
	}

	/**
	 * Session `sessionId` started a turn, from any prompt: its continue, or the one still being timed by its usage read, is
	 * canceled; one under way stays. Its transient retries keep counting, so a retry's own turn that fails again waits longer.
	 */
	turnStarted(sessionId: string): void {
		if (this.#deps.file.apply({ op: "drop-continue", sessionId }, this.#deps.now())) this.#deps.onChange();
	}

	/** Session `sessionId` moved to a new id or ended: as {@link turnStarted}, and its transient retries start over. */
	cancel(sessionId: string): void {
		this.#retries.delete(sessionId);
		this.turnStarted(sessionId);
	}
}

/** Whether `send` is a continue that holds its session: one waiting or under way; a failed one never goes on its own, so it holds nothing. */
function holds(send: ScheduledSend): send is ScheduledSend & { target: Extract<ScheduledTarget, { kind: "continue" }> } {
	return send.target.kind === "continue" && send.state.phase !== "failed";
}
