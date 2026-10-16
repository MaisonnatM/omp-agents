/**
 * The OAuth client of the Slack, Google Calendar, and Gmail apps that Settings › Integrations saves: the setup the page
 * shows, read from the user MCP config, and the server entries a save would write, planned from it without writing.
 */
import { type McpServerConfig, readMcpServers, serversOnHost, userMcpConfigPath } from "./omp/mcp";
import {
	type ClientService,
	type ClientSetups,
	DEFAULT_GOOGLE_CALLBACK_PORT,
	GOOGLE_SCOPES,
	type GoogleClientInput,
	type GoogleService,
	type GoogleSetup,
	googleRedirectUri,
	MCP_SERVICES,
	type McpClient,
	type McpIntegrationId,
	type McpSetup,
	normalizeSlackScope,
	type SlackClientInput,
	type SlackSetup,
	slackRedirectError,
	SLACK_USER_SCOPES,
} from "./shared/accounts";

const DEFAULT_SLACK_CALLBACK_PORT = 3000;

/** A service's OAuth client settings that cannot be saved as given. */
export class ClientConfigError extends Error {}

/** A server entry a save writes, under its name in omp's MCP config. */
export interface ServerWrite {
	name: string;
	server: McpServerConfig;
}

export interface ClientSave {
	/** The service's servers with the new client: the first on its host, or each account's; the one a first save adds. */
	writes: ServerWrite[];
	/** The client ID or secret changed, so the sign-ins made with the old client no longer refresh. */
	dropCredentials: boolean;
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

/** Public setup of a Google service for one stored server. A callback port must be saved, since omp's own default differs. */
export function googleSetupFrom(server: McpServerConfig | undefined): GoogleSetup {
	const oauth = server?.oauth;
	const clientId = clientIdOf(oauth);
	const hasClientSecret = hasSecret(oauth);
	const storedPort = oauth?.callbackPort;
	const callbackPort = validPort(storedPort) ? storedPort : DEFAULT_GOOGLE_CALLBACK_PORT;
	return { clientId, hasClientSecret, callbackPort, configured: clientId !== null && hasClientSecret && validPort(storedPort) };
}

const savedServer = async (host: string): Promise<McpServerConfig | undefined> => serversOnHost(await readMcpServers(userMcpConfigPath()), host)[0]?.config;

const SETUP_OF: { [C in McpClient]: (host: string) => Promise<ClientSetups[C]> } = {
	none: async () => null,
	"slack-app": async host => slackSetupFrom(await savedServer(host)),
	"google-oauth": async host => googleSetupFrom(await savedServer(host)),
};

/**
 * Service `id`'s setup from the user MCP file, as its `client` decides: an unconfigured app or client still gets its
 * defaults, and a service that registers its own client, Linear, has `null` without reading the file.
 */
export function clientSetup<Id extends McpIntegrationId>(id: Id): Promise<McpSetup<Id>> {
	const client: (typeof MCP_SERVICES)[Id]["client"] = MCP_SERVICES[id].client;
	return SETUP_OF[client](MCP_SERVICES[id].host);
}

/**
 * The next server entries for `id` with the client `clientId` and the OAuth settings `oauth`, without writing them: every
 * server on its host for a service of many accounts, since each account signs in with the same client.
 * An omitted secret is copied from the same client ID. Changing the client ID without a new secret throws.
 */
async function planClientSave(filePath: string, id: ClientService, clientId: string, submitted: string | undefined, oauth: NonNullable<McpServerConfig["oauth"]>): Promise<ClientSave> {
	const { label, host, url, serverName, accounts } = MCP_SERVICES[id];
	const servers = await readMcpServers(filePath);
	const onHost = serversOnHost(servers, host);
	const current = onHost[0];
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
	const targets = current === undefined ? [{ name: serverName, config: undefined }] : accounts === "many" ? onHost : [current];
	const writes = targets.map(({ name, config }): ServerWrite => {
		const server: McpServerConfig = { ...config, type: "http", url: config?.url ?? url, oauth: { ...existing, ...config?.oauth, ...oauth, clientId, clientSecret } };
		if (server.auth) server.auth = { ...server.auth, clientId, clientSecret };
		return { name, server };
	});
	const dropCredentials = current !== undefined && (existingId !== clientId || (submittedSecret !== undefined && submittedSecret !== existingSecret));
	return { writes, dropCredentials };
}

/** The next Slack server entry for validated `input`, without writing it. */
export const planSlackSave = (filePath: string, input: SlackClientInput): Promise<ClientSave> =>
	planClientSave(filePath, "slack", input.clientId.trim(), input.clientSecret, { scope: input.scope, redirectUri: input.redirectUri, callbackPort: input.callbackPort });

/**
 * The next server entry of Google service `id` for validated `input`, without writing it: the client, the scopes the
 * dashboard and the MCP server's tools need, a consent prompt so Google grants a refresh token every time, and the
 * loopback redirect.
 */
export const planGoogleSave = (filePath: string, id: GoogleService, input: GoogleClientInput): Promise<ClientSave> =>
	planClientSave(filePath, id, input.clientId.trim(), input.clientSecret, {
		scope: GOOGLE_SCOPES[id].join(" "),
		prompt: "consent",
		redirectUri: googleRedirectUri(input.callbackPort),
		callbackPort: input.callbackPort,
	});

/**
 * Each server entry of Google service `id` with its scope set to the one the dashboard now needs, leaving out those that
 * already ask for it. A sign-in writes them first, so a client saved before the dashboard needed more of Google, such as
 * Gmail before it sent replies, asks for the wider grant once you sign in again.
 */
export async function planGoogleScope(filePath: string, id: GoogleService): Promise<ServerWrite[]> {
	const scope = GOOGLE_SCOPES[id].join(" ");
	return serversOnHost(await readMcpServers(filePath), MCP_SERVICES[id].host).flatMap(({ name, config }) =>
		!config.oauth || config.oauth.scope === scope ? [] : [{ name, server: { ...config, oauth: { ...config.oauth, scope } } }],
	);
}
