/**
 * Google Calendar, read-only: the calendars checked in your Google Calendar's list and their events, which the Calendar
 * page lists unless you unchecked a calendar there. It reads Google's Calendar API with the token omp holds for its
 * Google Calendar MCP server, the same sign-in and scopes: the server's own tools answer only for OAuth clients in
 * Google's Developer Preview Program.
 */
import { createCache } from "./cache";
import { errorText, isObject, nonEmptyStr, str } from "./json";
import type { CalendarEvent, CalendarEventsAnswer, GoogleCalendar, GoogleStatus } from "./shared/accounts";

const API = "https://www.googleapis.com/calendar/v3";

/** Google Calendar's default calendar color, for a list entry that names none. */
const DEFAULT_COLOR = "#039be5";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Reads the JSON at a Google Calendar API address with your sign-in. */
export type GoogleGet = (url: string) => Promise<unknown>;

/** A calendar list entry as Google Calendar lists it, before the Calendar page's own checkbox and last read. */
type ListedCalendar = Omit<GoogleCalendar, "shown" | "error">;

/** A calendar list entry as the page shows it, or `null` for one unchecked in Google Calendar or without an id. */
function calendarOf(item: unknown): ListedCalendar | null {
	if (!isObject(item) || item.selected !== true) return null;
	const id = nonEmptyStr(item.id);
	if (!id) return null;
	const color = str(item.backgroundColor);
	return {
		id,
		name: nonEmptyStr(item.summaryOverride) ?? nonEmptyStr(item.summary) ?? id,
		color: color && HEX_COLOR.test(color) ? color : DEFAULT_COLOR,
		group: item.accessRole === "owner" ? "mine" : "other",
	};
}

/** The day before `day`, both `YYYY-MM-DD`. */
const dayBefore = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * One event as the page shows it, or `null` for one Google Calendar hides or draws apart: canceled, declined by you,
 * a working location, or with no length.
 */
function eventOf(item: unknown, calendar: ListedCalendar): CalendarEvent | null {
	if (!isObject(item) || item.status === "cancelled" || item.eventType === "workingLocation") return null;
	const id = nonEmptyStr(item.id);
	if (!id || !isObject(item.start) || !isObject(item.end)) return null;
	const attendees = Array.isArray(item.attendees) ? item.attendees : [];
	if (attendees.some(attendee => isObject(attendee) && attendee.self === true && attendee.responseStatus === "declined")) return null;
	const event = {
		id: `${calendar.id}/${id}`,
		title: nonEmptyStr(item.summary) ?? "(No title)",
		calendar: calendar.name,
		color: calendar.color,
		url: nonEmptyStr(item.htmlLink) ?? "https://calendar.google.com/calendar/r",
	};
	const firstDay = str(item.start.date);
	if (firstDay) {
		// Google ends an all-day event on the day after it.
		const end = str(item.end.date);
		return { ...event, when: { allDay: true, firstDay, lastDay: end && end > firstDay ? dayBefore(end) : firstDay } };
	}
	const start = Date.parse(str(item.start.dateTime) ?? "");
	const end = Date.parse(str(item.end.dateTime) ?? "");
	return end > start ? { ...event, when: { allDay: false, start, end } } : null;
}

/** The calendars your Google Calendar shows, and the events of those the Calendar page shows, each read at most once a minute. */
export class GoogleCalendarReader {
	readonly #get: GoogleGet;
	/** The ids of the calendars the Calendar page's sidebar unchecked. */
	readonly #hidden: () => ReadonlySet<string>;
	readonly #lists = createCache<ListedCalendar[]>(60_000);
	/** Each calendar's events by calendar and span. */
	readonly #reads = createCache<CalendarEvent[]>(60_000);
	/** Why each calendar's last read failed, by its id. */
	readonly #errors = new Map<string, string>();

	constructor(get: GoogleGet, hidden: () => ReadonlySet<string>) {
		this.#get = get;
		this.#hidden = hidden;
	}

	/** Every item of the list at `url`, following Google's page tokens. */
	async #items(url: URL): Promise<unknown[]> {
		const items: unknown[] = [];
		for (;;) {
			const page = await this.#get(url.toString());
			if (!isObject(page)) throw new Error("Google Calendar answered something other than a list");
			if (Array.isArray(page.items)) items.push(...page.items);
			const next = nonEmptyStr(page.nextPageToken);
			if (!next) return items;
			url.searchParams.set("pageToken", next);
		}
	}

	#calendars(fresh: boolean): Promise<ListedCalendar[]> {
		return this.#lists.get(
			"",
			async () => {
				const url = new URL(`${API}/users/me/calendarList`);
				url.searchParams.set("maxResults", "250");
				return (await this.#items(url)).flatMap(item => calendarOf(item) ?? []);
			},
			fresh,
		);
	}

	/** The calendars checked in Google Calendar's list, each with whether the Calendar page shows it and why its last read failed. `fresh` lists them again. */
	async status(fresh = false): Promise<GoogleStatus> {
		const hidden = this.#hidden();
		return { calendars: (await this.#calendars(fresh)).map(calendar => ({ ...calendar, shown: !hidden.has(calendar.id), error: this.#errors.get(calendar.id) ?? null })) };
	}

	#events(calendar: ListedCalendar, from: Date, to: Date, fresh: boolean): Promise<CalendarEvent[]> {
		const [timeMin, timeMax] = [from.toISOString(), to.toISOString()];
		return this.#reads.get(
			`${calendar.id} ${timeMin} ${timeMax}`,
			async () => {
				const url = new URL(`${API}/calendars/${encodeURIComponent(calendar.id)}/events`);
				for (const [key, value] of Object.entries({ singleEvents: "true", orderBy: "startTime", timeMin, timeMax, maxResults: "2500" })) url.searchParams.set(key, value);
				return (await this.#items(url)).flatMap(item => eventOf(item, calendar) ?? []);
			},
			fresh,
		);
	}

	/**
	 * The events from `from` to `to` of the shown calendars, each repeat apart. `fresh` reads every calendar again.
	 * A calendar unchecked on the Calendar page is not read. A calendar that cannot be read keeps its error for the
	 * settings, and the others still answer; only when none can is it an error.
	 */
	async events(from: Date, to: Date, fresh = false): Promise<CalendarEventsAnswer> {
		const listed = await this.#calendars(fresh);
		if (listed.length === 0) throw new Error("No calendar is checked in your Google Calendar's list. Check one there to see its events here.");
		const hidden = this.#hidden();
		const calendars = listed.filter(calendar => !hidden.has(calendar.id));
		if (calendars.length === 0) return { events: [] };
		const lists = await Promise.all(
			calendars.map(async calendar => {
				try {
					const events = await this.#events(calendar, from, to, fresh);
					this.#errors.delete(calendar.id);
					return events;
				} catch (err) {
					this.#errors.set(calendar.id, errorText(err));
					return null;
				}
			}),
		);
		const read = lists.filter(list => list !== null);
		if (read.length === 0) throw new Error(this.#errors.get(calendars[0]!.id));
		return { events: read.flat() };
	}
}
