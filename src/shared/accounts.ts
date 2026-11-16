/** The integrations: omp's MCP sign-ins and the OAuth clients they use. */
import { arrayOf, decoder, fields, type Guard, isBoolean, isNumber, isString, nullable, oneOf, tagged } from "../json";
import type { McpRemoteStatus, McpTool } from "./mcp-status";

/** A sign-in that the integrations page started: waiting for the browser at the provider's authorization `url`, or why it failed. */
export type SignInState = { phase: "waiting"; url: string } | { phase: "failed"; error: string } | null;

/** The services whose MCP server the integrations page signs omp in to. */
export const MCP_INTEGRATIONS = ["linear", "slack"] as const;
export type McpIntegrationId = (typeof MCP_INTEGRATIONS)[number];

/**
 * User scopes a dedicated Slack app may grant for normal chat.
 * Search, history, channel membership, users, and sending. Canvas, list, file, reaction, and channel-creation scopes stay out.
 */
export const SLACK_USER_SCOPES = [
	"search:read.public",
	"search:read.private",
	"search:read.mpim",
	"search:read.im",
	"search:read.users",
	"channels:history",
	"groups:history",
	"mpim:history",
	"im:history",
	"channels:read",
	"groups:read",
	"mpim:read",
	"im:read",
	"users:read",
	"chat:write",
] as const;

const SLACK_SCOPE: Record<string, true> = Object.fromEntries(SLACK_USER_SCOPES.map(scope => [scope, true]));

/**
 * `input` as a unique space-separated subset of {@link SLACK_USER_SCOPES}, or `null` when it is empty or names anything else.
 * Commas and extra whitespace are separators, not part of a scope.
 */
export function normalizeSlackScope(input: string): string | null {
	const scopes = input.trim().split(/[\s,]+/).filter(Boolean);
	if (scopes.length === 0 || scopes.some(scope => !Object.hasOwn(SLACK_SCOPE, scope))) return null;
	return [...new Set(scopes)].join(" ");
}

const SLACK_LOOPBACK: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true };

/** Why `redirectUri` cannot be the Slack app's registered redirect for a listener on `callbackPort`, or `null` when it can. */
export function slackRedirectError(redirectUri: string, callbackPort: number): string | null {
	let url: URL;
	try {
		url = new URL(redirectUri);
	} catch {
		return "Enter the HTTPS redirect registered on the Slack app.";
	}
	if (url.protocol !== "https:") return "Slack needs an HTTPS redirect. Forward it to the local HTTP callback with a TLS terminator.";
	const registeredPort = url.port ? Number(url.port) : 443;
	if ((Object.hasOwn(SLACK_LOOPBACK, url.hostname) || url.hostname.endsWith(".localhost")) && registeredPort === callbackPort) {
		return "The HTTPS redirect port and the local callback port must differ. Terminate TLS on the redirect port and forward to the callback port.";
	}
	return null;
}

/** Where a service's sign-in gets its OAuth client: Linear registers its own, and Slack uses a Slack app of yours. */
export type McpClient = "none" | "slack-app";

export interface McpService {
	label: string;
	/** The host omp's server for the service is on, whatever omp named it. */
	host: string;
	/** The server a sign-in adds, under `serverName` in omp's MCP config, when omp has none. */
	url: string;
	serverName: string;
	/** Where its sign-in gets its OAuth client, which decides the setup Settings › Integrations saves and shows. */
	client: McpClient;
	/** A sign-in refuses a grant without a refresh token, which would stop working once its access token expires. */
	requireRefresh: boolean;
}

export const MCP_SERVICES = {
	linear: { label: "Linear", host: "mcp.linear.app", url: "https://mcp.linear.app/mcp", serverName: "linear", client: "none", requireRefresh: false },
	slack: { label: "Slack", host: "mcp.slack.com", url: "https://mcp.slack.com/mcp", serverName: "slack", client: "slack-app", requireRefresh: true },
} satisfies Record<McpIntegrationId, McpService>;

type ClientOf<Id extends McpIntegrationId> = (typeof MCP_SERVICES)[Id]["client"];

/** The Settings › Integrations service whose server is on `host`, if any. */
export const integrationOn = (host: string | null): McpIntegrationId | null => MCP_INTEGRATIONS.find(id => MCP_SERVICES[id].host === host) ?? null;

/** The services whose OAuth client Settings › Integrations saves; Linear registers its own. */
export type ClientService = { [K in McpIntegrationId]: ClientOf<K> extends "none" ? never : K }[McpIntegrationId];

