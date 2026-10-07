/**
 * omp's MCP servers: finding one by its URL's host, signing in to one as `/mcp reauth` does, removing the sign-ins omp
 * manages for one, adding one to omp's user-level config, and listing and calling its tools with omp's OAuth sign-in.
 */
import { createCache } from "../cache";
import { isObject, str } from "../json";
import { runChecked } from "../proc";
import { MCP_SERVICES, normalizeSlackScope, type SlackClientInput, type SlackSetup, slackRedirectError, SLACK_USER_SCOPES } from "../shared/accounts";
import { ompCommand } from "./install";
import {
	auth,
	dirs,
	discoveryHelpers,
	type McpConfigFile,
	type McpServerConfig,
	mcpConfig,
	mcpConfigWriter,
	mcpCredentials,
	mcpOAuthDiscovery,
	mcpOAuthFlow,
	mcpRpc,
} from "./modules";

const TIMEOUT_MS = 20_000;
/** How long an `omp token` answer serves later calls; omp refreshes it before handing it out. */
const TOKEN_MS = 5 * 60_000;
/** How long a server's tool list serves the integrations page's reads. */
const CHECK_MS = 60_000;

export interface McpServer {
	name: string;
	url: string;
	/** What `omp token` takes: the server's `auth.credentialId`, else the id omp files a sign-in for its URL under. */
	credentialId: string;
}

/** What `omp token` takes for the server at `url`: the id its config names, else the id omp files a sign-in for `url` under. */
const credentialIdFor = (url: string, configured: string | undefined): string | undefined =>
	configured ?? mcpCredentials.mcpOAuthCredentialIdsForServerUrl(url)[0];

/** The enabled server in omp's user-level MCP config whose `url` is on `host`, or `null`. */
export async function findMcpServer(host: string): Promise<McpServer | null> {
	const { configs } = await mcpConfig.loadAllMCPConfigs(process.cwd(), { enableProjectConfig: false });
	const entry = serverOnHost(configs, host);
	return entry ? credentialFor(entry.name, entry.config) : null;
}

const tokens = createCache<string>(TOKEN_MS);

const tokenOf = (credentialId: string): Promise<string> =>
	tokens.get(credentialId, async () => {
		const token = (await runChecked([...ompCommand, "token", credentialId], { timeoutMs: TIMEOUT_MS })).trim();
		if (!token) throw new Error("omp token printed no token");
		return token;
	});

/** Whether omp holds an OAuth sign-in for `server`. The store opens on each call, so a sign-in from a terminal counts at once. */
export async function mcpSignedIn(server: McpServer): Promise<boolean> {
	const storage = await auth.discoverAuthStorage();
	try {
		return storage.credentials.hasOAuth(server.credentialId);
	} finally {
		storage.close();
	}
}

export interface McpSignIn {
	/** Gets the authorization address to open in the browser, once the flow listens for the browser's return. */
	onAuth(url: string): void;
	/** Aborting it stops waiting for the browser and frees the callback port. */
	signal: AbortSignal;
	/** Reject a grant without a refresh token before storing it. */
	requireRefresh?: boolean;
}

/**
 * Signs in to `server` as omp's `/mcp reauth` does: reads its OAuth endpoints from its metadata, registers a client
 * when the authorization server offers that and no client is configured, then waits for the browser to come back to a
 * local callback. A configured client id, secret, scope, and callback are forwarded. The sign-in is stored under
 * `server.credentialId`, else the id omp files a sign-in for its URL under, where `omp token` finds it, refresh
 * material included. The stored client secret is the one registration issued, or the configured secret when it did not.
 */
export async function signInMcp(server: Pick<McpServer, "url"> & Partial<Pick<McpServer, "credentialId">>, { onAuth, signal, requireRefresh }: McpSignIn): Promise<void> {
	const credentialId = credentialIdFor(server.url, server.credentialId);
	if (!credentialId) throw new Error(`omp names no sign-in for ${server.url}`);
	const oauth = await mcpOAuthDiscovery.discoverOAuthEndpoints(server.url);
	if (!oauth) throw new Error(`${server.url} names no OAuth endpoints to sign in with`);
	const configured = await configuredOAuth(server.url);
	const configuredClientId = configured?.clientId?.trim() || undefined;
	const flow = new mcpOAuthFlow.MCPOAuthFlow(
		{
			authorizationUrl: oauth.authorizationUrl,
			tokenUrl: oauth.tokenUrl,
			issuerUrl: oauth.issuerUrl,
			registrationUrl: oauth.registrationUrl,
			clientId: configuredClientId ?? (oauth.registrationUrl ? undefined : oauth.clientId),
			clientSecret: configured?.clientSecret,
			scopes: configured?.scope || oauth.scopes,
			prompt: configured?.prompt,
			redirectUri: configured?.redirectUri,
			callbackPort: configured?.callbackPort,
			callbackPath: configured?.callbackPath,
			resource: oauth.resource ?? server.url,
			stripSameOriginResource: !oauth.resource,
		},
		{ onAuth: ({ url }) => onAuth(url), signal },
	);
	const granted = await flow.login();
	if (signal.aborted) throw new Error("Sign-in was cancelled.");
	if (requireRefresh && (typeof granted.refresh !== "string" || !granted.refresh)) {
		throw new Error("The server granted no refresh token. Enable token rotation for this app and sign in again.");
	}
	const storage = await auth.discoverAuthStorage();
	try {
		signal.throwIfAborted();
		await storage.credentials.set(credentialId, {
			...granted,
			type: "oauth",
			tokenUrl: oauth.tokenUrl,
			clientId: flow.resolvedClientId ?? configuredClientId,
			clientSecret: flow.registeredClientSecret ?? configured?.clientSecret,
			resource: flow.resource,
			authorizationUrl: flow.authorizationUrl,
		});
	} finally {
		storage.close();
	}
	tokens.drop(credentialId);
	checks.drop(credentialId);
}

