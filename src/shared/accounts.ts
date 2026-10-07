/** The integrations: omp's MCP sign-ins and the dashboard's Google sign-in, and the Google calendar events they read. */

/** A sign-in that the integrations page started: waiting for the browser at the provider's authorization `url`, or why it failed. */
export type SignInState = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** The services whose MCP server the integrations page signs omp in to. */
export const MCP_INTEGRATIONS = ["linear", "slack"] as const;
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
};

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

/** One service of `GET /api/integrations`, and what `PUT /api/integrations/sign-in`, `/sign-out`, and `/slack/client` answer. */
export interface McpIntegration {
	id: McpIntegrationId;
	connection: McpConnection;
	/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
	signIn: SignInState;
	/** Slack's saved app, without the secret. `null` for Linear, which registers its own client. */
	setup: SlackSetup | null;
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
