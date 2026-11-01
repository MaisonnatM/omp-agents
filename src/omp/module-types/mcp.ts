/** omp's MCP client, config, and sign-ins (pi-coding-agent src/mcp). */
import type { AuthStorage } from "./models";

/** Subset of omp's `JsonRpcResponse` (src/mcp/types.ts). */
export interface McpResponse {
	result?: unknown;
	error?: { code: number; message: string };
}
export interface McpRpcModule {
	/** JSON-RPC 2.0 over HTTP, reading a JSON or `text/event-stream` answer; `onHttpError` maps a non-2xx response to the error thrown. */
	callMCP(
		url: string,
		method: string,
		params: Record<string, unknown>,
		options: { headers?: Record<string, string>; signal?: AbortSignal; onHttpError?: (response: Response, body: string) => Error },
	): Promise<McpResponse>;
}
/** Subset of omp's `MCPServerConfig` (src/mcp/types.ts) this app reads and writes back. Extra fields on a parsed server are kept by spreading it. */
export interface McpServerConfig {
	type?: string;
	url?: string;
	command?: string;
	enabled?: boolean;
	timeout?: number;
	headers?: Record<string, string>;
	auth?: { type: string; credentialId?: string; tokenUrl?: string; clientId?: string; clientSecret?: string; resource?: string };
	oauth?: {
		clientId?: string;
		clientSecret?: string;
		scope?: string;
		redirectUri?: string;
		callbackPort?: number;
		callbackPath?: string;
		prompt?: string;
	};
}
/** Subset of omp's `SourceMeta` (src/capability/types.ts): where omp found a server's config. */
export interface McpSourceMeta {
	/** `native` for omp's own `mcp.json`, else the tool whose config named it, such as `claude`. */
	provider: string;
	providerName: string;
	path: string;
	level: "user" | "project" | "native";
}
export interface McpConfigModule {
	/** The MCP servers omp would start in `cwd`, with where each was found: disabled ones (`disabledServers`, `enabled: false`) left out, `url` env vars not yet expanded. */
	loadAllMCPConfigs(cwd: string, options?: { enableProjectConfig?: boolean }): Promise<{ configs: Record<string, McpServerConfig>; sources: Record<string, McpSourceMeta> }>;
}
/** Subset of omp's `MCPToolDefinition` (src/mcp/types.ts). */
export interface McpToolDefinition {
	name: string;
	description?: string;
}
/** omp's `MCPServerConnection` (src/mcp/types.ts), opaque here: a connected server's transport. */
export interface McpConnection {
	name: string;
}
export interface McpClientModule {
	/** Connects and initializes `config` as omp's sessions do, over its HTTP, SSE, or stdio transport. */
	connectToServer(name: string, config: McpServerConfig, options?: { signal?: AbortSignal }): Promise<McpConnection>;
	/** Every tool the connected server offers, following its cursor. */
	listTools(connection: McpConnection, options?: { signal?: AbortSignal }): Promise<McpToolDefinition[]>;
	disconnectServer(connection: McpConnection): Promise<void>;
}
export interface McpCredentialsModule {
	/** The credential ids omp looks a server's OAuth sign-in up under when its config names none. */
	mcpOAuthCredentialIdsForServerUrl(serverUrl: string | undefined): string[];
	/** Removes the OAuth sign-ins omp manages under `credentialIds`, as `/mcp unauth` does; whether it removed any. */
	removeManagedMcpOAuthCredentials(storage: AuthStorage, credentialIds: readonly (string | undefined)[]): Promise<boolean>;
}
/** Subset of omp's `OAuthEndpoints` (src/mcp/oauth-discovery.ts). */
export interface McpOAuthEndpoints {
	authorizationUrl: string;
	tokenUrl: string;
	issuerUrl?: string;
	clientId?: string;
	/** Dynamic client registration endpoint, when the authorization server offers one. */
	registrationUrl?: string;
	scopes?: string;
	resource?: string;
}
export interface McpOAuthDiscoveryModule {
	/** The OAuth endpoints a server's well-known metadata names, or `null` when it names none. */
	discoverOAuthEndpoints(serverUrl: string): Promise<McpOAuthEndpoints | null>;
}
/** Subset of omp's `MCPOAuthConfig` (src/mcp/oauth-flow.ts). */
export interface McpOAuthConfig {
	authorizationUrl: string;
	tokenUrl: string;
	issuerUrl?: string;
	registrationUrl?: string;
	clientId?: string;
	clientSecret?: string;
	scopes?: string;
	prompt?: string;
	redirectUri?: string;
	callbackPort?: number;
	callbackPath?: string;
	resource?: string;
	/** The `resource` is the server URL, not one the metadata advertised. */
	stripSameOriginResource?: boolean;
}
/** omp's `MCPOAuthFlow` (src/mcp/oauth-flow.ts): an authorization-code flow with PKCE and a local callback server. */
export interface McpOAuthFlow {
	/** Waits for the browser to come back to the callback; resolves with pi-ai's `OAuthCredentials`. */
	login(): Promise<Record<string, unknown>>;
	readonly resolvedClientId: string | undefined;
	readonly registeredClientSecret: string | undefined;
	readonly resource: string | undefined;
	readonly authorizationUrl: string;
}
export interface McpOAuthFlowModule {
	MCPOAuthFlow: new (config: McpOAuthConfig, ctrl: { onAuth(info: { url: string }): void; signal: AbortSignal }) => McpOAuthFlow;
}
export interface McpConfigFile {
	mcpServers?: Record<string, McpServerConfig>;
	disabledServers?: string[];
}
export interface McpConfigWriterModule {
	/** Adds a server to an MCP config file; throws when the file already has one by that name or omp rejects the name or config. */
	addMCPServer(filePath: string, name: string, config: McpServerConfig): Promise<void>;
	/** Replaces one server, or adds it, under the config file lock. The file mode stays owner-only. */
	updateMCPServer(filePath: string, name: string, config: McpServerConfig): Promise<void>;
	/** Removes a server from an MCP config file; throws when the file has none by that name. */
	removeMCPServer(filePath: string, name: string): Promise<void>;
	/**
	 * Enables or disables `name` as omp's `/mcp enable` and `/mcp disable` do: writes `enabled` on the first of the paths that
	 * defines it, else adds it to the user file's `disabledServers` or `enabledServers` list.
	 */
	setMcpServerEnabled(options: { userPath: string; projectPath?: string; sourcePath?: string; name: string; enabled: boolean }): Promise<void>;
	/** The parsed MCP file, or `{ mcpServers: {} }` when it is not there yet. */
	readMCPConfigFile(filePath: string): Promise<McpConfigFile>;
	/** Why omp refuses `name` as a server name, or `undefined` when it accepts it. */
	validateServerName(name: string): string | undefined;
}
export interface DiscoveryHelpersModule {
	/** Expands `${VAR}` references in a string the way omp does for an MCP server's `url`. */
	expandEnvVarsDeep<T>(value: T): T;
}
