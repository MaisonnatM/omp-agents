/**
 * The scheduled sends, kept in `scheduled.json` as `{ sends }`, soonest first.
 * Servers on different ports share the file, and a send added on any of them must reach the one that sends it, so every
 * change reads the file again before it applies, as `projects.json` does.
 */
import { JsonFile } from "../fs";
import { isObject, parseAll } from "../json";
import { applyScheduled, type ScheduledChange, type ScheduledSend, type ScheduledState } from "../shared/scheduled";
import { parseScheduledSpec } from "./wire";

interface Stored {
	sends: ScheduledSend[];
}

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

function parseStored(value: unknown): Stored | null {
	const sends = isObject(value) ? parseAll(value.sends, parseSend) : null;
	return sends && { sends };
}

export class ScheduledFile {
	readonly #file: JsonFile<Stored>;
	#sends: ScheduledSend[];

	constructor(path: string) {
		// The file holds messages someone wrote, so a file that is not one moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseStored, holds: "a list of scheduled sends", onInvalid: "aside", indent: "\t" });
		this.#sends = this.#file.load()?.sends ?? [];
	}

	get sends(): ScheduledSend[] {
		return this.#sends;
	}

	/** Reads the file again, so a send that another server added or sent counts. */
	reload(): void {
		this.#sends = this.#file.load()?.sends ?? this.#sends;
	}

	/** Applies `change` at time `now` and saves; whether it changed anything. */
	apply(change: Exclude<ScheduledChange, { op: "send-now" }>, now: number): boolean {
		this.reload();
		return this.#replace(applyScheduled(this.#sends, change, now));
	}

	/** Marks send `id` as sending and saves, before anything sends it; the send, or `null` when it is gone or already sending. */
	claim(id: string): ScheduledSend | null {
		this.reload();
		const send = this.#sends.find(candidate => candidate.id === id);
		if (!send || send.state.phase === "sending") return null;
		this.#update(id, { phase: "sending" });
		this.#file.flush();
		return send;
	}

	/** Drops send `id`, which reached its session. */
	sent(id: string): void {
		this.reload();
		this.#replace(this.#sends.filter(send => send.id !== id));
	}

	/** Records why send `id` did not send; it stays until it is sent again or dismissed. */
	failed(id: string, error: string, at: number): void {
		this.reload();
		this.#update(id, { phase: "failed", error, at });
	}

	#update(id: string, state: ScheduledState): void {
		this.#replace(this.#sends.map(send => (send.id === id ? { ...send, state } : send)));
	}

	#replace(next: ScheduledSend[]): boolean {
		if (next === this.#sends || (next.length === this.#sends.length && next.every((send, index) => send === this.#sends[index]))) return false;
		this.#sends = next;
		this.#file.save({ sends: next });
		return true;
	}
}
