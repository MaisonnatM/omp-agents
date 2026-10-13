/** The Calendar page's events: your Google calendars and their events, the events it adds, and the events kept on this computer. */
import { isDay, isObject, isSafeInteger, type Parsed } from "../json";

/** A calendar shown in your Google Calendar, which the Calendar page reads unless you unchecked it there. */
export interface GoogleCalendar {
	/** Google's id for it: your email for your main calendar, else an address Google made. */
	id: string;
	/** Its name in your calendar list. */
	name: string;
	/** Its color in your calendar list, `#rrggbb`. */
	color: string;
	/** Google Calendar's group for it: `mine` for a calendar you own, `other` for one you subscribed to or that others share. */
	group: "mine" | "other";
	/** Whether you may add events to it: Google lists you as its owner or a writer. */
	writable: boolean;
	/** Whether the Calendar page shows its events; `false` once you uncheck it in the page's sidebar. */
	shown: boolean;
	/** Why the last read of its events failed; `null` once one works. */
	error: string | null;
}

/** `GET /api/google` and what `PUT /api/google/calendars` answers: the calendars checked in Google Calendar's own list. */
export interface GoogleStatus {
	calendars: GoogleCalendar[];
}

/** `PUT /api/google/calendars`: show or hide one calendar's events on the Calendar page. */
export interface CalendarShownInput {
	id: string;
	shown: boolean;
}

/** An all-day event's first and last days, `YYYY-MM-DD`, or a timed event's start and end, epoch ms. */
export type EventWhen = { allDay: true; firstDay: string; lastDay: string } | { allDay: false; start: number; end: number };

/** An event's days or times, as a new event carries them and `events.json` keeps them: all-day days that do not run backward, or a timed span that ends after it starts. */
export function parseEventWhen(value: unknown): Parsed<EventWhen> {
	if (!isObject(value)) return null;
	if (value.allDay === true) return isDay(value.firstDay) && isDay(value.lastDay) && value.lastDay >= value.firstDay ? { ok: { allDay: true, firstDay: value.firstDay, lastDay: value.lastDay } } : null;
	if (value.allDay === false) return isSafeInteger(value.start) && isSafeInteger(value.end) && value.end > value.start ? { ok: { allDay: false, start: value.start, end: value.end } } : null;
	return null;
}

/** An event of one of your Google calendars. */
export interface CalendarEvent {
	/** Its calendar's id, as {@link GoogleCalendar} has it. */
	calendarId: string;
	/** Google's id for it; each repeat has its own, as Google lists them with `singleEvents`. */
	eventId: string;
	/** Whether you may delete it: its calendar's `writable`. */
	writable: boolean;
	title: string;
	/** The calendar's name, as {@link GoogleCalendar} has it. */
	calendar: string;
	/** The calendar's color, `#rrggbb`. */
	color: string;
	/** The event in Google Calendar. */
	url: string;
	when: EventWhen;
}

/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of your shown calendars that overlap that span. */
export interface CalendarEventsAnswer {
	events: CalendarEvent[];
}

/** The longest title a new event takes. */
export const MAX_EVENT_TITLE = 500;

/** The calendar a new event goes in: this computer, or a Google calendar you may write to. */
export type NewEventCalendar = { kind: "local" } | { kind: "google"; calendarId: string };

/** `PUT /api/calendar/events/new`. */
export interface NewEvent {
	title: string;
	when: EventWhen;
	calendar: NewEventCalendar;
}

/** What `PUT /api/calendar/events/new` answers: the event as kept on this computer, or `null` for one added to a Google calendar. */
export interface NewEventAnswer {
	kept: LocalEvent | null;
}

/** An event kept on this computer, in `events.json`. */
export interface LocalEvent {
	id: string;
	title: string;
	when: EventWhen;
}

/** `GET /api/calendar/local`: every event kept on this computer. */
export interface LocalEventsAnswer {
	events: LocalEvent[];
}

/** An event kept on this computer, by its id. */
export type LocalEventRef = { kind: "local"; id: string };

/** An event of one of your Google calendars, by its calendar's id and its own; a repeat's `eventId` names only that one day's repeat. */
export type GoogleEventRef = { kind: "google"; calendarId: string; eventId: string };

/** The event `PUT /api/calendar/events/delete` deletes: one kept on this computer, or one of a Google calendar you may write to. */
export type EventRef = LocalEventRef | GoogleEventRef;
