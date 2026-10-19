/** Which live sessions ended a turn you have not looked at since, from the main agent's live events, for the roster's `unread`. */
import { lastReply } from "../dashboard-session";
import { isObject } from "../json";
import { oneLine } from "../session-entries";
import type { UnreadTurn } from "../shared/sessions";

/** The first line of `reply` that holds text, as one summary line. */
function firstLine(reply: string | null): string | null {
	const line = reply?.split("\n").find(text => text.trim());
	return line ? oneLine(line) : null;
}

export class UnreadTurns {
	readonly #turns = new Map<string, UnreadTurn>();
	readonly #now: () => number;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	of(instanceId: string): UnreadTurn | null {
		return this.#turns.get(instanceId) ?? null;
	}

	/**
	 * Takes a live event of session `instanceId`'s main agent: a turn that starts is no longer unread, and one that ends
	 * for good is, while an end that hands over to a queued follow-up is not. Whether the session's `unread` changed.
	 */
	observe(instanceId: string, event: unknown): boolean {
		if (!isObject(event)) return false;
		if (event.type === "agent_start") return this.#turns.delete(instanceId);
		if (event.type !== "agent_end" || event.isTerminal === false) return false;
		this.#turns.set(instanceId, { at: this.#now(), reply: firstLine(lastReply(event.messages)) });
		return true;
	}

	/** Drops session `instanceId`'s unread turn, as you looked at it or it left; whether it had one. */
	clear(instanceId: string): boolean {
		return this.#turns.delete(instanceId);
	}
}
