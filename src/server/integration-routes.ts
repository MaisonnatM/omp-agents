import { integrationFetch, integrationSignedIn, type Integrations } from "../integrations";
import { NoLinearServer, readLinearIssue } from "../linear";
import {
	addMcpServerFrom,
	loadMcpServers,
	McpServerRejected,
	removeMcpServerNamed,
	setMcpServerEnabledFrom,
	signOutMcpServer,
	startMcpServerSignIn,
} from "../mcp-servers";
import { ClientConfigError } from "../mcp-clients";
import { yourAvatar } from "../slack-messages";
import { McpRefused } from "../omp/mcp";
import type { IntegrationTarget, McpIntegration } from "../shared/accounts";
import { linearIssueId } from "../shared/linear";
import { answer, checked, fail } from "./http";
import { parseIntegrationTarget, parseMcpServerAdd, parseMcpServerEnabled, parseMcpServerName, parseSlackClient } from "./wire";
import type { Handler, RouteKit, Routes } from "./route-kit";

/** The MCP integrations and the other MCP servers omp loads. */
export function integrationRoutes({ get, write }: RouteKit, integrations: Integrations): Routes {
	/** `GET /api/integrations[?fresh]`: where omp stands with each MCP integration's server, and the sign-in the page last started. */
	const loaded = get((params) => answer(() => integrations.load(params.has("fresh"))));

	/** A write of `{ id }` naming an MCP integration, answered with that integration as `act` leaves it. */
	const integrationWrite = (act: (target: IntegrationTarget) => Promise<McpIntegration>): Handler =>
		write((body) => checked(parseIntegrationTarget(body), "Expected { id } naming an integration"), act);

	/** `PUT /api/integrations/sign-in`: starts a sign-in, and answers with its authorization address to open. */
	const integrationSignIn = integrationWrite(integrations.startSignIn);

	/** `PUT /api/integrations/remove`: signs out of the integration's server, as `/mcp unauth` does. */
	const integrationRemove = integrationWrite(integrations.remove);

	const refuseClient = (err: unknown): Response | null => (err instanceof ClientConfigError ? fail(400, err.message) : null);

	/** `PUT /api/integrations/slack/client`: `{ clientId, clientSecret?, redirectUri, callbackPort, scope }` of your Slack app. */
	const slackClient = write((body) => checked(parseSlackClient(body)), integrations.saveSlackClient, refuseClient);

	/** `GET /api/integrations/slack/me`: `{ avatarUrl }`, your Slack profile picture, `null` while Slack is signed out. */
	const slackMe = get(() => answer(async () => ({ avatarUrl: (await integrationSignedIn("slack")) ? await yourAvatar(integrationFetch("slack")) : null })));

	/** `GET /api/mcp-servers[?fresh]`: every user-level MCP server omp loads, where omp stands with each, and its sign-in under way. */
	const mcpServers = get((params) => answer(() => loadMcpServers(params.has("fresh"))));

	const refuseMcp = (err: unknown): Response | null => (err instanceof McpServerRejected ? fail(400, err.message) : null);

	/** A write of `{ name }` naming an MCP server, answered with what `act` answers. */
	const mcpServerWrite = (act: (name: string) => Promise<unknown>): Handler =>
		write((body) => checked(parseMcpServerName(body), "Expected { name } naming an MCP server"), act, refuseMcp);

	/** `PUT /api/mcp-servers/add`: a catalog entry or a server by its address, added to omp's user `mcp.json`; answers its row. */
	const mcpServerAdd = write((body) => checked(parseMcpServerAdd(body)), addMcpServerFrom, refuseMcp);

	/** `PUT /api/mcp-servers/enabled`: `{ name, enabled }`, as `/mcp enable` and `/mcp disable` do; answers the row. */
	const mcpServerEnabled = write(
		(body) => checked(parseMcpServerEnabled(body), "Expected { name, enabled } naming an MCP server"),
		({ name, enabled }) => setMcpServerEnabledFrom(name, enabled),
		refuseMcp,
	);

	/** `PUT /api/mcp-servers/remove`: removes the server from omp's user `mcp.json`, as `/mcp remove` does; answers `{}`. */
	const mcpServerRemove = mcpServerWrite(async (name) => {
		await removeMcpServerNamed(name);
		return {};
	});

	/** `GET /api/linear/issue?id=`: the Linear issue `id` names, an id such as `ENG-123` or its link, read through omp's Linear MCP server. */
	const linearIssue = get((params) => {
		const id = linearIssueId(params.get("id") ?? "");
		if (id === null) return fail(400, "Expected ?id= naming a Linear issue, such as ENG-123");
		// The setups only Settings › MCP servers fixes answer 409, apart from a failed read.
		return answer(() => readLinearIssue(id), err => (err instanceof NoLinearServer || err instanceof McpRefused ? fail(409, err.message) : null));
	});

	return {
		"/api/integrations": { GET: loaded },
		"/api/integrations/sign-in": { PUT: integrationSignIn },
		"/api/integrations/remove": { PUT: integrationRemove },
		"/api/mcp-servers": { GET: mcpServers },
		"/api/mcp-servers/add": { PUT: mcpServerAdd },
		"/api/mcp-servers/sign-in": { PUT: mcpServerWrite(startMcpServerSignIn) },
		"/api/mcp-servers/sign-out": { PUT: mcpServerWrite(signOutMcpServer) },
		"/api/mcp-servers/enabled": { PUT: mcpServerEnabled },
		"/api/mcp-servers/remove": { PUT: mcpServerRemove },
		"/api/integrations/slack/client": { PUT: slackClient },
		"/api/integrations/slack/me": { GET: slackMe },
		"/api/linear/issue": { GET: linearIssue },
	};
}
