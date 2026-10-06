/**
 * The services whose MCP server the integrations page signs omp in to: where omp stands with each, checked by listing
 * the server's tools, and the sign-in and sign-out the page starts. A sign-in adds the service's server to omp's
 * user-level MCP config when omp has none.
 */
import { addMcpServer, checkMcpServer, findMcpServer, type McpServer, mcpSignedIn, signInMcp, signOutMcp } from "./omp/mcp";
import { type IntegrationsAnswer, MCP_INTEGRATIONS, type McpConnection, type McpIntegration, type McpIntegrationId } from "./shared/accounts";
import { createSignIn, type SignIn } from "./sign-in";

interface Service {
	label: string;
	/** The host omp's server for the service is on, whatever omp named it. */
	host: string;
	/** The server a sign-in adds, by `name`, when omp has none. */
	url: string;
	name: string;
	signIn: SignIn;
}

const timeout = (label: string): string => `${label}'s sign-in page was not completed within 5 minutes. Try again.`;

const SERVICES: Record<McpIntegrationId, Service> = {
	linear: { label: "Linear", host: "mcp.linear.app", url: "https://mcp.linear.app/mcp", name: "linear", signIn: createSignIn(timeout("Linear")) },
};

/** omp's server for `id`, which reads and writes the service through its tools. */
export async function integrationServer(id: McpIntegrationId): Promise<McpServer> {
	const server = await findMcpServer(SERVICES[id].host);
	if (!server) throw new Error(`${SERVICES[id].label} is not connected. Connect it on the Integrations page.`);
	return server;
}

async function connectionOf(id: McpIntegrationId, fresh: boolean): Promise<McpConnection> {
	const found = await findMcpServer(SERVICES[id].host);
	if (!found) return { kind: "absent" };
	const server = { name: found.name, url: found.url };
	if (!(await mcpSignedIn(found))) return { kind: "signed-out", server };
	const check = await checkMcpServer(found, fresh);
	if (check.ok) return { kind: "ready", server, tools: check.tools };
	return { kind: check.refused ? "refused" : "failing", server, error: check.error };
}

async function loadIntegration(id: McpIntegrationId, fresh: boolean): Promise<McpIntegration> {
	return { id, connection: await connectionOf(id, fresh), signIn: SERVICES[id].signIn.state() };
}

/** Every integration; `fresh` lists each signed-in server's tools again rather than the minute-old list. */
export async function loadIntegrations(fresh: boolean): Promise<IntegrationsAnswer> {
	return { integrations: await Promise.all(MCP_INTEGRATIONS.map(id => loadIntegration(id, fresh))) };
}

/**
 * Starts a sign-in to `id`, abandoning any under way, and answers once it has the service's authorization address or
 * has failed. It signs in to omp's server for the service, else adds one once the browser comes back.
 */
export async function startIntegrationSignIn(id: McpIntegrationId): Promise<McpIntegration> {
	const service = SERVICES[id];
	await service.signIn.start(async (signal, waiting) => {
		const found = await findMcpServer(service.host);
		await signInMcp(found ?? { url: service.url }, { onAuth: waiting, signal });
		if (!found) await addMcpServer(service.name, service.url);
	});
	return loadIntegration(id, false);
}

/** Abandons a sign-in to `id` under way and signs omp out of its server, which stays in omp's config. */
export async function signOutIntegration(id: McpIntegrationId): Promise<McpIntegration> {
	SERVICES[id].signIn.cancel();
	const found = await findMcpServer(SERVICES[id].host);
	if (found) await signOutMcp(found);
	return loadIntegration(id, false);
}
