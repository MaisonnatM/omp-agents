/**
 * Linear's MCP server in omp, which the tickets page reads through: whether omp has the server and a sign-in for it,
 * and the sign-in the settings start, which adds the server to omp's user-level MCP config when omp has none.
 */
import { addMcpServer, findMcpServer, type McpServer, mcpSignedIn, signInMcp } from "./omp/mcp";
import type { LinearStatus } from "./shared/accounts";
import { createSignIn } from "./sign-in";

const LINEAR_HOST = "mcp.linear.app";
const LINEAR_URL = `https://${LINEAR_HOST}/mcp`;
/** The name a sign-in gives the server it adds. */
const SERVER_NAME = "linear";

/** omp's server for Linear, as the tickets page reads it. */
export async function linearServer(): Promise<McpServer> {
	const server = await findMcpServer(LINEAR_HOST);
	if (!server) throw new Error("Linear is not connected. Connect it in Settings, under Integrations.");
	return server;
}

const signIn = createSignIn("Linear's sign-in page was not completed within 5 minutes. Try again.");

export async function loadLinearStatus(): Promise<LinearStatus> {
	const server = await findMcpServer(LINEAR_HOST);
	return { connected: server !== null && (await mcpSignedIn(server)), signIn: signIn.state() };
}

/**
 * Starts a sign-in to Linear, abandoning any under way, and answers once it has Linear's authorization address or has
 * failed. It signs in to omp's server for Linear, else adds one once the browser comes back.
 */
export async function startLinearSignIn(): Promise<LinearStatus> {
	await signIn.start(async (signal, waiting) => {
		const found = await findMcpServer(LINEAR_HOST);
		await signInMcp(found ?? { url: LINEAR_URL }, { onAuth: waiting, signal });
		if (!found) await addMcpServer(SERVER_NAME, LINEAR_URL);
	});
	return loadLinearStatus();
}
