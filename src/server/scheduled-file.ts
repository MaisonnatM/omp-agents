/**
 * The scheduled sends, kept in `scheduled.json` as `{ sends }`, soonest first.
 * Servers on different ports share the file, so each change holds its ownership lock through reload and persistence.
 */
import { ReducerFile } from "../fs";
import { isObject, isSafeInteger, parseAll } from "../json";
import { applyScheduled, type ContinueChange, parseScheduledSpec, type ScheduledChange, type ScheduledSend, type ScheduledState } from "../shared/scheduled";

/** What changes the file: a page's edit, or the server's own of a continue. */
type FileChange = Exclude<ScheduledChange, { op: "send-now" }> | ContinueChange;

function parseState(value: unknown): ScheduledState | null {
	if (!isObject(value)) return null;
	if (value.phase === "waiting" || value.phase === "sending") return { phase: value.phase };
	return value.phase === "failed" && typeof value.error === "string" && isSafeInteger(value.at) ? { phase: "failed", error: value.error, at: value.at } : null;
}

function parseSend(value: unknown): ScheduledSend | null {
	if (!isObject(value) || !isSafeInteger(value.createdAt)) return null;
	const spec = parseScheduledSpec(value);
	const state = parseState(value.state);
	return spec && state && { ...spec.ok, createdAt: value.createdAt, state };
}

export class ScheduledFile extends ReducerFile<ScheduledSend[], [change: FileChange, now: number]> {
	constructor(path: string) {
		super(path, {
			parse: value => (isObject(value) ? parseAll(value.sends, parseSend) : null),
			toJson: sends => ({ sends }),
			holds: "a list of scheduled sends",
			empty: [],
			reduce: applyScheduled,
			shared: true,
		});
	}

	/** Persists `sending` before returning the send, or `null` if gone or already claimed; a failed write throws. */
	claim(id: string): ScheduledSend | null {
		const claims = this.update(sends => {
			const index = sends.findIndex(send => send.id === id);
			const send = sends[index];
			return !send || send.state.phase === "sending" ? sends : sends.with(index, { ...send, state: { phase: "sending" } });
		});
		if (!claims) return null;
		return this.value.find(send => send.id === id)!;
	}

	/** Drops send `id`, which reached its session. */
	sent(id: string): void {
		this.update(sends => (sends.some(send => send.id === id) ? sends.filter(send => send.id !== id) : sends));
	}

	/** Records why send `id` did not send; it stays until it is sent again or dismissed. */
	failed(id: string, error: string, at: number): void {
		this.update(sends => {
			const index = sends.findIndex(send => send.id === id);
			return index === -1 ? sends : sends.with(index, { ...sends[index]!, state: { phase: "failed", error, at } });
		});
	}
}
