import { errorText } from "../json";
import type { Integrations } from "../integrations";
import {
	addMcpServerFrom,
	loadMcpServers,
	McpServerRejected,
	removeMcpServerNamed,
	setMcpServerEnabledFrom,
	signOutMcpServer,
	startMcpServerSignIn,
} from "../mcp-servers";
import {
	attachToTicket,
	createTicket,
	loadLinearUsers,
	loadTeams,
	loadTicketDetail,
	loadTicketMedia,
	loadTicketOptions,
	loadTickets,
	saveTicket,
} from "../tickets";
import { isUploadPath } from "../linear-uploads";
import { ClientConfigError } from "../mcp-clients";
import { GOOGLE_SERVICES, type GoogleService, type IntegrationTarget, type McpIntegration } from "../shared/accounts";
import { answer, checked, fail } from "./http";
import {
	parseGoogleClient,
	parseGoogleLinks,
	parseIntegrationTarget,
	parseMcpServerAdd,
	parseMcpServerEnabled,
	parseMcpServerName,
	parseSlackClient,
	parseTicketAttachment,
	parseTicketDraft,
	parseTicketEdit,
	UUID,
} from "./wire";
import { MAX_TICKET_ATTACHMENT_BYTES, TICKET_ID } from "../shared/tickets";
import type { Handler, RouteKit, Routes } from "./route-kit";

