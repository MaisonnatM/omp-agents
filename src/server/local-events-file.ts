/** The events the Calendar page keeps on this computer, saved in `events.json`. */
import { JsonFile } from "../fs";
import { isObject, nonEmptyStr, parseAll } from "../json";
import { type EventWhen, type LocalEvent, parseEventWhen } from "../shared/calendar";

interface LocalEvents {
	events: LocalEvent[];
}

function parseLocalEvent(value: unknown): LocalEvent | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const title = nonEmptyStr(value.title);
	const when = parseEventWhen(value.when);
	return id && title && when ? { id, title, when: when.ok } : null;
}

function parseLocalEvents(value: unknown): LocalEvents | null {
	const events = isObject(value) ? parseAll(value.events, parseLocalEvent) : null;
	return events && { events };
}

export class LocalEventsFile {
	readonly #file: JsonFile<LocalEvents>;
	#events: LocalEvent[];

	constructor(path: string) {
		// Someone may have edited the file by hand, so one that holds something else moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseLocalEvents, holds: "a list of calendar events", onInvalid: "aside", indent: "\t" });
		this.#events = this.#file.load()?.events ?? [];
	}

	/** Every kept event, oldest first; the page lays out the days it shows. */
	get all(): readonly LocalEvent[] {
		return this.#events;
	}

	/** Keeps a new event titled `title` and saves; the event as kept. */
	add(title: string, when: EventWhen): LocalEvent {
		const event = { id: crypto.randomUUID(), title, when };
		this.#events = [...this.#events, event];
		this.#file.save({ events: this.#events });
		return event;
	}

	/** Removes event `id` and saves; an id no longer kept changes nothing. */
	remove(id: string): void {
		const kept = this.#events.filter(event => event.id !== id);
		if (kept.length === this.#events.length) return;
		this.#events = kept;
		this.#file.save({ events: kept });
	}
}
