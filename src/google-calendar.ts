/**
 * Google Calendar: the calendars checked in your Google Calendar's list and their events, which the Calendar page lists
 * unless you unchecked a calendar there, and the events it adds to and deletes from the calendars you may write to. It
 * calls Google's Calendar API with the token omp holds for its Google Calendar MCP server, the same sign-in and scopes:
 * the server's own tools answer only for OAuth clients in Google's Developer Preview Program. A
 * {@link GoogleCalendarClient} reads one account; {@link GoogleCalendars} merges every signed-in account's.
 */
import { type Cache, createCache } from "./cache";
import type { AccountClients } from "./integrations";
import { errorText, isObject, nonEmptyStr, str } from "./json";
import type { AccountId } from "./shared/accounts";
import type { CalendarEvent, CalendarEventsAnswer, EventWhen, GoogleCalendar, GoogleStatus } from "./shared/calendar";
import { ApiError, type SignedFetch } from "./signed-fetch";

const API = "https://www.googleapis.com/calendar/v3";

/** Google Calendar's default calendar color, for a list entry that names none. */
const DEFAULT_COLOR = "#039be5";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A calendar list entry as Google Calendar lists it, before the Calendar page's own checkbox and last read. */
type ListedCalendar = Omit<GoogleCalendar, "shown" | "error">;

/** What a write says when its calendar is not checked in your Google Calendar's list, or is one named `name` you may only read. */
interface WriteRefusals {
	unlisted: string;
	readOnly: (name: string) => string;
}

/** A calendar list entry of `account` as the page shows it, or `null` for one unchecked in Google Calendar or without an id. */
function calendarOf(item: unknown, account: AccountId): ListedCalendar | null {
	if (!isObject(item) || item.selected !== true) return null;
	const id = nonEmptyStr(item.id);
	if (!id) return null;
	const color = str(item.backgroundColor);
	return {
		account,
		id,
		name: nonEmptyStr(item.summaryOverride) ?? nonEmptyStr(item.summary) ?? id,
		color: color && HEX_COLOR.test(color) ? color : DEFAULT_COLOR,
		group: item.accessRole === "owner" ? "mine" : "other",
		writable: item.accessRole === "owner" || item.accessRole === "writer",
	};
}

/** The day `days` after `day`, both `YYYY-MM-DD`; a negative `days` goes back. */
const dayPlus = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** An all-day event's day, or a timed event's ISO time, as Google's `start` and `end` take them. */
type GoogleTime = { date: string } | { dateTime: string };

/** `when` as Google's `start` and `end`, whose all-day end is the day after the last. */
const googleTimes = (when: EventWhen): { start: GoogleTime; end: GoogleTime } =>
	when.allDay
		? { start: { date: when.firstDay }, end: { date: dayPlus(when.lastDay, 1) } }
		: { start: { dateTime: new Date(when.start).toISOString() }, end: { dateTime: new Date(when.end).toISOString() } };

/**
 * One event as the page shows it, or `null` for one Google Calendar hides or draws apart: canceled, declined by you,
 * a working location, or with no length.
 */
function eventOf(item: unknown, calendar: ListedCalendar): CalendarEvent | null {
	if (!isObject(item) || item.status === "cancelled" || item.eventType === "workingLocation") return null;
	const eventId = nonEmptyStr(item.id);
	if (!eventId || !isObject(item.start) || !isObject(item.end)) return null;
	const attendees = Array.isArray(item.attendees) ? item.attendees : [];
	if (attendees.some(attendee => isObject(attendee) && attendee.self === true && attendee.responseStatus === "declined")) return null;
	const event = {
		account: calendar.account,
		calendarId: calendar.id,
		eventId,
		writable: calendar.writable,
		title: nonEmptyStr(item.summary) ?? "(No title)",
		calendar: calendar.name,
		color: calendar.color,
		url: nonEmptyStr(item.htmlLink) ?? "https://calendar.google.com/calendar/r",
	};
	const firstDay = str(item.start.date);
	if (firstDay) {
		// Google ends an all-day event on the day after it.
		const end = str(item.end.date);
		return { ...event, when: { allDay: true, firstDay, lastDay: end && end > firstDay ? dayPlus(end, -1) : firstDay } };
	}
	const start = Date.parse(str(item.start.dateTime) ?? "");
	const end = Date.parse(str(item.end.dateTime) ?? "");
	return end > start ? { ...event, when: { allDay: false, start, end } } : null;
}

