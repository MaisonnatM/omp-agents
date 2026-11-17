/** What Settings › Integrations shows of each MCP-backed service, shared by its rows and Settings › MCP servers. */
import { type McpConnection, type McpIntegration, type McpIntegrationId, signedIn } from "../../../src/shared/accounts";
import { type BrandLogo, SLACK_LOGO } from "./brand-logos";
import { REMOTE_STATUS, type StatusLabel, WAITING_STATUS } from "./mcp-connection-controls";

interface Service {
	logo: BrandLogo;
	/** What the connection gives the dashboard and omp's sessions. */
	gives: string;
	/** What the service's own OAuth client is called. */
	client: string;
}

export const SERVICES: Record<McpIntegrationId, Service> = {
	slack: {
		logo: SLACK_LOGO,
		gives: "Search, read, and send in the conversations you grant, in every omp session.",
		client: "Dedicated internal app",
	},
};

const STATUS: Record<McpConnection["kind"], StatusLabel> = { absent: { label: "Not connected", color: "gray" }, ...REMOTE_STATUS };

/** A service row's badge: a sign-in waiting on you, else a missing OAuth client, else its connection. */
export function integrationStatus(integration: McpIntegration): StatusLabel {
	const { signIn, setup, connection } = integration;
	if (signIn?.phase === "waiting") return WAITING_STATUS;
	return !setup.configured && !signedIn(connection) ? { label: "Not set up", color: "gray" } : STATUS[connection.kind];
}
