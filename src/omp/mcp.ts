/** omp's MCP servers: finding one by its URL's host, and calling its tools with the OAuth sign-in omp keeps for it. */
import { createCache } from "../cache";
import { isObject, str } from "../json";
import { runChecked } from "../proc";
import { ompCommand } from "./install";
import { discoveryHelpers, mcpConfig, mcpCredentials, mcpRpc } from "./modules";

const TIMEOUT_MS = 20_000;
/** How long an `omp token` answer serves later calls; omp refreshes it before handing it out. */
const TOKEN_MS = 5 * 60_000;

export interface McpServer {
	name: string;
	url: string;
	/** What `omp token` takes: the server's `auth.credentialId`, else the id omp files a sign-in for its URL under. */
	credentialId: string;
}

/** The enabled server in omp's user-level MCP config whose `url` is on `host`, or `null`. */
export async function findMcpServer(host: string): Promise<McpServer | null> {
	const { configs } = await mcpConfig.loadAllMCPConfigs(process.cwd(), { enableProjectConfig: false });
	for (const [name, server] of Object.entries(configs)) {
		if (!server.url) continue;
		const url = discoveryHelpers.expandEnvVarsDeep(server.url);
		if (!URL.canParse(url) || new URL(url).host !== host) continue;
		const credentialId = server.auth?.credentialId ?? mcpCredentials.mcpOAuthCredentialIdsForServerUrl(server.url)[0];
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