/** The address the sign-in behind `fetch` reads calendars as: Google names your main calendar by it. */
export async function calendarAddress(fetch: SignedFetch): Promise<string> {
	const primary = await fetch(`${API}/users/me/calendarList/primary`);
	const address = isObject(primary) ? nonEmptyStr(primary.id) : undefined;
	if (!address) throw new Error("Google Calendar did not say which address you signed in with");
	return address;
}

/**
 * The calendars account `account`'s Google Calendar shows, and the events of those the Calendar page shows, each read
 * at most once a minute, and the events it adds and deletes.
 */
export class GoogleCalendarClient {
	readonly #fetch: SignedFetch;
	readonly #account: AccountId;
	/** The ids of the calendars the Calendar page's sidebar unchecked. */
	readonly #hidden: () => ReadonlySet<string>;
	readonly #lists = createCache<ListedCalendar[]>(60_000);
	/** Each calendar's events by its id, then by `<timeMin> <timeMax>`. */
	readonly #reads = new Map<string, Cache<CalendarEvent[]>>();
	/** Why each calendar's last read failed, by its id. */
	readonly #errors = new Map<string, string>();

	constructor(fetch: SignedFetch, account: AccountId, hidden: () => ReadonlySet<string>) {
		this.#fetch = fetch;
		this.#account = account;
		this.#hidden = hidden;
	}

	/** Every item of the list at `url`, following Google's page tokens. */
	async #items(url: URL): Promise<unknown[]> {
		const items: unknown[] = [];
		for (;;) {
			const page = await this.#fetch(url.toString());
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
				return (await this.#items(url)).flatMap(item => calendarOf(item, this.#account) ?? []);
			},
			fresh,
		);
	}

	/** The calendars checked in Google Calendar's list, each with whether the Calendar page shows it and why its last read failed. `fresh` lists them again. */
	async calendars(fresh = false): Promise<GoogleCalendar[]> {
		const hidden = this.#hidden();
		return (await this.#calendars(fresh)).map(calendar => ({ ...calendar, shown: !hidden.has(calendar.id), error: this.#errors.get(calendar.id) ?? null }));
	}

	#events(calendar: ListedCalendar, from: Date, to: Date, fresh: boolean): Promise<CalendarEvent[]> {
		const [timeMin, timeMax] = [from.toISOString(), to.toISOString()];
		let reads = this.#reads.get(calendar.id);
		if (!reads) this.#reads.set(calendar.id, (reads = createCache<CalendarEvent[]>(60_000)));
		return reads.get(
			`${timeMin} ${timeMax}`,
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

	/**
	 * Calls `write` with the address of calendar `calendarId`'s events, once the calendar is checked in your Google
	 * Calendar's list and one you may write to, else throws what `refusals` says, then forgets that calendar's kept event
	 * reads, so the next read asks Google again.
	 */
	async #write(calendarId: string, refusals: WriteRefusals, write: (events: string) => Promise<unknown>): Promise<void> {
		const calendar = (await this.#calendars(false)).find(listed => listed.id === calendarId);
		if (!calendar) throw new Error(refusals.unlisted);
		if (!calendar.writable) throw new Error(refusals.readOnly(calendar.name));
		await write(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
		this.#reads.delete(calendarId);
	}

	/**
	 * Adds an event titled `title` to calendar `calendarId`, which must be checked in your Google Calendar's list and one you
	 * may write to. The next read of that calendar's events asks Google again, so it shows the event.
	 */
	async create(calendarId: string, title: string, when: EventWhen): Promise<void> {
		const refusals: WriteRefusals = {
			unlisted: "That calendar is not checked in your Google Calendar's list. Check it there to add events to it.",
			readOnly: name => `You may only read ${name}, so it takes no new events. Pick a calendar you own or may edit.`,
		};
		await this.#write(calendarId, refusals, events => this.#fetch(events, { method: "POST", body: { summary: title, ...googleTimes(when) } }));
	}

	/**
	 * Deletes event `eventId` of calendar `calendarId`, which must be checked in your Google Calendar's list and one you may
	 * write to; a repeat's id deletes only that repeat, and an event already gone counts as deleted. The next read of that
	 * calendar's events asks Google again, so it no longer shows the event.
	 */
	async delete(calendarId: string, eventId: string): Promise<void> {
		const refusals: WriteRefusals = {
			unlisted: "That calendar is not checked in your Google Calendar's list. Check it there to delete its events.",
			readOnly: name => `You may only read ${name}, so its events cannot be deleted here.`,
		};
		await this.#write(calendarId, refusals, async events => {
			try {
				await this.#fetch(`${events}/${encodeURIComponent(eventId)}`, { method: "DELETE" });
			} catch (err) {
				// Google answers 410 for an event deleted a moment ago and 404 once it is purged; the calendar is listed, so the address is right.
				if (!(err instanceof ApiError && (err.status === 404 || err.status === 410))) throw err;
			}
		});
	}
}

