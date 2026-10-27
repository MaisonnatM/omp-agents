/** What Settings › Integrations shows of each MCP-backed service, shared by its rows and Settings › MCP servers. */
import { googleMcpEnableUrl, isGoogleIntegration, type McpConnection, type McpIntegration, type McpIntegrationId } from "../../../src/shared/accounts";
import { type BrandLogo, GMAIL_LOGO, GOOGLE_CALENDAR_LOGO, LINEAR_LOGO, SLACK_LOGO } from "./brand-logos";
import { GOOGLE_TEXT } from "./google-client-form";
import { REMOTE_STATUS, type StatusLabel } from "./mcp-connection-controls";

interface Service {
	logo: BrandLogo;
	/** What the connection gives the dashboard and omp's sessions. */
	gives: string;
	/** What the service's own OAuth client is called, for a service that needs one. */
	client?: string;
}

export const SERVICES: Record<McpIntegrationId, Service> = {
	linear: {
		logo: LINEAR_LOGO,
		gives: "Your assigned issues on the Tickets tab, and Linear's tools in every omp session.",
	},
	slack: {
		logo: SLACK_LOGO,
		gives: "Search, read, and send in the conversations you grant, in every omp session.",
		client: "Dedicated internal app",
	},
	"google-calendar": {
		logo: GOOGLE_CALENDAR_LOGO,
		gives: "Your accounts' calendars on the Calendar tab, and each account's Google Calendar tools in every omp session.",
		client: "Your Google OAuth client",
	},
	gmail: {
		logo: GMAIL_LOGO,
		gives: "Your accounts' inboxes on the Email tab, with replies and Delete, and each account's Gmail tools in every omp session.",
		client: "Your Google OAuth client",
	},
};

export const STATUS: Record<McpConnection["kind"], StatusLabel> = { absent: { label: "Not connected", color: "gray" }, ...REMOTE_STATUS };

/** For a Google server that answered 403, the API to turn on and Google's page that turns it on; otherwise `null`. */
export function googleApiOff(integration: McpIntegration, connection: Extract<McpConnection, { kind: "failing" }>): { api: string; url: string } | null {
	if (!isGoogleIntegration(integration) || connection.status !== 403 || !integration.setup.clientId) return null;
	const url = googleMcpEnableUrl(connection.server.host, integration.setup.clientId);
	return url ? { api: GOOGLE_TEXT[integration.id].mcpApi, url } : null;
}