/** Slack app settings the integrations page can show. The client secret stays in omp's config. */
export interface SlackSetup {
	clientId: string | null;
	hasClientSecret: boolean;
	redirectUri: string | null;
	callbackPort: number;
	scope: string;
	/** The saved client, secret, scope, redirect, and callback port are complete and valid. */
	configured: boolean;
}

/** `PUT /api/integrations/slack/client`. An omitted or empty `clientSecret` keeps the saved secret for the same client ID. */
export interface SlackClientInput {
	clientId: string;
	clientSecret?: string;
	redirectUri: string;
	callbackPort: number;
	scope: string;
}

/** omp's MCP server for a service: its name in omp's MCP config, its URL, and that URL's host. */
export interface McpServerRef {
	name: string;
	url: string;
	host: string;
}

/** Where omp stands with a service's MCP server: no server in omp's config, or the server and what listing its tools found. */
export type McpConnection = { kind: "absent" } | McpServerConnection;

/** Where omp stands with a server in its config: what listing its tools found. */
export type McpServerConnection = McpRemoteStatus & { server: McpServerRef };

/** Server `name` at `url` as listing its tools found it, `status`. */
export const serverConnection = ({ name, url }: { name: string; url: string }, status: McpRemoteStatus): McpServerConnection => ({
	...status,
	server: { name, url, host: new URL(url).host },
});

/** Whether omp holds a sign-in for the service, working or not: its row sits under Connected, and its tab, Linear's Tickets, shows. */
export const signedIn = (connection: McpConnection): boolean => connection.kind !== "absent" && connection.kind !== "signed-out";

/** Whether the dashboard calls the service's tools: the server took omp's sign-in, or failed for a reason a retry may clear. */
export const callable = (connection: McpConnection): boolean => connection.kind === "ready" || connection.kind === "failing";

/** `PUT /api/integrations/sign-in` and `/remove`: the service. */
export interface IntegrationTarget {
	id: McpIntegrationId;
}

/** The saved OAuth client of each kind, without the secret: `null` for a service that registers its own. */
export interface ClientSetups {
	none: null;
	"slack-app": SlackSetup;
}

/** Service `Id`'s saved OAuth client, as its `client` in {@link MCP_SERVICES} decides. */
export type McpSetup<Id extends McpIntegrationId> = ClientSetups[ClientOf<Id>];

/** One service of `GET /api/integrations`, and what `PUT /api/integrations/sign-in`, `/remove`, and `/<id>/client` answer. */
export type McpIntegration<Id extends McpIntegrationId = McpIntegrationId> = {
	[K in Id]: {
		id: K;
		/** The latest sign-in, while it waits or after it failed; `null` when none ran or the last one succeeded. */
		signIn: SignInState;
		setup: McpSetup<K>;
		connection: McpConnection;
	};
}[Id];

/** `GET /api/integrations[?fresh]`: every MCP integration by its id. */
export interface IntegrationsAnswer {
	integrations: { [K in McpIntegrationId]: McpIntegration<K> };
}

const isServerRef = fields<McpServerRef>({ name: isString, url: isString, host: isString });

const isTool = fields<McpTool>({ name: isString, description: nullable(isString) });

const isServerConnection = tagged<McpServerConnection, "kind">("kind", {
	"signed-out": { server: isServerRef },
	ready: { server: isServerRef, tools: arrayOf(isTool) },
	refused: { server: isServerRef, error: isString },
	failing: { server: isServerRef, error: isString, status: nullable(isNumber) },
});

const isConnection = (value: unknown): value is McpConnection => fields<{ kind: "absent" }>({ kind: oneOf(["absent"]) })(value) || isServerConnection(value);

const isSignIn = nullable(tagged<NonNullable<SignInState>, "phase">("phase", { waiting: { url: isString }, failed: { error: isString } }));

const isSlackSetup = fields<SlackSetup>({
	clientId: nullable(isString),
	hasClientSecret: isBoolean,
	redirectUri: nullable(isString),
	callbackPort: isNumber,
	scope: isString,
	configured: isBoolean,
});

const oneServer = <K extends McpIntegrationId, S>(id: K, setup: Guard<S>) =>
	fields<{ id: K; connection: McpConnection; signIn: SignInState; setup: S }>({ id: oneOf([id]), connection: isConnection, signIn: isSignIn, setup });

/** A kept {@link IntegrationsAnswer} with every integration, its connection, sign-in, and setup whole, or `null`. */
export const decodeIntegrationsAnswer = decoder(
	fields<IntegrationsAnswer>({
		integrations: fields<IntegrationsAnswer["integrations"]>({
			linear: oneServer("linear", oneOf([null])),
			slack: oneServer("slack", isSlackSetup),
		}),
	}),
);
