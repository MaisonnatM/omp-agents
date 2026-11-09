/**
 * The reminders omp's `user_event` tool leaves for the Calendar page's events kept on this computer, one JSON file each
 * in a directory, so the server stays the only writer of `events.json` and a session can add a reminder while the
 * dashboard is down. An agent may add an event in its session's name, filed in that session's space, or remove one its
 * session added; the inbox checks the removal against the events as each file applies, so it cannot remove one you or
 * another session added.
 */
import { isObject, nonEmptyStr } from "../json";
import { type LocalEvent, MAX_EVENT_TITLE } from "../shared/calendar";
import type { SpaceOfSession } from "../shared/workspaces";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";
import { type LocalEventChange, parseLocalEvent } from "./local-events-file";

/** `value` as a change an agent may make to `events`, or why not. */
function parseAgentEventChange(value: unknown, events: readonly LocalEvent[]): InboxEntry<LocalEventChange> {
	if (!isObject(value)) return { invalid: "it is not a change to the calendar's events" };
	if (value.op === "add") {
		const event = parseLocalEvent(value.event);
		if (!event) return { invalid: "its event has no id, title, or valid time" };
		if (event.title.length > MAX_EVENT_TITLE) return { invalid: `its title is longer than ${MAX_EVENT_TITLE} characters` };
		return event.sessionId ? { item: { op: "add", event } } : { invalid: "an agent's event must name the session that added it" };
	}
	if (value.op === "remove") {
		const id = nonEmptyStr(value.id);
		const sessionId = nonEmptyStr(value.sessionId);
		if (!id || !sessionId) return { invalid: "a removal must name the event and the session removing it" };
		const target = events.find(event => event.id === id);
		if (target && target.sessionId !== sessionId) return { invalid: `event ${id} was not added by session ${sessionId}` };
		return { item: { op: "remove", id } };
	}
	return { invalid: `an agent may only add or remove an event, not ${String(value.op)}` };
}

/** `change` with an added event in the space of the session that added it, whatever space the file named. */
async function inSessionSpace(change: LocalEventChange, spaceOf: SpaceOfSession): Promise<LocalEventChange> {
	if (change.op !== "add" || change.event.sessionId === null) return change;
	return { ...change, event: { ...change.event, space: await spaceOf(change.event.sessionId) } };
}

export class EventInbox extends JsonInboxDir<LocalEventChange> {
	constructor(dir: string, events: () => readonly LocalEvent[], apply: (change: LocalEventChange) => void, spaceOf: SpaceOfSession, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseAgentEventChange(value, events()),
				async apply(change) {
					apply(await inSessionSpace(change, spaceOf));
					return true;
				},
			},
			options,
		);
	}
}
