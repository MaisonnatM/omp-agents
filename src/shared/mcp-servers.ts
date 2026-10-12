/** The MCP servers Settings › MCP servers lists: every server omp loads for you, and the servers you add there. */
import type { McpIntegrationId, SignInState } from "./accounts";

/** How omp reaches a server: over streamable HTTP, over the older SSE transport, or by running a local command. */
export type McpTransport = "http" | "sse" | "stdio";

/** The transports a server added from the page may use; local commands are added in omp's config. */
export const REMOTE_TRANSPORTS = ["http", "sse"] as const;
export type RemoteTransport = (typeof REMOTE_TRANSPORTS)[number];

export interface McpTool {
	name: string;
	description: string | null;
}

/**
 * Where omp stands with a server.
 * `integration` is one of Settings › Integrations' services, which that section checks and signs in to.
 * `local` runs a command, which the page does not start.
 * `signed-out` answered 401 while omp holds no sign-in for it; `refused` answered 401 to the sign-in omp holds.
 */
export type McpServerStatus =
	| { kind: "disabled" }
	| { kind: "local" }
	| { kind: "integration"; id: McpIntegrationId }
	| { kind: "signed-out" }
	| { kind: "ready"; tools: McpTool[] }
	| { kind: "refused"; error: string }
	| { kind: "failing"; error: string };

/** The config file that names a server, and whether the page may change it there: only omp's own user `mcp.json`. */
export interface McpServerSource {
	/** `OMP` for omp's own file, else the tool whose config omp read it from, such as `Claude Code`. */
	label: string;
	path: string;
	editable: boolean;
}

export interface McpServerRow {
	/** The server's name in its config, which its tools are prefixed with in a session. */
	name: string;
	transport: McpTransport;
	/** The address of a remote server, as configured, `${VAR}` references expanded. */
	url: string | null;
	host: string | null;
	/** The command a local server runs. */
	command: string | null;
	source: McpServerSource;
	/** Whether omp holds an OAuth sign-in for the server's URL. */
	signedIn: boolean;
	status: McpServerStatus;
	signIn: SignInState;
	/** The catalog entry on the server's host, for its mark and description. */
	catalogId: string | null;
}

export interface McpServersAnswer {
	servers: McpServerRow[];
	/** omp's user `mcp.json`, where the page adds servers. */
	configPath: string;
}

/** A server you add by its address, with a header such as an API key when it takes one. */
export interface McpServerInput {
	name: string;
	url: string;
	transport: RemoteTransport;
	header: { name: string; value: string } | null;
}

/** The body of `PUT /api/mcp-servers/add`: a catalog entry by id, or a server by its address. */
export type McpServerAdd = { kind: "catalog"; id: string } | ({ kind: "custom" } & McpServerInput);
