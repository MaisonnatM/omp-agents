/** The events the Calendar page keeps on this computer, saved in `events.json` as `{ events }`, oldest first. */
import { ReducerFile } from "../fs";
import { isObject, nonEmptyStr, parseAll } from "../json";
import { type EventWhen, type LocalEvent, parseEventWhen } from "../shared/calendar";

export type LocalEventChange = { op: "add"; event: LocalEvent } | { op: "remove"; id: string };

/** An event as `events.json` and the event inbox hold it; a `sessionId` that is not a nonempty string reads as absent. */
export function parseLocalEvent(value: unknown): LocalEvent | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const title = nonEmptyStr(value.title);
	const when = parseEventWhen(value.when);
	const sessionId = nonEmptyStr(value.sessionId);
	if (!id || !title || !when) return null;
	return sessionId ? { id, title, when: when.ok, sessionId } : { id, title, when: when.ok };
}

/** `events` after `change`, or `events` itself when it changes nothing: an id already kept adds nothing, and an id no longer kept removes nothing. */
function applyLocalEvent(events: LocalEvent[], change: LocalEventChange): LocalEvent[] {
	switch (change.op) {
		case "add":
			return events.some(event => event.id === change.event.id) ? events : [...events, change.event];
		case "remove": {
			const kept = events.filter(event => event.id !== change.id);
			return kept.length === events.length ? events : kept;
		}
	}
}

export class LocalEventsFile extends ReducerFile<LocalEvent[], [LocalEventChange]> {
	constructor(path: string) {
		super(path, {
			parse: value => (isObject(value) ? parseAll(value.events, parseLocalEvent) : null),
			toJson: events => ({ events }),
			holds: "a list of calendar events",
			empty: [],
			reduce: applyLocalEvent,
		});
	}

	/** Keeps a new event titled `title` and saves; the event as kept. */
	add(title: string, when: EventWhen): LocalEvent {
		const event = { id: crypto.randomUUID(), title, when };
		this.apply({ op: "add", event });
		return event;
	}
}
