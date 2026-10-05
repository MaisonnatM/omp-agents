/**
 * omp's MCP servers: finding one by its URL's host, signing in to one as `/mcp reauth` does, adding one to omp's
 * user-level config, and calling its tools with the OAuth sign-in omp keeps for it.
 */
import { createCache } from "../cache";
import { isObject, str } from "../json";
import { runChecked } from "../proc";
import { ompCommand } from "./install";
import {
	auth,
	dirs,
	discoveryHelpers,
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
	for (const [name, server] of Object.entries(configs)) {
		if (!server.url) continue;
		const url = discoveryHelpers.expandEnvVarsDeep(server.url);
		if (!URL.canParse(url) || new URL(url).host !== host) continue;
		const credentialId = credentialIdFor(server.url, server.auth?.credentialId);
		if (!credentialId) throw new Error(`omp has no sign-in for its "${name}" MCP server. Run /mcp reauth ${name} in omp.`);
		return { name, url, credentialId };
	}
	return null;
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
}

/**
 * Signs in to `server` as omp's `/mcp reauth` does: reads its OAuth endpoints from its metadata, registers a client
 * when the authorization server offers that, then waits for the browser to come back to a local callback. The sign-in
 * is stored under `server.credentialId`, else the id omp files a sign-in for its URL under, where `omp token` finds it,
 * refresh material included.
 */
export async function signInMcp(server: Pick<McpServer, "url"> & Partial<Pick<McpServer, "credentialId">>, { onAuth, signal }: McpSignIn): Promise<void> {
	const credentialId = credentialIdFor(server.url, server.credentialId);
	if (!credentialId) throw new Error(`omp names no sign-in for ${server.url}`);
	const oauth = await mcpOAuthDiscovery.discoverOAuthEndpoints(server.url);
	if (!oauth) throw new Error(`${server.url} names no OAuth endpoints to sign in with`);
	const flow = new mcpOAuthFlow.MCPOAuthFlow(
		{
			authorizationUrl: oauth.authorizationUrl,
			tokenUrl: oauth.tokenUrl,
			issuerUrl: oauth.issuerUrl,
			registrationUrl: oauth.registrationUrl,
			// A client the metadata advertises is only a fallback for servers without registration, as in omp.
			clientId: oauth.registrationUrl ? undefined : oauth.clientId,
			scopes: oauth.scopes,
			resource: oauth.resource ?? server.url,
			stripSameOriginResource: !oauth.resource,
		},
		{ onAuth: ({ url }) => onAuth(url), signal },
	);
	const granted = await flow.login();
	const storage = await auth.discoverAuthStorage();
	try {
		await storage.credentials.set(credentialId, {
			...granted,
			type: "oauth",
			tokenUrl: oauth.tokenUrl,
			clientId: flow.resolvedClientId,
			clientSecret: flow.registeredClientSecret,
			resource: flow.resource,
			authorizationUrl: flow.authorizationUrl,
		});
	} finally {
		storage.close();
	}
	tokens.drop(credentialId);
}

/** Adds an HTTP server to omp's user-level MCP config, which new omp sessions load. */
export const addMcpServer = (name: string, url: string): Promise<void> =>
	mcpConfigWriter.addMCPServer(dirs.getMCPConfigPath("user"), name, { type: "http", url });

/** A failed tool call's text is the server's error, sometimes as JSON with a `message`. */
function toolError(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		const message = isObject(parsed) ? str(parsed.message) : undefined;
		if (message) return message;
	} catch {}
	return text || "The MCP server reported an error";
}

/** The text that `tool` answers for `args` on `server`; the server's own message thrown when the call fails. */
export async function callMcpTool(server: McpServer, tool: string, args: Record<string, unknown>): Promise<string> {
	const response = await mcpRpc.callMCP(
		server.url,
		"tools/call",
		{ name: tool, arguments: args },
		{
			headers: { Authorization: `Bearer ${await tokenOf(server.credentialId)}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			onHttpError: ({ status }) => {
				if (status !== 401) return new Error(`The "${server.name}" MCP server answered HTTP ${status}`);
				tokens.drop(server.credentialId);
				return new Error(`The "${server.name}" MCP server refused omp's sign-in. Run /mcp reauth ${server.name} in omp.`);
			},
		},
	);
	if (response.error) throw new Error(response.error.message || "The MCP server answered an error");
	const result = isObject(response.result) ? response.result : {};
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
