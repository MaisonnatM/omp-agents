/**
 * omp's MCP servers: finding those on a URL's host, signing in to one as `/mcp reauth` does, removing the sign-ins omp
 * manages for one, reading and writing omp's user-level config, listing and calling a server's tools with omp's OAuth
 * sign-in, and handing that sign-in to `signedFetch` for the APIs of the service behind a server.
 */
import { createCache } from "../cache";
import { isObject, str } from "../json";
import { runChecked } from "../proc";
import { ApiError, type Bearer } from "../signed-fetch";
import { ompCommand } from "./install";
import {
	auth,
	dirs,
	discoveryHelpers,
	mcpClient,
	type McpConnection,
	type McpServerConfig,
	type McpSourceMeta,
	type McpToolDefinition,
	mcpConfig,
	mcpConfigWriter,
	mcpCredentials,
	mcpOAuthDiscovery,
	mcpOAuthFlow,
	mcpRpc,
} from "./modules";

export type { McpServerConfig, McpSourceMeta, McpToolDefinition };

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
	/** The configured transport and headers used for MCP discovery, not service HTTP API calls. */
	config: McpServerConfig;
}

/** What `omp token` takes for the server at `url`: the id its config names, else the id omp files a sign-in for `url` under. */
const credentialIdFor = (url: string, configured: string | undefined): string | undefined =>
	configured ?? mcpCredentials.mcpOAuthCredentialIdsForServerUrl(url)[0];

/** The enabled servers in omp's user-level MCP config whose `url` is on `host`, in the config's order. */
export async function findMcpServers(host: string): Promise<McpServer[]> {
	const { configs } = await mcpConfig.loadAllMCPConfigs(process.cwd(), { enableProjectConfig: false });
	return serversOnHost(configs, host).flatMap(({ name, config }) => credentialFor(name, config) ?? []);
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
	return (await mcpSignedInIds([server.credentialId])).has(server.credentialId);
}