/**
 * Removes the sign-ins omp manages for `server`, as `/mcp unauth` does, under its credential id and under the ids omp
 * files a sign-in for its URL under; omp's config keeps the server and its `auth` block. Throws while omp still holds a
 * sign-in under the credential id, the one {@link mcpSignedIn} reads.
 */
export async function signOutMcp(server: McpServer): Promise<void> {
	const storage = await auth.discoverAuthStorage();
	try {
		await mcpCredentials.removeManagedMcpOAuthCredentials(storage, [server.credentialId, ...mcpCredentials.mcpOAuthCredentialIdsForServerUrl(server.url)]);
		if (storage.credentials.hasOAuth(server.credentialId)) throw new Error(`omp does not manage the sign-in under ${server.credentialId}, so it stays. Remove it from omp's credentials yourself.`);
	} finally {
		storage.close();
		tokens.drop(server.credentialId);
		checks.drop(server.credentialId);
	}
}

/** Adds an HTTP server to omp's user-level MCP config, which new omp sessions load. */
export const addMcpServer = (name: string, url: string): Promise<void> =>
	mcpConfigWriter.addMCPServer(dirs.getMCPConfigPath("user"), name, { type: "http", url });

/** omp's user-level MCP config path. Slack's app settings live in that file, not in a second store. */
export const userMcpConfigPath = (): string => dirs.getMCPConfigPath("user");

const DEFAULT_SLACK_CALLBACK_PORT = 3000;

export class SlackConfigError extends Error {}

export interface SlackSave {
	name: string;
	server: McpServerConfig;
	dropCredentials: boolean;
	credential: McpServer | null;
}

const readUserMcpFile = (): Promise<McpConfigFile> => mcpConfigWriter.readMCPConfigFile(userMcpConfigPath());

function serverHost(server: McpServerConfig | undefined): string | null {
	if (!server?.url) return null;
	const url = discoveryHelpers.expandEnvVarsDeep(server.url);
	return URL.canParse(url) ? new URL(url).host : null;
}

function validPort(port: number | undefined): port is number {
	return typeof port === "number" && Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}

