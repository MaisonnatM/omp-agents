/** The integrations: omp's MCP sign-ins, and the Google calendar events the Google Calendar sign-in reads. */

/** A sign-in that the integrations page started: waiting for the browser at the provider's authorization `url`, or why it failed. */
export type SignInState = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** The services whose MCP server the integrations page signs omp in to. */
export const MCP_INTEGRATIONS = ["linear", "slack", "google-calendar"] as const;
export type McpIntegrationId = (typeof MCP_INTEGRATIONS)[number];

/**
 * User scopes a dedicated Slack app may grant for normal chat.
 * Search, history, channel membership, users, and sending. Canvas, list, file, reaction, and channel-creation scopes stay out.
 */
export const SLACK_USER_SCOPES = [
	"search:read.public",
	"search:read.private",
	"search:read.mpim",
	"search:read.im",
	"search:read.users",
	"channels:history",
	"groups:history",
	"mpim:history",
	"im:history",
	"channels:read",
	"groups:read",
	"mpim:read",
	"im:read",
	"users:read",
	"chat:write",
] as const;

const SLACK_SCOPE: Record<string, true> = Object.fromEntries(SLACK_USER_SCOPES.map(scope => [scope, true]));

/**
 * `input` as a unique space-separated subset of {@link SLACK_USER_SCOPES}, or `null` when it is empty or names anything else.
 * Commas and extra whitespace are separators, not part of a scope.
 */
export function normalizeSlackScope(input: string): string | null {
	const scopes = input.trim().split(/[\s,]+/).filter(Boolean);
	if (scopes.length === 0 || scopes.some(scope => !Object.hasOwn(SLACK_SCOPE, scope))) return null;
	return [...new Set(scopes)].join(" ");
}

const SLACK_LOOPBACK: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true };

/** Why `redirectUri` cannot be the Slack app's registered redirect for a listener on `callbackPort`, or `null` when it can. */
export function slackRedirectError(redirectUri: string, callbackPort: number): string | null {
	let url: URL;
	try {
		url = new URL(redirectUri);
	} catch {
		return "Enter the HTTPS redirect registered on the Slack app.";
	}
	if (url.protocol !== "https:") return "Slack needs an HTTPS redirect. Forward it to the local HTTP callback with a TLS terminator.";
	const registeredPort = url.port ? Number(url.port) : 443;
	if ((Object.hasOwn(SLACK_LOOPBACK, url.hostname) || url.hostname.endsWith(".localhost")) && registeredPort === callbackPort) {
		return "The HTTPS redirect port and the local callback port must differ. Terminate TLS on the redirect port and forward to the callback port.";
	}
	return null;
}

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
	slack: { label: "Slack", host: "mcp.slack.com", url: "https://mcp.slack.com/mcp", serverName: "slack" },
	"google-calendar": { label: "Google Calendar", host: "calendarmcp.googleapis.com", url: "https://calendarmcp.googleapis.com/mcp/v1", serverName: "google-calendar" },
};

/**
 * What the Google Calendar sign-in asks for: events, to read them here and let omp sessions write them, the calendar
 * list, to know which calendars you show, and free/busy, which the MCP server's scheduling tool reads.
 */
export const GOOGLE_CALENDAR_SCOPES = [
	"https://www.googleapis.com/auth/calendar.events",
	"https://www.googleapis.com/auth/calendar.calendarlist.readonly",
	"https://www.googleapis.com/auth/calendar.events.freebusy",
] as const;

/** The port omp listens on for Google's redirect unless the setup names another. */
export const DEFAULT_GOOGLE_CALLBACK_PORT = 3119;

/** The redirect Google sends the browser back to, which the OAuth client must list, for a listener on `callbackPort`. */
export const googleRedirectUri = (callbackPort: number): string => `http://localhost:${callbackPort}/callback`;

/** A Google OAuth client ID, as the Google Cloud console shows it. */
export const GOOGLE_CLIENT_ID = /^[\w-]+\.apps\.googleusercontent\.com$/;

/** Slack app settings the integrations page can show. The client secret stays in omp's config. */
export interface SlackSetup {
	clientId: string | null;
	hasClientSecret: boolean;
	redirectUri: string | null;
	callbackPort: number;
	scope: string;
	/** The saved client, secret, scope, redirect, and callback port are complete and valid. */
	configured: boolean;
}

/** `PUT /api/integrations/slack/client`. An omitted or empty `clientSecret` keeps the saved secret for the same client ID. */
export interface SlackClientInput {
	clientId: string;
	clientSecret?: string;
	redirectUri: string;
	callbackPort: number;
	scope: string;
}

/** Google Calendar's OAuth client settings the integrations page can show. The client secret stays in omp's config. */
export interface GoogleSetup {
	clientId: string | null;
	hasClientSecret: boolean;
	callbackPort: number;
	/** The saved client, secret, and callback port are complete and valid. */
	configured: boolean;
}

/** `PUT /api/integrations/google-calendar/client`. An omitted or empty `clientSecret` keeps the saved secret for the same client ID. */
export interface GoogleClientInput {
	clientId: string;
	clientSecret?: string;
	callbackPort: number;
}

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

/** Each service's saved OAuth client, without the secret: `null` for Linear, which registers its own. */
export interface McpSetups {
	linear: null;
	slack: SlackSetup;
	"google-calendar": GoogleSetup;
}

/** One service of `GET /api/integrations`, and what `PUT /api/integrations/sign-in`, `/sign-out`, and `/<id>/client` answer. */
export type McpIntegration<Id extends McpIntegrationId = McpIntegrationId> = {
	[K in Id]: {
		id: K;
		connection: McpConnection;
		/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
		signIn: SignInState;
		setup: McpSetups[K];
	};
}[Id];

/** `GET /api/integrations[?fresh]`: every MCP integration by its id. */
export interface IntegrationsAnswer {
	integrations: { [K in McpIntegrationId]: McpIntegration<K> };
}

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

/** An event of one of your Google calendars, read-only. */
export interface CalendarEvent {
	/** The calendar's id, a slash, and the event's; each repeat has its own event id. */
	id: string;
	title: string;
	/** The calendar's name, as {@link GoogleCalendar} has it. */
	calendar: string;
	/** The calendar's color, `#rrggbb`. */
	color: string;
	/** The event in Google Calendar. */
	url: string;
	/** An all-day event's first and last days, `YYYY-MM-DD`, or a timed event's start and end, epoch milliseconds. */
	when: { allDay: true; firstDay: string; lastDay: string } | { allDay: false; start: number; end: number };
}

/** `GET /api/calendar/events?from=<ISO time>&to=<ISO time>[&fresh]`: the events of your shown calendars that overlap that span. */
export interface CalendarEventsAnswer {
	events: CalendarEvent[];
}
