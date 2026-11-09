/** The events the Calendar page keeps on this computer, saved in `events.json` as `{ events }`, oldest first. */
import { ReducerFile } from "../fs";
import { isObject, nonEmptyStr, parseAll } from "../json";
import { type EventWhen, type LocalEvent, parseEventWhen } from "../shared/calendar";
import { isSpace, type Space } from "../shared/workspaces";

export type LocalEventChange = { op: "add"; event: LocalEvent } | { op: "set-space"; id: string; space: Space } | { op: "remove"; id: string };

/** An event as `events.json` and the event inbox hold it; a `sessionId` that is not a nonempty string reads as `null`, and a `space` that names none as Work. */
export function parseLocalEvent(value: unknown): LocalEvent | null {
	if (!isObject(value)) return null;
	const id = nonEmptyStr(value.id);
	const title = nonEmptyStr(value.title);
	const when = parseEventWhen(value.when);
	if (!id || !title || !when) return null;
	return { id, title, when: when.ok, sessionId: nonEmptyStr(value.sessionId) ?? null, space: isSpace(value.space) ? value.space : "work" };
}

/** `events` after `change`, or `events` itself when it changes nothing: an id already kept adds nothing, and an id no longer kept removes or moves nothing. */
function applyLocalEvent(events: LocalEvent[], change: LocalEventChange): LocalEvent[] {
	switch (change.op) {
		case "add":
			return events.some(event => event.id === change.event.id) ? events : [...events, change.event];
		case "set-space": {
			const index = events.findIndex(event => event.id === change.id);
			const event = events[index];
			return !event || event.space === change.space ? events : events.with(index, { ...event, space: change.space });
		}
		case "remove": {
			const kept = events.filter(event => event.id !== change.id);
			return kept.length === events.length ? events : kept;
		}
		default: {
			const unhandled: never = change;
			return unhandled;
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

	/** Keeps a new event titled `title` in `space` and saves; the event as kept. */
	add(title: string, when: EventWhen, space: Space): LocalEvent {
		const event = { id: crypto.randomUUID(), title, when, sessionId: null, space };
		this.apply({ op: "add", event });
		return event;
	}
}
