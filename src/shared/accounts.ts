/** Sign-ins to Linear and Google, and the Google calendar events they read. */

/** A sign-in that the settings started, to Linear or Google: waiting for the browser at the provider's authorization `url`, or why it failed. */
export type SignInState = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** `GET /api/linear`, and `PUT /api/linear/sign-in`, which starts a sign-in. */
export interface LinearStatus {
	/** omp has an MCP server for Linear and a sign-in for it, so the tickets page can read the issues. */
	connected: boolean;
	/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
	signIn: SignInState;
}

/** `GET /api/google`, and the writes under it: the OAuth client saved in the settings, and whether it holds a sign-in. The client secret never leaves the server. */
export interface GoogleStatus {
	/** The OAuth client's ID, `null` until one is saved. */
	clientId: string | null;
	/** The server holds a refresh token, so the Calendar page reads your Google calendars. */
	connected: boolean;
	/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
	signIn: SignInState;
}

/** A desktop OAuth client's ID, as Google Cloud's console names it. */
export const GOOGLE_CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/;

/** `PUT /api/google/client`: a desktop OAuth client's ID and secret, as Google Cloud's console shows them. */
export interface GoogleClient {
	clientId: string;
	clientSecret: string;
}

/** An event of one of your Google calendars, read-only. */
export interface CalendarEvent {
	/** The calendar's id, a slash, and the event's, since one event can sit in two calendars. */
	id: string;
	title: string;
	/** The calendar's name, as Google Calendar shows it. */
	calendar: string;
	/** The calendar's color, `#rrggbb`. */
	color: string;
	/** The event in Google Calendar, or Google Calendar itself when Google gives no `https` link. */
	url: string;
	/** An all-day event's first and last days, `YYYY-MM-DD`, or a timed event's start and end, epoch milliseconds. */
	when: { allDay: true; firstDay: string; lastDay: string } | { allDay: false; start: number; end: number };
}

/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of your shown calendars that overlap that span. */
export interface CalendarEventsAnswer {
	events: CalendarEvent[];
}
