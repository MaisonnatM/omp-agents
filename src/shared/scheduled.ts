/** Messages and session starts that wait for a time, such as a plan window's reset, then send with no page open. */
import { isNonEmpty, isObject, isSafeInteger, type Parsed } from "../json";
import { type NewSessionRequest, parseNewSessionRequest } from "./sessions";

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

/** What the page sends of a scheduled send: all but its creation time and its state, which the server keeps. */
export type ScheduledSpec = Pick<ScheduledSend, "id" | "at" | "reset" | "target">;

/** One edit of the scheduled sends; the page picks a new send's `id`, so an add sent twice adds once. */
export type ScheduledChange =
	| { op: "add"; send: ScheduledSpec }
	/** Cancels a waiting send, or dismisses a failed one. */
	| { op: "remove"; id: string }
	/** Takes a waiting or failed send off the schedule for **Edit**, which puts its text back in the composer only once this succeeds. */
	| { op: "take"; id: string }
	/** Replaces a waiting or failed send's time and target, keeping its id and creation time; it waits again. */
	| { op: "update"; send: ScheduledSpec }
	/** Sends a waiting send now, or tries a failed one again. */
	| { op: "send-now"; id: string };

/** How long after a plan window's `resetsAt` its send waits, so the provider counts the new window when the message arrives. */
export const RESET_MARGIN_MS = 60_000;

/** The longest text a scheduled message or start may carry; the server rejects a longer one. */
export const MAX_SCHEDULED_TEXT = 1_000_000;

function parseScheduledTarget(value: unknown): Parsed<ScheduledTarget> {
	if (!isObject(value)) return null;
	if (value.kind === "message") {
		const { sessionId, text } = value;
		return isNonEmpty(sessionId) && isNonEmpty(text) && text.length <= MAX_SCHEDULED_TEXT ? { ok: { kind: "message", sessionId, text } } : null;
	}
	if (value.kind !== "start") return null;
	const request = parseNewSessionRequest(value.request);
	if (!request || request.ok.images.length > 0 || !request.ok.prompt.trim() || request.ok.prompt.length > MAX_SCHEDULED_TEXT) return null;
	return { ok: { kind: "start", request: request.ok } };
}

/**
 * A scheduled send as the page adds it and `scheduled.json` keeps it: a text message to a session, or a new session's
 * start without images; other fields drop.
 */
export function parseScheduledSpec(value: unknown): Parsed<ScheduledSpec> {
	if (!isObject(value)) return null;
	const { id, at, reset } = value;
	const target = parseScheduledTarget(value.target);
	if (!isNonEmpty(id) || !isSafeInteger(at) || (reset !== null && !isNonEmpty(reset)) || !target) return null;
	return { ok: { id, at, reset, target: target.ok } };
}

/** The send `id` that an edit may change: one that waits or failed. A send under way may already have reached its session, and one that is gone was sent or canceled. */
function editable(sends: ScheduledSend[], id: string): ScheduledSend {
	const send = sends.find(candidate => candidate.id === id);
	if (!send) throw new Error("It is no longer scheduled.");
	if (send.state.phase === "sending") throw new Error("It is already sending.");
	return send;
}

/**
 * `sends` after an `add`, a `remove`, a `take`, or an `update`, or `sends` itself when it changes nothing. The list stays ordered by `at`, soonest first.
 * A send under way cannot be removed. A `take` or an `update` that finds no editable send throws instead, so the page
 * neither puts back the text of a send that went nor believes an edit was saved.
 */
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
		case "take": {
			const taken = editable(sends, change.id);
			return sends.filter(send => send !== taken);
		}
		case "update": {
			const old = editable(sends, change.send.id);
			const updated: ScheduledSend = { ...change.send, createdAt: old.createdAt, state: { phase: "waiting" } };
			return sends.map(send => (send === old ? updated : send)).sort((a, b) => a.at - b.at);
		}
	}
}

/** Whether `send` waits and its time has come. */
export const isDueSend = (send: ScheduledSend, now: number): boolean => send.state.phase === "waiting" && send.at <= now;