/** One account's events over a span, or why they could not be read. */
export type AccountEvents = { account: AccountId; events: CalendarEvent[] } | { account: AccountId; error: string };

/** Every signed-in Google Calendar account's calendars and events merged, and each write sent to the account it names. */
export class GoogleCalendars {
	readonly #clients: AccountClients<GoogleCalendarClient>;

	constructor(clients: AccountClients<GoogleCalendarClient>) {
		this.#clients = clients;
	}

	/** Each signed-in account's calendars, and each account whose list could not be read. `fresh` lists them again. */
	async status(fresh = false): Promise<GoogleStatus> {
		const clients = await this.#clients.signedIn();
		const reads = await Promise.allSettled(clients.map(({ client }) => client.calendars(fresh)));
		return {
			calendars: reads.flatMap(read => (read.status === "fulfilled" ? read.value : [])),
			failed: clients.flatMap(({ account }, at) => {
				const read = reads[at]!;
				return read.status === "rejected" ? [{ account, error: errorText(read.reason) }] : [];
			}),
		};
	}

	/** Each signed-in account's events from `from` to `to`, or why they could not be read. `fresh` reads them again. */
	async byAccount(from: Date, to: Date, fresh = false): Promise<AccountEvents[]> {
		const clients = await this.#clients.signedIn();
		return Promise.all(
			clients.map(({ account, client }) =>
				client.events(from, to, fresh).then(
					({ events }): AccountEvents => ({ account, events }),
					(err: unknown): AccountEvents => ({ account, error: errorText(err) }),
				),
			),
		);
	}

	/** Every signed-in account's events from `from` to `to`; an account that cannot be read is left out, unless none can. */
	async events(from: Date, to: Date, fresh = false): Promise<CalendarEventsAnswer> {
		const read = await this.byAccount(from, to, fresh);
		const failed = read.find(account => "error" in account);
		if (failed && "error" in failed && read.every(account => "error" in account)) throw new Error(failed.error);
		return { events: read.flatMap(account => ("events" in account ? account.events : [])) };
	}

	async create(account: AccountId, calendarId: string, title: string, when: EventWhen): Promise<void> {
		await (await this.#clients.get(account)).create(calendarId, title, when);
	}

	async delete(account: AccountId, calendarId: string, eventId: string): Promise<void> {
		await (await this.#clients.get(account)).delete(calendarId, eventId);
	}
}