/** The MCP integrations, the other MCP servers omp loads, and Linear tickets. */
export function integrationRoutes({ get, media, write }: RouteKit, integrations: Integrations): Routes {
	/** `GET /api/integrations[?fresh]`: where omp stands with each MCP integration's server or accounts, and the sign-in the page last started. */
	const loaded = get((params) => answer(() => integrations.load(params.has("fresh"))));

	/** A write of `{ id, account }` naming an MCP integration and one of its accounts, answered with that integration as `act` leaves it. */
	const integrationWrite = (act: (target: IntegrationTarget) => Promise<McpIntegration>): Handler =>
		write(
			(body) => checked(parseIntegrationTarget(body), "Expected { id, account } naming an integration and, for Gmail or Google Calendar, an account or null"),
			act,
		);

	/** `PUT /api/integrations/sign-in`: starts a sign-in to an account, or adds one, and answers with its authorization address to open. */
	const integrationSignIn = integrationWrite(integrations.startSignIn);

	/** `PUT /api/integrations/remove`: signs out of the integration's server, as `/mcp unauth` does, and removes an account's server unless it is the last. */
	const integrationRemove = integrationWrite(integrations.remove);

	/** `PUT /api/integrations/google-links`: `{ address, workspaces }`, the workspaces a Google address's accounts are linked to; answers every integration. */
	const googleLinks = write(
		(body) => checked(parseGoogleLinks(body), "Expected { address, workspaces } naming a Google address and absolute workspace directories"),
		integrations.linkGoogleAccount,
	);

	const refuseClient = (err: unknown): Response | null => (err instanceof ClientConfigError ? fail(400, err.message) : null);

	/** `PUT /api/integrations/slack/client`: `{ clientId, clientSecret?, redirectUri, callbackPort, scope }` of your Slack app. */
	const slackClient = write((body) => checked(parseSlackClient(body)), integrations.saveSlackClient, refuseClient);

	/** `PUT /api/integrations/<google-calendar|gmail>/client`: `{ clientId, clientSecret?, callbackPort }` of your Google OAuth client for that service. */
	const googleClient = (id: GoogleService): Handler =>
		write(
			(body) => checked(parseGoogleClient(body)),
			(input) => integrations.saveGoogleClient(id, input),
			refuseClient,
		);

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

	/** `GET /api/tickets[?fresh]`: the viewer's assigned Linear issues, or why they could not be read. */
	const tickets = get((params) => answer(() => loadTickets(params.has("fresh"))));

	/** `GET /api/ticket?id=<identifier>`: that Linear issue in full, for the tickets page's main content. */
	const ticket = get((params) => {
		const id = params.get("id") ?? "";
		return TICKET_ID.test(id) ? answer(() => loadTicketDetail(id)) : fail(400, "Expected ?id= naming a Linear issue, such as ENG-123");
	});

	/** `PUT /api/ticket`: `TicketEdit`, applied in Linear; answers the issue in full as it is after it. */
	const ticketWrite = write((body) => checked(parseTicketEdit(body), "Expected { id } naming a Linear issue and at least one field to change"), saveTicket);

	/** `PUT /api/ticket/new`: `TicketDraft`, opened in Linear; answers `{ identifier }`. */
	const ticketCreate = write(
		(body) => checked(parseTicketDraft(body), "Expected { title, description, team } naming a Linear team by id, and fields of their own types"),
		createTicket,
	);

	/** `PUT /api/ticket/attachment`: `TicketAttachmentUpload`, attached to the issue in Linear; answers `{}`. */
	const ticketAttach = write(
		(body) =>
			checked(
				parseTicketAttachment(body),
				`Expected { issue, name, type, data } naming a Linear issue, with a file of at most ${MAX_TICKET_ATTACHMENT_BYTES / 1024 / 1024} MB in base64`,
			),
		async (upload) => {
			await attachToTicket(upload);
			return {};
		},
	);

	/** `GET /api/linear/teams`: the workspace's Linear teams, `{ id, name, key }`, for the team a new issue goes in. */
	const teams = get(() => answer(loadTeams));

	/** `GET /api/linear/users`: the workspace's active Linear members, `{ id, name }`, for the composer's People. */
	const linearUsers = get(() => answer(loadLinearUsers));

	/** `GET /api/ticket/options?team=<id>`: what the field pickers offer for an issue of that Linear team. */
	const ticketOptions = get((params) => {
		const team = params.get("team") ?? "";
		return UUID.test(team) ? answer(() => loadTicketOptions(team)) : fail(400, "Expected ?team= naming a Linear team by id");
	});

	/** `GET /api/ticket/media?issue=<identifier>&path=<upload path>`: a file that the issue or its comments embed, from Linear. */
	const ticketMedia = media(async (params, req) => {
		const issue = params.get("issue") ?? "";
		const path = params.get("path") ?? "";
		if (!TICKET_ID.test(issue) || !isUploadPath(path)) return fail(400, "Expected ?issue= naming a Linear issue and ?path= naming one of its files");
		try {
			return (await loadTicketMedia(issue, path, req.headers.get("range"), req.signal)) ?? fail(404, `${issue} embeds no file ${path}`);
		} catch (err) {
			return fail(502, errorText(err));
		}
	});

	return {
		"/api/integrations": { GET: loaded },
		"/api/integrations/sign-in": { PUT: integrationSignIn },
		"/api/integrations/remove": { PUT: integrationRemove },
		"/api/integrations/google-links": { PUT: googleLinks },
		"/api/mcp-servers": { GET: mcpServers },
		"/api/mcp-servers/add": { PUT: mcpServerAdd },
		"/api/mcp-servers/sign-in": { PUT: mcpServerWrite(startMcpServerSignIn) },
		"/api/mcp-servers/sign-out": { PUT: mcpServerWrite(signOutMcpServer) },
		"/api/mcp-servers/enabled": { PUT: mcpServerEnabled },
		"/api/mcp-servers/remove": { PUT: mcpServerRemove },
		"/api/integrations/slack/client": { PUT: slackClient },
		...Object.fromEntries(GOOGLE_SERVICES.map((id) => [`/api/integrations/${id}/client`, { PUT: googleClient(id) }])),
		"/api/tickets": { GET: tickets },
		"/api/linear/teams": { GET: teams },
		"/api/linear/users": { GET: linearUsers },
		"/api/ticket": { GET: ticket, PUT: ticketWrite },
		"/api/ticket/new": { PUT: ticketCreate },
		"/api/ticket/attachment": { PUT: ticketAttach },
		"/api/ticket/options": { GET: ticketOptions },
		"/api/ticket/media": { GET: ticketMedia },
	};
}
