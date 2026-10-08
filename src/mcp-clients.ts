/**
 * The OAuth client of the Slack and Google Calendar apps that Settings › Integrations saves: the setup the page shows,
 * read from the user MCP config, and the server entry a save would write, planned from it without writing.
 */
import { type McpServer, type McpServerConfig, credentialFor, readMcpServers, serverOnHost, userMcpConfigPath } from "./omp/mcp";
import {
	DEFAULT_GOOGLE_CALLBACK_PORT,
	GOOGLE_CALENDAR_SCOPES,
	type GoogleClientInput,
	type GoogleSetup,
	googleRedirectUri,
	MCP_SERVICES,
	normalizeSlackScope,
	type SlackClientInput,
	type SlackSetup,
	slackRedirectError,
	SLACK_USER_SCOPES,
} from "./shared/accounts";

const DEFAULT_SLACK_CALLBACK_PORT = 3000;

/** A service's OAuth client settings that cannot be saved as given. */
export class ClientConfigError extends Error {}

export interface ClientSave {
	name: string;
	server: McpServerConfig;
	dropCredentials: boolean;
	credential: McpServer | null;
}

function validPort(port: number | undefined): port is number {
	return typeof port === "number" && Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}

const clientIdOf = (oauth: McpServerConfig["oauth"]): string | null => (typeof oauth?.clientId === "string" ? oauth.clientId.trim() || null : null);
const hasSecret = (oauth: McpServerConfig["oauth"]): boolean => typeof oauth?.clientSecret === "string" && oauth.clientSecret.trim().length > 0;

/** Public Slack setup for one stored server. `undefined` is the state before a save. */
export function slackSetupFrom(server: McpServerConfig | undefined): SlackSetup {
	const oauth = server?.oauth;
	const clientId = clientIdOf(oauth);
	const hasClientSecret = hasSecret(oauth);
	const redirectUri = typeof oauth?.redirectUri === "string" ? oauth.redirectUri.trim() || null : null;
	const storedPort = oauth?.callbackPort;
	const callbackPort = validPort(storedPort) ? storedPort : DEFAULT_SLACK_CALLBACK_PORT;
	const canonical = typeof oauth?.scope === "string" ? normalizeSlackScope(oauth.scope) : null;
	const scope = canonical ?? (typeof oauth?.scope === "string" && oauth.scope.trim() ? oauth.scope.trim() : SLACK_USER_SCOPES.join(" "));
	const configured =
		clientId !== null &&
		hasClientSecret &&
		redirectUri !== null &&
		canonical !== null &&
		validPort(storedPort) &&
		slackRedirectError(redirectUri, storedPort) === null;
	return { clientId, hasClientSecret, redirectUri, callbackPort, scope, configured };
}

/** Public Google Calendar setup for one stored server. A callback port must be saved, since omp's own default differs. */
export function googleSetupFrom(server: McpServerConfig | undefined): GoogleSetup {
	const oauth = server?.oauth;
	const clientId = clientIdOf(oauth);
	const hasClientSecret = hasSecret(oauth);
	const storedPort = oauth?.callbackPort;
	const callbackPort = validPort(storedPort) ? storedPort : DEFAULT_GOOGLE_CALLBACK_PORT;
	return { clientId, hasClientSecret, callbackPort, configured: clientId !== null && hasClientSecret && validPort(storedPort) };
}

/** Slack's and Google Calendar's setups from the user MCP file. An unconfigured service still gets its defaults. */
export async function clientSetups(): Promise<{ slack: SlackSetup; "google-calendar": GoogleSetup }> {
	const servers = await readMcpServers(userMcpConfigPath());
	return {
		slack: slackSetupFrom(serverOnHost(servers, MCP_SERVICES.slack.host)?.config),
		"google-calendar": googleSetupFrom(serverOnHost(servers, MCP_SERVICES["google-calendar"].host)?.config),
	};
}

type ClientService = "slack" | "google-calendar";

/**
 * The next server entry for `id` with the client `clientId` and the OAuth settings `oauth`, without writing it.
 * An omitted secret is copied from the same client ID. Changing the client ID without a new secret throws.
 */
async function planClientSave(filePath: string, id: ClientService, clientId: string, submitted: string | undefined, oauth: NonNullable<McpServerConfig["oauth"]>): Promise<ClientSave> {
	const { label, host, url, serverName } = MCP_SERVICES[id];
	const servers = await readMcpServers(filePath);
	const current = serverOnHost(servers, host);
	if (!current && servers[serverName]) {
		throw new ClientConfigError(`omp already has an MCP server named "${serverName}" for a different address. Rename that server, then save the ${label} app.`);
	}
	const existing = current?.config.oauth;
	const existingId = clientIdOf(existing);
	const existingSecret = hasSecret(existing) ? existing?.clientSecret : undefined;
	const submittedSecret = submitted?.trim() || undefined;
	if (submittedSecret === undefined && (existingId !== clientId || !existingSecret)) {
		throw new ClientConfigError(existingId && existingId !== clientId ? `Changing the ${label} client ID needs the new app's client secret.` : `${label} needs the app's client secret.`);
	}
	const clientSecret = submittedSecret ?? existingSecret;
	if (!clientSecret) throw new ClientConfigError(`${label} needs the app's client secret.`);
	const server: McpServerConfig = { ...current?.config, type: "http", url: current?.config.url ?? url, oauth: { ...existing, ...oauth, clientId, clientSecret } };
	if (server.auth) server.auth = { ...server.auth, clientId, clientSecret };
	const dropCredentials = current !== undefined && (existingId !== clientId || (submittedSecret !== undefined && submittedSecret !== existingSecret));
	return { name: current?.name ?? serverName, server, dropCredentials, credential: current ? credentialFor(current.name, current.config) : null };
}

/** The next Slack server entry for validated `input`, without writing it. */
export const planSlackSave = (filePath: string, input: SlackClientInput): Promise<ClientSave> =>
	planClientSave(filePath, "slack", input.clientId.trim(), input.clientSecret, { scope: input.scope, redirectUri: input.redirectUri, callbackPort: input.callbackPort });

/**
 * The next Google Calendar server entry for validated `input`, without writing it: the client, the scopes the dashboard
 * and the MCP server's tools need, a consent prompt so Google grants a refresh token every time, and the loopback redirect.
 */
export const planGoogleSave = (filePath: string, input: GoogleClientInput): Promise<ClientSave> =>
	planClientSave(filePath, "google-calendar", input.clientId.trim(), input.clientSecret, {
		scope: GOOGLE_CALENDAR_SCOPES.join(" "),
		prompt: "consent",
		redirectUri: googleRedirectUri(input.callbackPort),
		callbackPort: input.callbackPort,
	});
