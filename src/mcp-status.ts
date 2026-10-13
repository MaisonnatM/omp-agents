/** Reads where omp stands with a remote MCP server by listing its tools, for Settings › Integrations and Settings › MCP servers. */
import { errorText } from "./json";
import { listMcpTools, type McpServer, McpUnauthorized } from "./omp/mcp";
import { ApiError } from "./signed-fetch";
import type { McpRemoteStatus } from "./shared/mcp-status";

/** What omp holds for a server: `signedIn`, a sign-in, and `signInRequired`, whether the server answers nothing without one. */
export interface McpAccess {
	signedIn: boolean;
	signInRequired: boolean;
}

/**
 * Where omp stands with `server`, from its tool list read with omp's sign-in when `signedIn`, and without one otherwise,
 * unless the server requires one: it is then signed out without a read. Discovery's 401 is a sign-in to start when omp
 * holds none, and a refused one when it does. `fresh` lists the tools again rather than the minute-old list.
 */
export async function remoteStatusOf(server: McpServer, { signedIn, signInRequired }: McpAccess, fresh: boolean, list = listMcpTools): Promise<McpRemoteStatus> {
	if (signInRequired && !signedIn) return { kind: "signed-out" };
	try {
		const tools = await list(server, signedIn, fresh);
		return { kind: "ready", tools: tools.map(tool => ({ name: tool.name, description: tool.description?.trim() || null })) };
	} catch (err) {
		if (!(err instanceof McpUnauthorized)) return { kind: "failing", error: errorText(err), status: err instanceof ApiError ? err.status : null };
		return signedIn ? { kind: "refused", error: "The server refused omp's sign-in. Reconnect to sign in again." } : { kind: "signed-out" };
	}
}