/** Public Slack setup for one stored server. `undefined` is the state before a save. */
export function slackSetupFrom(server: McpServerConfig | undefined): SlackSetup {
	const oauth = server?.oauth;
	const clientId = typeof oauth?.clientId === "string" ? oauth.clientId.trim() || null : null;
	const hasClientSecret = typeof oauth?.clientSecret === "string" && oauth.clientSecret.trim().length > 0;
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

async function userServers(): Promise<Record<string, McpServerConfig>> {
	return (await readUserMcpFile()).mcpServers ?? {};
}

function serverOnHost(servers: Record<string, McpServerConfig>, host: string): { name: string; config: McpServerConfig } | undefined {
	for (const [name, config] of Object.entries(servers)) {
		if (serverHost(config) === host) return { name, config };
	}
	return undefined;
}

/** Slack's setup from the user MCP file. Unconfigured Slack still gets the default port and scopes. */
export async function slackSetup(): Promise<SlackSetup> {
	const servers = await userServers();
	return slackSetupFrom(serverOnHost(servers, MCP_SERVICES.slack.host)?.config);
}

function credentialFor(name: string, config: McpServerConfig): McpServer | null {
	if (!config.url) return null;
	const url = discoveryHelpers.expandEnvVarsDeep(config.url);
	if (!URL.canParse(url)) return null;
	const credentialId = credentialIdFor(config.url, config.auth?.credentialId);
	if (!credentialId) throw new Error(`omp has no sign-in for its "${name}" MCP server. Run /mcp reauth ${name} in omp.`);
	return { name, url, credentialId };
}

/**
 * The next Slack server entry for validated `input`, without writing it.
 * An omitted secret is copied from the same client ID. Changing the client ID without a new secret throws.
 */
export async function planSlackSave(filePath: string, input: SlackClientInput): Promise<SlackSave> {
	const clientId = input.clientId.trim();
	const file = await mcpConfigWriter.readMCPConfigFile(filePath);
	const servers = file.mcpServers ?? {};
	const current = serverOnHost(servers, MCP_SERVICES.slack.host);
	if (!current && servers.slack) {
		throw new SlackConfigError('omp already has an MCP server named "slack" for a different address. Rename that server, then save the Slack app.');
	}
	const existing = current?.config.oauth;
	const existingId = typeof existing?.clientId === "string" ? existing.clientId.trim() || null : null;
	const existingSecret = typeof existing?.clientSecret === "string" && existing.clientSecret.trim() ? existing.clientSecret : undefined;
	const submittedSecret = input.clientSecret?.trim() || undefined;
	if (submittedSecret === undefined && (existingId !== clientId || !existingSecret)) {
		throw new SlackConfigError(existingId && existingId !== clientId ? "Changing the Slack client ID needs the new app's client secret." : "Slack needs the app's client secret.");
	}
	const clientSecret = submittedSecret ?? existingSecret;
	if (!clientSecret) throw new SlackConfigError("Slack needs the app's client secret.");
	const name = current?.name ?? "slack";
	const server: McpServerConfig = {
		...current?.config,
		type: "http",
		url: current?.config.url ?? MCP_SERVICES.slack.url,
		oauth: { ...existing, clientId, clientSecret, scope: input.scope, redirectUri: input.redirectUri, callbackPort: input.callbackPort },
	};
	if (server.auth) server.auth = { ...server.auth, clientId, clientSecret };
	const dropCredentials = current !== undefined && (existingId !== clientId || (submittedSecret !== undefined && submittedSecret !== existingSecret));
	return { name, server, dropCredentials, credential: current ? credentialFor(current.name, current.config) : null };
}

/** Writes `save` with omp's locked, owner-only MCP config writer. */
export function commitSlackSave(filePath: string, save: SlackSave): Promise<void> {
	return mcpConfigWriter.updateMCPServer(filePath, save.name, save.server);
}

async function configuredOAuth(serverUrl: string): Promise<NonNullable<McpServerConfig["oauth"]> | undefined> {
	if (!URL.canParse(serverUrl)) return undefined;
	const host = new URL(serverUrl).host;
	const configured = serverOnHost(await userServers(), host)?.config.oauth;
	return configured ? discoveryHelpers.expandEnvVarsDeep(configured) : undefined;
}

/** A failed tool call's text is the server's error, sometimes as JSON with a `message`. */
function toolError(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		const message = isObject(parsed) ? str(parsed.message) : undefined;
		if (message) return message;
	} catch {}
	return text || "The MCP server reported an error";
}

/** The server refused omp's sign-in, so only a new sign-in helps. */
export class McpRefused extends Error {}

/** `method`'s result on `server`, called with omp's sign-in for it; the server's own message thrown when it answers an error. */
async function request(server: McpServer, method: string, params: Record<string, unknown>): Promise<unknown> {
	const response = await mcpRpc.callMCP(server.url, method, params, {
		headers: { Authorization: `Bearer ${await tokenOf(server.credentialId)}` },
		signal: AbortSignal.timeout(TIMEOUT_MS),
		onHttpError: ({ status }) => {
			if (status !== 401) return new Error(`The "${server.name}" MCP server answered HTTP ${status}`);
			tokens.drop(server.credentialId);
			checks.drop(server.credentialId);
			return new McpRefused(`The "${server.name}" MCP server refused omp's sign-in. Reconnect it on the Integrations page, or run /mcp reauth ${server.name} in omp.`);
		},
	});
	if (response.error) throw new Error(response.error.message || "The MCP server answered an error");
	return response.result;
}

/** The text that `tool` answers for `args` on `server`; the server's own message thrown when the call fails. */
export async function callMcpTool(server: McpServer, tool: string, args: Record<string, unknown>): Promise<string> {
	const answered = await request(server, "tools/call", { name: tool, arguments: args });
	const result = isObject(answered) ? answered : {};
	const content = Array.isArray(result.content) ? result.content : [];
	const text = content.map(part => (isObject(part) && part.type === "text" ? str(part.text) : undefined)).find(part => part !== undefined) ?? "";
	if (result.isError === true) throw new Error(toolError(text));
	return text;
}

const checks = createCache<string[]>(CHECK_MS);

/**
 * Every tool `server` offers, following its cursor. Throws {@link McpRefused} when the server refuses omp's sign-in, and
 * the server's error on any other failure, which the cache does not keep.
 */
export const checkMcpServer = (server: McpServer, fresh: boolean): Promise<string[]> =>
	checks.get(
		server.credentialId,
		async () => {
			const tools: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await request(server, "tools/list", cursor ? { cursor } : {});
				if (!isObject(page)) break;
				for (const tool of Array.isArray(page.tools) ? page.tools : []) {
					const name = isObject(tool) ? str(tool.name) : undefined;
					if (name) tools.push(name);
				}
				cursor = str(page.nextCursor);
			} while (cursor);
			return tools;
		},
		fresh,
	);

/** `text`, what `service`'s `tool` answered, as JSON; the start of the text thrown when it is not JSON. */
export function toolJson(service: string, tool: string, text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${service}'s ${tool} answered something other than JSON: ${text.slice(0, 200)}`);
	}
}
