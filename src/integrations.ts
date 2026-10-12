/**
 * The services whose MCP server the integrations page signs omp in to: where omp stands with each, checked by listing
 * the server's tools, and the sign-in and sign-out the page starts. A sign-in adds the service's server to omp's
 * user-level MCP config when omp has none.
 */
import { errorText } from "./json";
import { clientSetups, type ClientSave, planGoogleSave, planGoogleScope, planSlackSave } from "./mcp-clients";
import {
	addMcpServer,
	ApiError,
	type ApiWrite,
	callWithMcpSignIn,
	checkMcpServer,
	findMcpServer,
	type McpServer,
	McpRefused,
	mcpSignedIn,
	signInMcp,
	signOutMcp,
	userMcpConfigPath,
	writeMcpServer,
} from "./omp/mcp";
import {
	type ClientService,
	type GoogleClientInput,
	GOOGLE_SERVICES,
	type GoogleService,
	type IntegrationsAnswer,
	MCP_INTEGRATIONS,
	MCP_SERVICES,
	type McpConnection,
	type McpIntegration,
	type McpIntegrationId,
	type SlackClientInput,
} from "./shared/accounts";
import { createSignIn, type SignIn } from "./sign-in";

const signIns = Object.fromEntries(
	MCP_INTEGRATIONS.map(id => [id, createSignIn(`${MCP_SERVICES[id].label}'s sign-in page was not completed within 5 minutes. Try again.`)]),
) as Record<McpIntegrationId, SignIn>;

/** Each service's connection as last answered, which a read repeats while its sign-in waits on the browser. */
const lastConnections = new Map<McpIntegrationId, McpConnection>();

/** omp's server for `id`, which reads and writes the service through its tools. */
export async function integrationServer(id: McpIntegrationId): Promise<McpServer> {
	const server = await findMcpServer(MCP_SERVICES[id].host);
	if (!server) throw new Error(`${MCP_SERVICES[id].label} is not connected. Connect it in Settings › Integrations.`);
	return server;
}

/**
 * Calls a Google API address with your sign-in: reads its JSON, or with `init` posts its body as JSON or deletes it, and
 * reads the answer, `null` when empty. Another failure than a refused sign-in throws `ApiError` with Google's status.
 */
export type GoogleFetch = (url: string, init?: ApiWrite) => Promise<unknown>;

/** {@link GoogleFetch} with omp's sign-in to Google service `id`. */
export const googleFetch = (id: GoogleService): GoogleFetch => async (url, init) => callWithMcpSignIn(await integrationServer(id), url, init);

/** How {@link connectionOf} asks omp about a server: whether it holds a sign-in, and the server's tools with it. */
export interface McpProbes {
	signedIn: (server: McpServer) => Promise<boolean>;
	tools: (server: McpServer) => Promise<string[]>;
}

/** Where omp stands with `found`, omp's server for a service or `null` when its config has none. */
export async function connectionOf(found: McpServer | null, probes: McpProbes): Promise<McpConnection> {
	if (!found) return { kind: "absent" };
	const server = { name: found.name, url: found.url, host: new URL(found.url).host };
	if (!(await probes.signedIn(found))) return { kind: "signed-out", server };
	try {
		return { kind: "ready", server, tools: await probes.tools(found) };
	} catch (err) {
		if (err instanceof McpRefused) return { kind: "refused", server, error: errorText(err) };
		return { kind: "failing", server, error: errorText(err), status: err instanceof ApiError ? err.status : null };
	}
}

/**
 * `id`'s integration with `found` as its server. While a sign-in waits on the browser, the connection is the last one
 * answered, since the sign-in is about to change it and the page asks every few seconds meanwhile.
 */
async function loadIntegration(id: McpIntegrationId, found: McpServer | null, fresh: boolean): Promise<McpIntegration> {
	const signIn = signIns[id].state();
	const last = lastConnections.get(id);
	const connection =
		signIn?.phase === "waiting" && last ? last : await connectionOf(found, { signedIn: mcpSignedIn, tools: server => checkMcpServer(server, fresh) });
	lastConnections.set(id, connection);
	const setup = id === "linear" ? null : (await clientSetups())[id];
	return { id, connection, signIn, setup } as McpIntegration;
}

const findServer = (id: McpIntegrationId): Promise<McpServer | null> => findMcpServer(MCP_SERVICES[id].host);

/** Every integration; `fresh` lists each signed-in server's tools again rather than the minute-old list. */
export async function loadIntegrations(fresh: boolean): Promise<IntegrationsAnswer> {
	const loaded = await Promise.all(MCP_INTEGRATIONS.map(async id => loadIntegration(id, await findServer(id), fresh)));
	return { integrations: Object.fromEntries(loaded.map(integration => [integration.id, integration])) as IntegrationsAnswer["integrations"] };
}

const GOOGLE_SETUP_ERROR = "Set up the Google OAuth client before connecting. Save its client ID, client secret, and callback port.";

const SETUP_ERROR: Record<ClientService, string> = {
	slack: "Set up the Slack app before connecting. Save a client ID, client secret, HTTPS redirect, callback port, and at least one supported scope.",
	"google-calendar": GOOGLE_SETUP_ERROR,
	gmail: GOOGLE_SETUP_ERROR,
};

const isGoogleService = (id: McpIntegrationId): id is GoogleService => (GOOGLE_SERVICES as readonly string[]).includes(id);

/**
 * Starts a sign-in to `id`, abandoning any under way, and answers once it has the service's authorization address or
 * has failed. It signs in to omp's server for the service, else adds one once the browser comes back.
 */
export async function startIntegrationSignIn(id: McpIntegrationId): Promise<McpIntegration> {
	const service = MCP_SERVICES[id];
	await signIns[id].start(async (signal, waiting) => {
		if (id !== "linear" && !(await clientSetups())[id].configured) throw new Error(SETUP_ERROR[id]);
		if (isGoogleService(id)) {
			const rescoped = await planGoogleScope(userMcpConfigPath(), id);
			if (rescoped) await writeMcpServer(userMcpConfigPath(), rescoped.name, rescoped.server);
		}
		const found = await findServer(id);
		await signInMcp(found ?? { url: service.url }, { onAuth: waiting, signal, requireRefresh: id === "slack" });
		if (!found) await addMcpServer(service.serverName, { type: "http", url: service.url });
	});
	return loadIntegration(id, await findServer(id), false);
}

/**
 * Saves `id`'s OAuth client, as `plan` makes it from the user MCP config, and answers the integration.
 * A waiting sign-in is cancelled. A new client ID or secret also drops the credentials omp manages for that server.
 */
async function saveClient(id: ClientService, plan: (path: string) => Promise<ClientSave>): Promise<McpIntegration> {
	const path = userMcpConfigPath();
	const planned = await plan(path);
	signIns[id].cancel();
	if (planned.dropCredentials && planned.credential) await signOutMcp(planned.credential);
	await writeMcpServer(path, planned.name, planned.server);
	return loadIntegration(id, await findServer(id), false);
}

export const saveSlackClient = (input: SlackClientInput): Promise<McpIntegration> => saveClient("slack", path => planSlackSave(path, input));

export const saveGoogleClient = (id: GoogleService, input: GoogleClientInput): Promise<McpIntegration> => saveClient(id, path => planGoogleSave(path, id, input));

/** Abandons a sign-in to `id` under way and signs omp out of its server, which stays in omp's config. */
export async function signOutIntegration(id: McpIntegrationId): Promise<McpIntegration> {
	signIns[id].cancel();
	const found = await findServer(id);
	if (found) await signOutMcp(found);
	return loadIntegration(id, found, false);
}
