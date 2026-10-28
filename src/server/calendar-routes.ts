/** Google Calendar's calendars and events of every account, the events the Calendar page adds and deletes, and the events kept on this computer. */
import type { GoogleCalendars } from "../google-calendar";
import type { AccountId } from "../shared/accounts";
import type { LocalEventsAnswer, NewEventAnswer } from "../shared/calendar";
import { DAY_MS } from "../shared/days";
import { answer, checked, fail } from "./http";
import type { LocalEventsFile } from "./local-events-file";
import type { RouteKit, Routes } from "./routes";
import { parseCalendarShown, parseEventRef, parseNewEvent } from "./wire";

/** The longest span `GET /api/calendar/events` reads: a month view's six weeks, with room to spare. */
const MAX_EVENT_SPAN_MS = 62 * DAY_MS;

/** What the calendar routes read: every Google Calendar account, the calendars each shows, and the events kept on this computer. */
export interface CalendarRoutesEnv {
	google: GoogleCalendars;
	/** Show or hide calendar `id` of Google Calendar account `account` on the Calendar page, and save the choice. */
	setCalendarShown(account: AccountId, id: string, shown: boolean): void;
	localEvents: LocalEventsFile;
}

export function calendarRoutes({ get, write }: RouteKit, env: CalendarRoutesEnv): Routes {
	const { google, localEvents } = env;

	/** `GET /api/google[?fresh]`: the calendars checked in each account's Google Calendar list, with why each one's last read failed. */
	const googleStatus = get(params => answer(() => google.status(params.has("fresh"))));

	/** `PUT /api/google/calendars` `{ account, id, shown }`: show or hide one calendar's events on the Calendar page; answers the calendars after it. */
	const calendarShown = write(
		body => checked(parseCalendarShown(body), "Expected { account, id, shown } naming a calendar"),
		async ({ account, id, shown }) => {
			env.setCalendarShown(account, id, shown);
			return google.status();
		},
	);

	/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of every account's shown Google calendars in that span. */
	const calendarEvents = get(params => {
		const from = new Date(params.get("from") ?? "");
		const to = new Date(params.get("to") ?? "");
		const span = to.getTime() - from.getTime();
		if (!(span > 0 && span <= MAX_EVENT_SPAN_MS)) return fail(400, "Expected ?from= and ?to= ISO times, at most 62 days apart");
		return answer(() => google.events(from, to, params.has("fresh")));
	});

	/** `GET /api/calendar/local`: every event kept on this computer. */
	const localCalendarEvents = get(() => answer(async (): Promise<LocalEventsAnswer> => ({ events: [...localEvents.value] })));

	/** `PUT /api/calendar/events/new`: `NewEvent`, kept on this computer or added to a Google calendar you may write to; answers `NewEventAnswer`. */
	const eventCreate = write(
		body => checked(parseNewEvent(body), "Expected { title, when, calendar }: a title, an all-day span of days or a timed span that ends after it starts, and this computer or a Google calendar"),
		async ({ title, when, calendar }): Promise<NewEventAnswer> => {
			switch (calendar.kind) {
				case "local":
					return { kept: localEvents.add(title, when) };
				case "google":
					await google.create(calendar.account, calendar.calendarId, title, when);
					return { kept: null };
				default: {
					const unhandled: never = calendar;
					return unhandled;
				}
			}
		},
	);

	/** `PUT /api/calendar/events/delete`: `EventRef`, deletes an event kept on this computer or of a Google calendar you may write to; answers `{}`. */
	const eventDelete = write(
		body => checked(parseEventRef(body), 'Expected { kind: "local", id } or { kind: "google", account, calendarId, eventId } naming an event'),
		async (event): Promise<object> => {
			switch (event.kind) {
				case "local":
					localEvents.apply({ op: "remove", id: event.id });
					return {};
				case "google":
					await google.delete(event.account, event.calendarId, event.eventId);
					return {};
				default: {
					const unhandled: never = event;
					return unhandled;
				}
			}
		},
	);

	return {
		"/api/google": { GET: googleStatus },
		"/api/google/calendars": { PUT: calendarShown },
		"/api/calendar/events": { GET: calendarEvents },
		"/api/calendar/events/new": { PUT: eventCreate },
		"/api/calendar/events/delete": { PUT: eventDelete },
		"/api/calendar/local": { GET: localCalendarEvents },
	};
}
