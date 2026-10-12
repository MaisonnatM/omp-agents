/** Messages and session starts that wait for a time, such as a plan window's reset, then send with no page open. */
import type { NewSessionRequest } from "./sessions";

/** What a scheduled send delivers. */
export type ScheduledTarget =
	/** `text` to session `sessionId`: a follow-up while its turn runs, else a prompt, after resuming it when it is not live. */
	| { kind: "message"; sessionId: string; text: string }
	/** A new session, started as the new-session draft would start it; it carries no images. */
	| { kind: "start"; request: NewSessionRequest };

/** `sending` from its claim until the message reaches omp; a send that succeeds leaves the list, and one that fails stays with why. */
export type ScheduledState = { phase: "waiting" } | { phase: "sending" } | { phase: "failed"; error: string; at: number };

export interface ScheduledSend {
	id: string;
	/** When it sends, in epoch milliseconds. */
	at: number;
	/** The plan window whose reset `at` waits for, as the page names it (`Anthropic 5h`); `null` for a time picked by hand. */
	reset: string | null;
	target: ScheduledTarget;
	createdAt: number;
	state: ScheduledState;
}

/** One edit of the scheduled sends; the page picks a new send's `id`, so an add sent twice adds once. */
export type ScheduledChange =
	| { op: "add"; send: Pick<ScheduledSend, "id" | "at" | "reset" | "target"> }
	/** Cancels a waiting send, or dismisses a failed one. */
	| { op: "remove"; id: string }
	/** Sends a waiting send now, or tries a failed one again. */
	| { op: "send-now"; id: string };

/** How long after a plan window's `resetsAt` its send waits, so the provider counts the new window when the message arrives. */
export const RESET_MARGIN_MS = 60_000;

/** The longest text a scheduled message or start may carry; the server rejects a longer one. */
export const MAX_SCHEDULED_TEXT = 1_000_000;

/** `sends` after an `add` or a `remove`, or `sends` itself when it changes nothing. The list stays ordered by `at`, soonest first. A send under way cannot be removed. */
export function applyScheduled(sends: ScheduledSend[], change: Exclude<ScheduledChange, { op: "send-now" }>, now: number): ScheduledSend[] {
	switch (change.op) {
		case "add": {
			if (sends.some(send => send.id === change.send.id)) return sends;
			const added: ScheduledSend = { ...change.send, createdAt: now, state: { phase: "waiting" } };
			return [...sends, added].sort((a, b) => a.at - b.at);
		}
		case "remove": {
			const next = sends.filter(send => send.id !== change.id || send.state.phase === "sending");
			return next.length === sends.length ? sends : next;
		}
	}
}

/** Whether `send` waits and its time has come. */
export const isDueSend = (send: ScheduledSend, now: number): boolean => send.state.phase === "waiting" && send.at <= now;
