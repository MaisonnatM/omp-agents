/**
 * Picks a dashboard session's work back up after a provider's usage limit ended its turn: schedules a `continue` for
 * when the limit resets, as a scheduled send that the scheduled runner delivers. A turn the session starts first, from
 * any prompt, cancels it, and so does an edited prompt or End session. While `scheduled.json` holds the session's
 * continue, or its limit's usage read runs, the session is held: it stays on its task for its routine and its project,
 * across a server restart too.
 */
import { randomUUID } from "node:crypto";
import type { UsageLimitHit } from "../omp/usage-limit";
import type { PlanUsage } from "../shared/models";
import { RESET_MARGIN_MS, resetName, type ScheduledSend, type ScheduledTarget } from "../shared/scheduled";
import { providerName } from "../usage";
import type { ScheduledFile } from "./scheduled-file";

/** How long a continue waits when neither `omp usage` nor the provider's error tells when the limit resets. */
export const UNKNOWN_RESET_WAIT_MS = 60 * 60_000;

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
export function continueWhen(hit: UsageLimitHit, plans: readonly PlanUsage[], now: number): ContinueWhen {
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
	/** The continues changed: every socket should hear the sends, and {@link AutoContinue.sendsChanged} release the holds they end. */
	onChange(): void;
	/** Session `sessionId` is held no more: its continue went, left the schedule, or was canceled; `reply` is what its held turn ended on. */
	released(sessionId: string, reply: string | null): void;
}

/** A limit whose continue waits on its usage read, with the reply the held turn ended on. */
interface Reading {
	hit: UsageLimitHit;
	reply: string | null;
}

export class AutoContinue {
	readonly #deps: AutoContinueDeps;
	/** Each session whose continue waits on its usage read; a cancel meanwhile takes it out. */
	readonly #reading = new Map<string, Reading>();
	/** The held sessions as the last {@link sendsChanged} saw them, with their replies, so the next one knows which holds ended. */
	#seen: Map<string, string | null>;

	constructor(deps: AutoContinueDeps) {
		this.#deps = deps;
		this.#seen = this.#heldNow();
	}

	/** Whether session `sessionId` waits on its continue, so its routine or project counts it as still on its task. */
	held(sessionId: string): boolean {
		return this.#reading.has(sessionId) || this.#deps.file.value.some(send => holds(send) && send.target.sessionId === sessionId);
	}

	/**
	 * A turn of session `sessionId` ended on `hit`, its last reply `reply`: holds the session at once, then schedules its
	 * continue, in place of one it waits on, from plan usage read now.
	 */
	async limited(sessionId: string, hit: UsageLimitHit, reply: string | null): Promise<void> {
		const { file, plans, now, onChange } = this.#deps;
		const at = now();
		const reading = { hit, reply };
		this.#reading.set(sessionId, reading);
		this.sendsChanged();
		// Without a usage report the provider's own wait still counts.
		const read = await plans().catch(() => []);
		if (this.#reading.get(sessionId) !== reading) return;
		this.#reading.delete(sessionId);
		const when = continueWhen(hit, read, at);
		file.apply({ op: "continue", send: { id: randomUUID(), at: when.at, reset: when.reset, target: { kind: "continue", sessionId, provider: when.provider, reply } } }, now());
		onChange();
	}

	/** Session `sessionId` started a turn, moved to a new id, or ended: its continue, or the one still being scheduled, is canceled; one under way stays. */
	cancel(sessionId: string): void {
		const reading = this.#reading.delete(sessionId);
		const dropped = this.#deps.file.apply({ op: "drop-continue", sessionId }, this.#deps.now());
		if (reading || dropped) this.#deps.onChange();
	}

	/** The scheduled sends changed, here or on another server: a session held before and not now is released. */
	sendsChanged(): void {
		const now = this.#heldNow();
		const ended = [...this.#seen].filter(([sessionId]) => !now.has(sessionId));
		this.#seen = now;
		for (const [sessionId, reply] of ended) this.#deps.released(sessionId, reply);
	}

	/** The held sessions now, each with the reply its held turn ended on: those whose usage read runs, and those whose continue waits or goes. */
	#heldNow(): Map<string, string | null> {
		const held = new Map([...this.#reading].map(([sessionId, { reply }]) => [sessionId, reply]));
		for (const send of this.#deps.file.value) if (holds(send)) held.set(send.target.sessionId, send.target.reply);
		return held;
	}
}

/** Whether `send` is a continue that holds its session: one waiting or under way; a failed one never goes on its own, so it holds nothing. */
function holds(send: ScheduledSend): send is ScheduledSend & { target: Extract<ScheduledTarget, { kind: "continue" }> } {
	return send.target.kind === "continue" && send.state.phase !== "failed";
}