/** Which of `credentialIds` omp holds an OAuth sign-in under, read from one opening of the store. */
export async function mcpSignedInIds(credentialIds: readonly string[]): Promise<Set<string>> {
	const storage = await auth.discoverAuthStorage();
	try {
		return new Set(credentialIds.filter(id => storage.credentials.hasOAuth(id)));
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
	/** The authorization prompt instead of the configured one: `select_account consent` lets you pick another account. */
	prompt?: string;
}

/** What {@link signInMcp} signs in to: the server's address, the credential id it stores the sign-in under, and its configured OAuth client. */
export interface McpSignInTarget {
	url: string;
	/** Left out for the id omp files a sign-in for `url` under. */
	credentialId?: string;
	oauth?: McpServerConfig["oauth"];
}

/**
 * Signs in to `server` as omp's `/mcp reauth` does: reads its OAuth endpoints from its metadata, registers a client
 * when the authorization server offers that and no client is configured, then waits for the browser to come back to a
 * local callback. A configured client id, secret, scope, and callback are forwarded. The sign-in is stored under
 * `server.credentialId`, else the id omp files a sign-in for its URL under, where `omp token` finds it, refresh
 * material included. The stored client secret is the one registration issued, or the configured secret when it did not.
 */
export async function signInMcp(server: McpSignInTarget, { onAuth, signal, requireRefresh, prompt }: McpSignIn): Promise<void> {
	const credentialId = credentialIdFor(server.url, server.credentialId);
	if (!credentialId) throw new Error(`omp names no sign-in for ${server.url}`);
	const oauth = await mcpOAuthDiscovery.discoverOAuthEndpoints(server.url);
	if (!oauth) throw new Error(`${server.url} names no OAuth endpoints to sign in with`);
	const configured = server.oauth && discoveryHelpers.expandEnvVarsDeep(server.oauth);
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
			prompt: prompt ?? configured?.prompt,
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
	invalidateMcpSignIn(credentialId);
}

/**
 * Removes the sign-in omp manages for `server`, as `/mcp unauth` does, under its own credential id, and under every id
 * omp files a sign-in for its URL under only when its own id is one of them: a server with an id of its own shares the
 * URL with others whose sign-ins stay. omp's config keeps the server and its `auth` block. Throws while omp still holds a
 * sign-in under the credential id, the one {@link mcpSignedIn} reads.
 */
export async function signOutMcp(server: McpServer): Promise<void> {
	const urlIds = mcpCredentials.mcpOAuthCredentialIdsForServerUrl(server.url);
	const storage = await auth.discoverAuthStorage();
	try {
		await mcpCredentials.removeManagedMcpOAuthCredentials(storage, urlIds.includes(server.credentialId) ? urlIds : [server.credentialId]);
		if (storage.credentials.hasOAuth(server.credentialId)) throw new Error(`omp does not manage the sign-in under ${server.credentialId}, so it stays. Remove it from omp's credentials yourself.`);
	} finally {
		storage.close();
		invalidateMcpSignIn(server.credentialId);
	}
}

/** Adds `config` as `name` to omp's user-level MCP config, which new omp sessions load. */
export async function addMcpServer(name: string, config: McpServerConfig): Promise<void> {
	await mcpConfigWriter.addMCPServer(dirs.getMCPConfigPath("user"), name, config);
	forgetMcpTools(name);
}

/** Removes `name` from omp's user-level MCP config. */
export async function removeMcpServer(name: string): Promise<void> {
	await mcpConfigWriter.removeMCPServer(dirs.getMCPConfigPath("user"), name);
	forgetMcpTools(name);
}

/** Enables or disables `name` in omp's user-level MCP config. */
export async function setMcpServerEnabled(name: string, enabled: boolean): Promise<void> {
	await mcpConfigWriter.setMcpServerEnabled({ userPath: dirs.getMCPConfigPath("user"), name, enabled });
	forgetMcpTools(name);
}

/** Why omp refuses `name` as a server name, or `undefined`. */
export const mcpServerNameError = (name: string): string | undefined => mcpConfigWriter.validateServerName(name);

/** A server omp loads for you, and the file that names it; `enabled: false` for one your user config turns off. */
export interface ConfiguredMcpServer {
	name: string;
	config: McpServerConfig;
	source: McpSourceMeta;
	enabled: boolean;
}

/**
 * Every user-level server omp loads, from its own `mcp.json` and the other tools' configs it reads, then the servers
 * omp's `mcp.json` defines but turns off. Project configs are left out: they differ by workspace.
 */
export async function listMcpServers(): Promise<ConfiguredMcpServer[]> {
	const userPath = userMcpConfigPath();
	const [{ configs, sources }, file] = await Promise.all([
		mcpConfig.loadAllMCPConfigs(process.cwd(), { enableProjectConfig: false }),
		mcpConfigWriter.readMCPConfigFile(userPath),
	]);
	const native: McpSourceMeta = { provider: "native", providerName: "OMP", path: userPath, level: "user" };
	const loaded = Object.entries(configs).map(([name, config]) => ({ name, config, source: sources[name] ?? native, enabled: true }));
	const off = Object.entries(file.mcpServers ?? {})
		.filter(([name]) => !(name in configs))
		.map(([name, config]) => ({ name, config, source: native, enabled: false }));
	return [...loaded, ...off];
}

/** A server answered 401 to the request omp sent: it wants a sign-in omp lacks, or refused the one omp sent. */
export class McpUnauthorized extends Error {}

const toolLists = createCache<McpToolDefinition[]>(CHECK_MS);

function forgetMcpTools(name: string): void {
	toolLists.dropWhere(key => JSON.parse(key)[0] === name);
}

/** All discovery entries using this sign-in, including aliases and unsigned probes of the same server. */
function invalidateMcpSignIn(credentialId: string): void {
	tokens.drop(credentialId);
	toolLists.dropWhere(key => JSON.parse(key)[1] === credentialId);
}

/**
 * Every tool `server` offers through omp's client, with its configured transport and headers.
 * `signedIn` adds omp's token; unsigned discovery still works for public or header-authenticated servers.
 * Equivalent probes share a minute-old list; `fresh` bypasses it and failures are not kept.
 * Throws {@link McpUnauthorized} on discovery 401, not the service API's {@link McpRefused}.
 */
export const listMcpTools = (server: McpServer, signedIn: boolean, fresh: boolean): Promise<McpToolDefinition[]> => {
	const { name, config, credentialId } = server;
	const expanded = discoveryHelpers.expandEnvVarsDeep(config);
	const key = JSON.stringify([name, credentialId, signedIn, expanded]);
	return toolLists.get(
		key,
		async () => {
			const headers = { ...expanded.headers, ...(signedIn ? { Authorization: `Bearer ${await tokenOf(credentialId)}` } : {}) };
			const signal = AbortSignal.timeout(TIMEOUT_MS);
			let connection: McpConnection | undefined;
			try {
				connection = await mcpClient.connectToServer(name, { ...expanded, headers }, { signal });
				return await mcpClient.listTools(connection, { signal });
			} catch (err) {
				// omp's HTTP transport throws `MCPTransportError`, `failure: "http_status"` with the status as `code`, on a refused
				// request; its legacy SSE transport throws a plain `HTTP 401: <body>` error.
				const status = isObject(err) && err.failure === "http_status" ? err.code : err instanceof Error && err.message.startsWith("HTTP 401:") ? 401 : null;
				if (status === 401) {
					invalidateMcpSignIn(credentialId);
					throw new McpUnauthorized(`${name} answered 401 Unauthorized`);
				}
				if (typeof status === "number") throw new ApiError(`The "${name}" MCP server answered HTTP ${status}`, status);
				throw err;
			} finally {
				if (connection) await mcpClient.disconnectServer(connection).catch(() => {});
			}
		},
		fresh,
	);
};

/** omp's user-level MCP config path. Slack's and Google Calendar's app settings live in that file, not in a second store. */
export const userMcpConfigPath = (): string => dirs.getMCPConfigPath("user");

/** The servers in the MCP config file at `filePath`. */
export async function readMcpServers(filePath: string): Promise<Record<string, McpServerConfig>> {
	return (await mcpConfigWriter.readMCPConfigFile(filePath)).mcpServers ?? {};
}

/** Writes `server` as `name` in the config file at `filePath`, with omp's locked, owner-only MCP config writer. */
export async function writeMcpServer(filePath: string, name: string, server: McpServerConfig): Promise<void> {
	await mcpConfigWriter.updateMCPServer(filePath, name, server);
	forgetMcpTools(name);
}

function serverHost(server: McpServerConfig | undefined): string | null {
	if (!server?.url) return null;
	const url = discoveryHelpers.expandEnvVarsDeep(server.url);
	return URL.canParse(url) ? new URL(url).host : null;
}

/** The servers of `servers` whose `url` is on `host`, with their names, in order. */
export function serversOnHost(servers: Record<string, McpServerConfig>, host: string): { name: string; config: McpServerConfig }[] {
	return Object.entries(servers).flatMap(([name, config]) => (serverHost(config) === host ? [{ name, config }] : []));
}

/** The server `config` names as `name`, with the credential id omp holds its sign-in under; `null` without a usable URL. */
export function credentialFor(name: string, config: McpServerConfig): McpServer | null {
	if (!config.url) return null;
	const url = discoveryHelpers.expandEnvVarsDeep(config.url);
	if (!URL.canParse(url)) return null;
	const credentialId = credentialIdFor(config.url, config.auth?.credentialId);
	if (!credentialId) throw new Error(`omp has no sign-in for its "${name}" MCP server. Run /mcp reauth ${name} in omp.`);
	return { name, url, credentialId, config };
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

/** Forgets `server`'s token and tool list once a service refused the token, and the error that says so. */
function refused(server: McpServer): McpRefused {
	invalidateMcpSignIn(server.credentialId);
	return new McpRefused(`The "${server.name}" MCP server refused omp's sign-in. Reconnect it in Settings › Integrations, or run /mcp reauth ${server.name} in omp.`);
}

/** omp's sign-in to `server`, for a `signedFetch` to the APIs of the service behind it: a 401 forgets it and throws {@link McpRefused}. */
export const mcpBearer = async (server: McpServer): Promise<Bearer> => ({ token: await tokenOf(server.credentialId), refused: () => refused(server) });

/** `method`'s result on `server`, called with omp's sign-in for it; the server's own message thrown when it answers an error. */
async function request(server: McpServer, method: string, params: Record<string, unknown>): Promise<unknown> {
	const response = await mcpRpc.callMCP(server.url, method, params, {
		headers: { Authorization: `Bearer ${await tokenOf(server.credentialId)}` },
		signal: AbortSignal.timeout(TIMEOUT_MS),
		onHttpError: ({ status }) => (status === 401 ? refused(server) : new ApiError(`The "${server.name}" MCP server answered HTTP ${status}`, status)),
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

/** `text`, what `service`'s `tool` answered, as JSON; the start of the text thrown when it is not JSON. */
export function toolJson(service: string, tool: string, text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${service}'s ${tool} answered something other than JSON: ${text.slice(0, 200)}`);
	}
}
