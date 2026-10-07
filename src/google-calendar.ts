/**
 * Google Calendar, read-only: the secret addresses in iCal format you add in the settings, and the events of those
 * calendars, which the Calendar page lists. Each address is a calendar's whole feed, which the server expands by span.
 */
import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { createCache } from "./cache";
import { JsonFile } from "./fs";
import { errorText, isObject, nonEmptyStr } from "./json";
import type { CalendarEvent, CalendarEventsAnswer, GoogleCalendarFeed, GoogleStatus } from "./shared/accounts";

/** A Google calendar's secret or public address in iCal format, its calendar id first, as its **Integrate calendar** settings show it. */
export const GOOGLE_ICAL_ADDRESS = /^https:\/\/calendar\.google\.com\/calendar\/ical\/([^/?#]+)\/(?:private-[0-9a-f]+|public)\/basic\.ics$/;

/** Google Calendar's own event colors, which new calendars take in turn. */
const PALETTE = ["#039be5", "#33b679", "#8e24aa", "#e67c73", "#f6bf26", "#f4511e", "#7986cb", "#0b8043", "#3f51b5", "#d50000", "#616161"];

const DAY_VIEW = "https://calendar.google.com/calendar/r/day";

interface StoredCalendar {
	url: string;
	name: string;
	color: string;
}

interface Stored {
	calendars: StoredCalendar[];
}

function parseStored(json: unknown): Stored | null {
	if (!isObject(json) || !Array.isArray(json.calendars)) return null;
	const calendars = json.calendars.flatMap(item => {
		if (!isObject(item)) return [];
		const url = nonEmptyStr(item.url);
		const name = nonEmptyStr(item.name);
		const color = nonEmptyStr(item.color);
		return url && name && color && GOOGLE_ICAL_ADDRESS.test(url) ? [{ url, name, color }] : [];
	});
	return { calendars };
}

/** The email of the account whose calendar `url` is, or `null` for a shared or holiday calendar, whose id is Google's. */
function ownerOf(url: string): string | null {
	let id: string;
	try {
		id = decodeURIComponent(GOOGLE_ICAL_ADDRESS.exec(url)?.[1] ?? "").toLowerCase();
	} catch {
		return null;
	}
	return id.includes("@") && !id.endsWith("calendar.google.com") ? id : null;
}

/** An added calendar: its address, what the settings show of it, and `owner`, whose declined events it leaves out. */
interface Calendar extends GoogleCalendarFeed {
	url: string;
	owner: string | null;
}

const calendarOf = ({ url, name, color }: StoredCalendar): Calendar => ({
	url,
	id: createHash("sha256").update(url).digest("hex").slice(0, 12),
	name,
	color,
	owner: ownerOf(url),
	error: null,
});

/** One occurrence of an event as the page shows it, or `null` for one Google Calendar hides: canceled, declined, or with no length. */
function toCalendarEvent(item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, id: string, calendar: Pick<Calendar, "name" | "color" | "owner">): CalendarEvent | null {
	if (item.component.getFirstPropertyValue("status") === "CANCELLED") return null;
	const { owner } = calendar;
	if (owner && item.attendees.some(attendee => String(attendee.getFirstValue()).toLowerCase() === `mailto:${owner}` && attendee.getParameter("partstat") === "DECLINED")) return null;
	const event = { id, title: item.summary || "(No title)", calendar: calendar.name, color: calendar.color };
	if (start.isDate) {
		const firstDay = start.toString();
		// iCal ends an all-day event on the day after it.
		const last = end.clone();
		last.adjust(-1, 0, 0, 0);
		const lastDay = end.isDate && last.compare(start) > 0 ? last.toString() : firstDay;
		return { ...event, url: `${DAY_VIEW}/${start.year}/${start.month}/${start.day}`, when: { allDay: true, firstDay, lastDay } };
	}
	const [startAt, endAt] = [start.toJSDate(), end.toJSDate()];
	if (endAt <= startAt) return null;
	const url = `${DAY_VIEW}/${startAt.getFullYear()}/${startAt.getMonth() + 1}/${startAt.getDate()}`;
	return { ...event, url, when: { allDay: false, start: startAt.getTime(), end: endAt.getTime() } };
}

/** The calendar `ics` describes, checked to be one, with the time zones its events name registered. */
export function parseFeed(ics: string): ICAL.Component {
	let root: ICAL.Component | null;
	try {
		root = new ICAL.Component(ICAL.parse(ics));
	} catch {
		root = null;
	}
	if (root?.name !== "vcalendar") throw new Error("The address answered something other than a calendar");
	for (const zone of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(zone);
	return root;
}

/** The events of `root` that overlap `from` to `to`, each repeat apart, with Google's moved and removed repeats applied. */
export function expandFeed(root: ICAL.Component, calendar: Pick<Calendar, "id" | "name" | "color" | "owner">, from: Date, to: Date): CalendarEvent[] {
	const [start, end] = [ICAL.Time.fromJSDate(from, true), ICAL.Time.fromJSDate(to, true)];
	const events: CalendarEvent[] = [];
	/** Adds `item` from `first` to `last` when it overlaps the span; `due` is a repeat's original start, which its id ends with. */
	const emit = (item: ICAL.Event, first: ICAL.Time, last: ICAL.Time, due?: ICAL.Time): void => {
		if (last.compare(start) <= 0 || first.compare(end) >= 0) return;
		const event = toCalendarEvent(item, first, last, due ? `${calendar.id}/${item.uid}/${due}` : `${calendar.id}/${item.uid}`, calendar);
		if (event) events.push(event);
	};
	const masters = new Map<string, ICAL.Event>();
	const moved: ICAL.Event[] = [];
	for (const component of root.getAllSubcomponents("vevent")) {
		const event = new ICAL.Event(component);
		if (event.isRecurrenceException()) moved.push(event);
		else masters.set(event.uid, event);
	}
	for (const event of moved) {
		const master = masters.get(event.uid);
		if (master) master.relateException(event);
		// A repeat that moved, in a feed without its series, stands alone.
		else emit(event, event.startDate, event.endDate, event.recurrenceId);
	}
	for (const event of masters.values()) {
		if (!event.isRecurring()) {
			emit(event, event.startDate, event.endDate);
			continue;
		}
		const repeats = event.iterator();
		for (let due = repeats.next(); due && due.compare(end) < 0; due = repeats.next()) {
			const occurrence = event.getOccurrenceDetails(due);
			emit(occurrence.item, occurrence.startDate, occurrence.endDate, due);
		}
	}
	return events;
}

/** The Google calendars the settings added, kept in `path` with the owner's permissions only, since each address reads its calendar. */
export class GoogleCalendar {
	readonly #file: JsonFile<Stored>;
	#calendars: Calendar[];
	/** Each calendar's feed by address, read at most once a minute. */
	readonly #feeds = createCache<ICAL.Component>(60_000);

	constructor(path: string) {
		this.#file = new JsonFile(path, { parse: parseStored, holds: "a list of Google calendars", onInvalid: "ignore", indent: "\t", mode: 0o600 });
		const stored = this.#file.load();
		this.#calendars = (stored?.calendars ?? []).map(calendarOf);
		// A file that holds something else, such as the OAuth secret an older version kept, is replaced at once.
		if (!stored) this.#save();
	}

	status(): GoogleStatus {
		return { calendars: this.#calendars.map(({ id, name, color, error }) => ({ id, name, color, error })) };
	}

	#save(): void {
		this.#file.save({ calendars: this.#calendars.map(({ url, name, color }) => ({ url, name, color })) });
	}

	/** `url`'s feed, read again when `fresh`. */
	#feed(url: string, fresh: boolean): Promise<ICAL.Component> {
		return this.#feeds.get(
			url,
			async () => {
				const response = await fetch(url);
				if (!response.ok) throw new Error(`Google answered ${response.status} for this calendar's address`);
				return parseFeed(await response.text());
			},
			fresh,
		);
	}

	/** Adds the calendar at `url`, a Google address in iCal format, once its feed reads as a calendar. Adding one twice keeps one. */
	async add(url: string): Promise<GoogleStatus> {
		if (this.#calendars.some(calendar => calendar.url === url)) return this.status();
		const root = await this.#feed(url, true);
		const used = new Set(this.#calendars.map(calendar => calendar.color));
		const color = PALETTE.find(candidate => !used.has(candidate)) ?? PALETTE[this.#calendars.length % PALETTE.length];
		const name = nonEmptyStr(root.getFirstPropertyValue("x-wr-calname")) ?? ownerOf(url) ?? "Google Calendar";
		this.#calendars = [...this.#calendars, calendarOf({ url, name, color })];
		this.#save();
		return this.status();
	}

	remove(id: string): GoogleStatus {
		const removed = this.#calendars.find(calendar => calendar.id === id);
		if (removed) {
			this.#feeds.drop(removed.url);
			this.#calendars = this.#calendars.filter(calendar => calendar !== removed);
			this.#save();
		}
		return this.status();
	}

	/**
	 * The events from `from` to `to` of the added calendars, each repeat apart. `fresh` reads every feed again.
	 * A calendar that cannot be read keeps its error for the settings, and the others still answer; only when none can is it an error.
	 */
	async events(from: Date, to: Date, fresh = false): Promise<CalendarEventsAnswer> {
		const lists = await Promise.all(
			this.#calendars.map(async calendar => {
				try {
					const root = await this.#feed(calendar.url, fresh);
					calendar.error = null;
					return expandFeed(root, calendar, from, to);
				} catch (err) {
					calendar.error = errorText(err);
					return null;
				}
			}),
		);
		const read = lists.filter(list => list !== null);
		if (read.length === 0) throw new Error(this.#calendars[0]?.error ?? "No Google calendar is added. Add one in Settings › Integrations.");
		return { events: read.flat() };
	}
}
