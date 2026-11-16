/**
 * The services whose MCP server the integrations page signs omp in to: where omp stands with each, checked by listing
 * the server's tools, and the sign-ins and removals the page starts. Slack signs in to the first server on its
 * host, and a sign-in adds it to omp's user-level MCP config when omp has none.
 */
import { clientSetup, type ClientSave, planSlackSave } from "./mcp-clients";
import { remoteStatusOf } from "./mcp-status";
import {
	addMcpServer,
	enableMcpServersOn,
	findMcpServers,
	mcpBearer,
	type McpServer,
	mcpSignedIn,
	mcpSignedInIds,
	signInMcp,
	signOutMcp,
	userMcpConfigPath,
	writeMcpServer,
} from "./omp/mcp";
import {
	type IntegrationsAnswer,
	type IntegrationTarget,
	MCP_INTEGRATIONS,
	MCP_SERVICES,
	type McpClient,
	type McpIntegration,
	type McpIntegrationId,
	serverConnection,
	type SlackClientInput,
} from "./shared/accounts";
import { createSignIn, type SignIn } from "./sign-in";
import { type SignedFetch, signedFetch } from "./signed-fetch";

const serversOf = (id: McpIntegrationId): Promise<McpServer[]> => findMcpServers(MCP_SERVICES[id].host);

/** omp's server for `id`, which reads and writes the service through its tools. */
export async function integrationServer(id: McpIntegrationId): Promise<McpServer> {
	const [server] = await serversOf(id);
	if (!server) throw new Error(`${MCP_SERVICES[id].label} is not connected. Connect it in Settings › Integrations.`);
	return server;
}

/** Whether omp has a server for `id` and holds a sign-in to it. */
export async function integrationSignedIn(id: McpIntegrationId): Promise<boolean> {
	const [server] = await serversOf(id);
	return !!server && (await mcpSignedIn(server));
}

/** Calls the APIs of service `id`, such as Slack's Web API, with omp's sign-in to its server. */
export const integrationFetch = (id: McpIntegrationId): SignedFetch => signedFetch(async () => mcpBearer(await integrationServer(id)));

/** Signs omp out of service `id`'s first server and keeps it in omp's config. */
async function signOut(id: McpIntegrationId): Promise<void> {
	const [found] = await serversOf(id);
	if (found) await signOutMcp(found);
}

const SETUP_ERROR: Record<McpClient, string> = {
	"slack-app": "Set up the Slack app before connecting. Save a client ID, client secret, HTTPS redirect, callback port, and at least one supported scope.",
};

/** What `GET /api/integrations` and the integration writes do. */
export interface Integrations {
	/** Every integration; `fresh` lists each signed-in server's tools again rather than the minute-old list. */
	load(fresh: boolean): Promise<IntegrationsAnswer>;
	/** Starts the sign-in `target` names, abandoning any of its service under way, and answers once it has the authorization address or has failed. */
	startSignIn(target: IntegrationTarget): Promise<McpIntegration>;
	/** Abandons a sign-in under way to what `target` names and signs omp out of it. */
	remove(target: IntegrationTarget): Promise<McpIntegration>;
	saveSlackClient(input: SlackClientInput): Promise<McpIntegration>;
}

/**
 * The integrations, each signing in to the first server on its host: a sign-in signs in to it, else to its URL and
 * adds its server once the browser comes back. A removal signs out of it and keeps it in omp's config.
 */
export function createIntegrations(): Integrations {
	const signIns = Object.fromEntries(
		MCP_INTEGRATIONS.map(id => [id, createSignIn(`${MCP_SERVICES[id].label}'s sign-in page was not completed within 5 minutes. Try again.`)]),
	) as Record<McpIntegrationId, SignIn>;

	const load = async (id: McpIntegrationId, fresh: boolean): Promise<McpIntegration> => {
		const [found] = await serversOf(id);
		const connection = found
			? serverConnection(found, await signIns[id].hold(async () => remoteStatusOf(found, { signedIn: await mcpSignedIn(found), signInRequired: true }, fresh)))
			: { kind: "absent" as const };
		return { id, connection, signIn: signIns[id].state(), setup: await clientSetup(id) } as McpIntegration;
	};

	/**
	 * Saves `id`'s OAuth client, as `plan` makes it from the user MCP config, and answers the integration.
	 * A waiting sign-in is cancelled. A new client ID or secret also drops the sign-ins made with the old one.
	 */
	const saveClient = async (id: McpIntegrationId, plan: (path: string) => Promise<ClientSave>): Promise<McpIntegration> => {
		const path = userMcpConfigPath();
		const planned = await plan(path);
		signIns[id].cancel();
		for (const { name, server } of planned.writes) await writeMcpServer(path, name, server);
		if (planned.dropCredentials) await signOut(id);
		return load(id, false);
	};

	return {
		async load(fresh) {
			const loaded = await Promise.all(MCP_INTEGRATIONS.map(id => load(id, fresh)));
			return { integrations: Object.fromEntries(loaded.map(integration => [integration.id, integration])) as IntegrationsAnswer["integrations"] };
		},

		/** A service turned off in Settings › MCP servers is turned back on first, and needs no browser while omp still holds a sign-in to it. */
		async startSignIn({ id }) {
			const service = MCP_SERVICES[id];
			await signIns[id].start(async (signal, waiting) => {
				const turnedOn = await enableMcpServersOn(service.host);
				if (turnedOn && (await mcpSignedInIds((await serversOf(id)).map(server => server.credentialId))).size > 0) return;
				if (!(await clientSetup(id)).configured) throw new Error(SETUP_ERROR[service.client]);
				const [found] = await serversOf(id);
				await signInMcp(found ? { url: found.url, credentialId: found.credentialId, oauth: found.config.oauth } : { url: service.url }, { onAuth: waiting, signal, requireRefresh: service.requireRefresh });
				if (!found) await addMcpServer(service.serverName, { type: "http", url: service.url });
			});
			return load(id, false);
		},

		async remove({ id }) {
			signIns[id].cancel();
			await signOut(id);
			return load(id, false);
		},

		saveSlackClient: input => saveClient("slack", path => planSlackSave(path, input)),
	};
}
