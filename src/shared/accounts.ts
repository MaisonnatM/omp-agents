/** The integrations: omp's MCP sign-ins and the dashboard's Google sign-in, and the Google calendar events they read. */

/** A sign-in that the integrations page started: waiting for the browser at the provider's authorization `url`, or why it failed. */
export type SignInState = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** The services whose MCP server the integrations page signs omp in to. */
export const MCP_INTEGRATIONS = ["linear"] as const;
export type McpIntegrationId = (typeof MCP_INTEGRATIONS)[number];

export const isMcpIntegration = (value: unknown): value is McpIntegrationId => MCP_INTEGRATIONS.some(id => id === value);

/** omp's MCP server for a service: its name in omp's MCP config, and its URL. */
export interface McpServerRef {
	name: string;
	url: string;
}

/**
 * Where omp stands with a service's MCP server: no server in omp's config, a server without a sign-in, or what listing
 * its tools with the sign-in found: the tools, the server refusing the sign-in, or another failure.
 */
export type McpConnection =
	| { kind: "absent" }
	| { kind: "signed-out"; server: McpServerRef }
	| { kind: "ready"; server: McpServerRef; tools: string[] }
	| { kind: "refused"; server: McpServerRef; error: string }
	| { kind: "failing"; server: McpServerRef; error: string };

/** Whether omp holds a sign-in for the service, working or not. */
export const signedIn = (connection: McpConnection): boolean => connection.kind !== "absent" && connection.kind !== "signed-out";

/** One service of `GET /api/integrations`, and what `PUT /api/integrations/sign-in` and `/sign-out` answer. */
export interface McpIntegration {
	id: McpIntegrationId;
	connection: McpConnection;
	/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
	signIn: SignInState;
}

/** `GET /api/integrations[?fresh]`: every MCP integration, in the order of {@link MCP_INTEGRATIONS}. */
export interface IntegrationsAnswer {
	integrations: McpIntegration[];
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
