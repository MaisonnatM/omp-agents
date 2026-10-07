/** The integrations: omp's MCP sign-ins and the dashboard's Google sign-in, and the Google calendar events they read. */

/** A sign-in that the integrations page started: waiting for the browser at the provider's authorization `url`, or why it failed. */
export type SignInState = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** The services whose MCP server the integrations page signs omp in to. */
export const MCP_INTEGRATIONS = ["linear"] as const;
export type McpIntegrationId = (typeof MCP_INTEGRATIONS)[number];

export interface McpService {
	label: string;
	/** The host omp's server for the service is on, whatever omp named it. */
	host: string;
	/** The server a sign-in adds, under `serverName` in omp's MCP config, when omp has none. */
	url: string;
	serverName: string;
}

export const MCP_SERVICES: Record<McpIntegrationId, McpService> = {
	linear: { label: "Linear", host: "mcp.linear.app", url: "https://mcp.linear.app/mcp", serverName: "linear" },
};

/** omp's MCP server for a service: its name in omp's MCP config, its URL, and that URL's host. */
export interface McpServerRef {
	name: string;
	url: string;
	host: string;
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

/** Whether omp holds a sign-in for the service, working or not: its row sits under Connected, and Linear's Tickets tab shows. */
export const signedIn = (connection: McpConnection): boolean => connection.kind !== "absent" && connection.kind !== "signed-out";

/** Whether the dashboard calls the service's tools: the server took omp's sign-in, or failed for a reason a retry may clear. */
export const callable = (connection: McpConnection): boolean => connection.kind === "ready" || connection.kind === "failing";

/** One service of `GET /api/integrations`, and what `PUT /api/integrations/sign-in` and `/sign-out` answer. */
export interface McpIntegration {
	id: McpIntegrationId;
	connection: McpConnection;
	/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
	signIn: SignInState;
}

/** `GET /api/integrations[?fresh]`: every MCP integration by its id. */
export interface IntegrationsAnswer {
	integrations: Record<McpIntegrationId, McpIntegration>;
}

/** A Google calendar the dashboard reads from its secret address in iCal format. The address never leaves the server. */
export interface GoogleCalendarFeed {
	/** A hash of the address: stable, and safe to send to the page. */
	id: string;
	/** The calendar's name in Google Calendar; your main calendar's is your email. */
	name: string;
	/** `#rrggbb`, from Google's palette, the first one no other calendar here uses. */
	color: string;
	/** Why the last read failed; `null` once one works. */
	error: string | null;
}

/** `GET /api/google`, and the writes under it: the calendars the Calendar page reads. */
export interface GoogleStatus {
	calendars: GoogleCalendarFeed[];
}

/** An event of one of your Google calendars, read-only. */
export interface CalendarEvent {
	/** The calendar's id, a slash, and the event's, then for a repeat a slash and when it was due, since one event can sit in two calendars and repeat. */
	id: string;
	title: string;
	/** The calendar's name, as {@link GoogleCalendarFeed} has it. */
	calendar: string;
	/** The calendar's color, `#rrggbb`. */
	color: string;
	/** The day of the event in Google Calendar, since the iCal format links to no event. */
	url: string;
	/** An all-day event's first and last days, `YYYY-MM-DD`, or a timed event's start and end, epoch milliseconds. */
	when: { allDay: true; firstDay: string; lastDay: string } | { allDay: false; start: number; end: number };
}

/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of your added calendars that overlap that span. */
export interface CalendarEventsAnswer {
	events: CalendarEvent[];
}
