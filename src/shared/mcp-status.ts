/** Where omp stands with a remote MCP server, which Settings › Integrations and Settings › MCP servers both show. */

export interface McpTool {
	name: string;
	description: string | null;
}

/**
 * What listing a remote server's tools found: `signed-out` while it wants a sign-in omp does not hold, `ready` with its
 * tools, `refused` when it answered 401 to the sign-in omp holds, or `failing` on any other error, with the HTTP status
 * the server answered, or `null` when it answered none, such as a timeout.
 */
export type McpRemoteStatus =
	| { kind: "signed-out" }
	| { kind: "ready"; tools: McpTool[] }
	| { kind: "refused"; error: string }
	| { kind: "failing"; error: string; status: number | null };
