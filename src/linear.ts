/**
 * Linear's MCP server in omp, which the tickets page reads through: whether omp has the server and a sign-in for it,
 * and the sign-in the settings start, which adds the server to omp's user-level MCP config when omp has none.
 */
import { errorText } from "./json";
import { addMcpServer, findMcpServer, type McpServer, mcpSignedIn, signInMcp } from "./omp/mcp";
import type { LinearSignIn, LinearStatus } from "./shared";

const LINEAR_HOST = "mcp.linear.app";
const LINEAR_URL = `https://${LINEAR_HOST}/mcp`;
/** The name a sign-in gives the server it adds. */
const SERVER_NAME = "linear";
/** How long a sign-in waits for the browser, as omp's `/mcp` does. */
const SIGN_IN_MS = 5 * 60_000;

/** omp's server for Linear, as the tickets page reads it. */
export async function linearServer(): Promise<McpServer> {
	const server = await findMcpServer(LINEAR_HOST);
	if (!server) throw new Error("Linear is not connected. Connect it in Settings, under Integrations.");
	return server;
}

/** The sign-in under way or that last failed; `null` once one succeeds. A new sign-in replaces it. */
let current: { signIn: LinearSignIn; controller: AbortController } | null = null;

export async function loadLinearStatus(): Promise<LinearStatus> {
	const server = await findMcpServer(LINEAR_HOST);
	return { connected: server !== null && (await mcpSignedIn(server)), signIn: current?.signIn ?? null };
}

/**
 * Starts a sign-in to Linear, abandoning any under way, and answers once it has Linear's authorization address or has
 * failed. It signs in to omp's server for Linear, else adds one once the browser comes back.
 */
export async function startLinearSignIn(): Promise<LinearStatus> {
	current?.controller.abort();
	const attempt: NonNullable<typeof current> = { signIn: null, controller: new AbortController() };
	current = attempt;
	const timeout = AbortSignal.timeout(SIGN_IN_MS);
	const ready = Promise.withResolvers<void>();
	const run = async (): Promise<void> => {
		const found = await findMcpServer(LINEAR_HOST);
		await signInMcp(
			found ?? { url: LINEAR_URL },
			{
				onAuth: url => {
					attempt.signIn = { phase: "waiting", url };
					ready.resolve();
				},
				signal: AbortSignal.any([attempt.controller.signal, timeout]),
			},
		);
		if (!found) await addMcpServer(SERVER_NAME, LINEAR_URL);
	};
	run()
		.then(
			() => {
				if (current === attempt) current = null;
			},
			(err: unknown) => {
				if (attempt.controller.signal.aborted) return;
				const error = timeout.aborted ? "Linear's sign-in page was not completed within 5 minutes. Try again." : errorText(err);
				attempt.signIn = { phase: "failed", error };
			},
		)
		.finally(() => ready.resolve());
	await ready.promise;
	return loadLinearStatus();
}
