/**
 * The scheduled sends, kept in `scheduled.json` as `{ sends }`, soonest first.
 * Servers on different ports share the file, and a send added on any of them must reach the one that sends it, so every
 * change reads the file again before it applies, as `projects.json` does.
 */
import { ReducerFile } from "../fs";
import { isObject, parseAll } from "../json";
import { applyScheduled, type ScheduledChange, type ScheduledSend, type ScheduledState } from "../shared/scheduled";
import { parseScheduledSpec } from "./wire";

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseState(value: unknown): ScheduledState | null {
	if (!isObject(value)) return null;
	if (value.phase === "waiting" || value.phase === "sending") return { phase: value.phase };
	return value.phase === "failed" && typeof value.error === "string" && isTime(value.at) ? { phase: "failed", error: value.error, at: value.at } : null;
}

function parseSend(value: unknown): ScheduledSend | null {
	if (!isObject(value) || !isTime(value.createdAt)) return null;
	const spec = parseScheduledSpec(value);
	const state = parseState(value.state);
	return spec && state && { ...spec.ok, createdAt: value.createdAt, state };
}

export class ScheduledFile extends ReducerFile<ScheduledSend[], [change: Exclude<ScheduledChange, { op: "send-now" }>, now: number]> {
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

	/** Marks send `id` as sending and saves, before anything sends it; the send, or `null` when it is gone or already sending. */
	claim(id: string): ScheduledSend | null {
		const claims = this.update(sends => {
			const index = sends.findIndex(send => send.id === id);
			const send = sends[index];
			return !send || send.state.phase === "sending" ? sends : sends.with(index, { ...send, state: { phase: "sending" } });
		});
		if (!claims) return null;
		this.flush();
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
