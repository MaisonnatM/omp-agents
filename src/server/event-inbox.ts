/**
 * The reminders omp's `user_event` tool leaves for the Calendar page's events kept on this computer, one JSON file each
 * in a directory, so the server stays the only writer of `events.json` and a session can add a reminder while the
 * dashboard is down. An agent may add an event in its session's name or remove one its session added; the inbox checks
 * the removal against the events as each file applies, so it cannot remove one you or another session added.
 */
import { isObject, nonEmptyStr } from "../json";
import { type LocalEvent, MAX_EVENT_TITLE } from "../shared/calendar";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";
import { type LocalEventChange, parseLocalEvent } from "./local-events-file";

/** A change an agent asked for; a removal names the session asking, checked against the events when it applies. */
type AgentEventChange = Extract<LocalEventChange, { op: "add" }> | { op: "remove"; id: string; sessionId: string };

/** `value` as a change an agent may make, or why not. */
function parseAgentEventChange(value: unknown): InboxEntry<AgentEventChange> {
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
		return id && sessionId ? { item: { op: "remove", id, sessionId } } : { invalid: "a removal must name the event and the session removing it" };
	}
	return { invalid: `an agent may only add or remove an event, not ${String(value.op)}` };
}

export class EventInbox extends JsonInboxDir<AgentEventChange> {
	constructor(dir: string, events: () => readonly LocalEvent[], apply: (change: LocalEventChange) => void, options?: InboxOptions) {
		super(
			dir,
			{
				parse: (_name, value) => parseAgentEventChange(value),
				apply(change) {
					if (change.op === "remove") {
						const target = events().find(event => event.id === change.id);
						if (target && target.sessionId !== change.sessionId) throw new Error(`event ${change.id} was not added by session ${change.sessionId}`);
						apply({ op: "remove", id: change.id });
					} else apply(change);
					return true;
				},
			},
			options,
		);
	}
}
