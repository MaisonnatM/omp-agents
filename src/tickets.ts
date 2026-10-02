/**
 * The tickets page's issues: the viewer's assigned Linear issues, read through Linear's MCP server with the OAuth
 * credential that omp keeps for it. That token works on the MCP endpoint only, not on Linear's GraphQL API.
 */
import { join } from "node:path";
import { type Cache, cached } from "./cache";
import { MERGED_DAYS } from "./inbox";
import { errorText, isObject, num, str } from "./json";
import { agentDir } from "./omp/config";
import { ompCommand } from "./omp/install";
import { runChecked } from "./proc";
import type { Ticket, TicketPriority, TicketStatusType, TicketsAnswer } from "./shared";

const TIMEOUT_MS = 20_000;
/** How long an `omp token` answer serves later requests; omp refreshes it before handing it out. */
const TOKEN_MS = 5 * 60_000;
/** Linear's page size cap for `list_issues`. */
const PAGE = 250;
/** Pages read at most per state, so a cursor that never ends cannot loop forever. */
const MAX_PAGES = 20;
const LINEAR_HOST = "mcp.linear.app";
const LINEAR_URL = `https://${LINEAR_HOST}/mcp`;

const FIELDS = ["id", "title", "url", "priority", "status", "statusType", "labels", "project", "team", "dueDate", "updatedAt", "gitBranchName"];

/** Every open state type in full, and closed ones updated lately. `duplicate` is its own state type in the query. */
const QUERIES: Record<string, unknown>[] = [
	...["triage", "backlog", "unstarted", "started"].map(state => ({ state })),
	...["completed", "canceled", "duplicate"].map(state => ({ state, updatedAt: `-P${MERGED_DAYS}D` })),
];

/** Linear's state types; a duplicate reads as canceled, as Linear lists it. */
const STATUS_TYPES: Record<string, TicketStatusType> = {
	triage: "triage",
	backlog: "backlog",
	unstarted: "unstarted",
	started: "started",
	completed: "completed",
	canceled: "canceled",
	duplicate: "canceled",
};

const isPriority = (value: number | undefined): value is TicketPriority => value === 0 || value === 1 || value === 2 || value === 3 || value === 4;

function parseIssue(raw: unknown): Ticket | null {
	if (!isObject(raw)) return null;
	const id = str(raw.id);
	const title = str(raw.title);
	const url = str(raw.url);
	const status = str(raw.status);
	const type = str(raw.statusType) ?? "";
	const statusType = Object.hasOwn(STATUS_TYPES, type) ? STATUS_TYPES[type] : undefined;
	const updatedAt = str(raw.updatedAt);
	if (!id || title === undefined || !url || !status || !statusType || !updatedAt) return null;
	const priority = num(isObject(raw.priority) ? raw.priority.value : raw.priority);
	return {
		id,
		title,
		url,
		status,
		statusType,
		priority: isPriority(priority) ? priority : 0,
		labels: Array.isArray(raw.labels) ? raw.labels.filter(label => typeof label === "string") : [],
		project: str(raw.project) ?? null,
		team: str(raw.team) ?? "",
		dueDate: str(raw.dueDate) ?? null,
		updatedAt,
		branch: str(raw.gitBranchName) ?? "",
	};
}

/** The JSON-RPC message in an MCP answer: a plain JSON body, or the `data:` line of a `text/event-stream` one that carries it. */
function rpcMessage(answerText: string): Record<string, unknown> {
	const bodies = answerText.trimStart().startsWith("{")
		? [answerText]
		: answerText.split("\n").flatMap(line => (line.startsWith("data:") ? [line.slice(5)] : []));
	for (const body of bodies) {
		let message: unknown;
		try {
			message = JSON.parse(body);
		} catch {
			continue;
		}
		if (isObject(message) && ("result" in message || "error" in message)) return message;
	}
	throw new Error("Linear's MCP server answered without a result");
}

/** A failed tool call's text is Linear's error, sometimes as JSON with a `message`. */
function toolError(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		const message = isObject(parsed) ? str(parsed.message) : undefined;
		if (message) return message;
	} catch {}
	return text || "Linear's MCP server reported an error";
}

/** The tickets in one `list_issues` answer and the cursor of the next page, `null` on the last; Linear's errors thrown. */
export function parseListIssues(answerText: string): { issues: Ticket[]; next: string | null } {
	const message = rpcMessage(answerText);
	if (isObject(message.error)) throw new Error(str(message.error.message) || "Linear's MCP server answered an error");
	const result = isObject(message.result) ? message.result : {};
	const content = Array.isArray(result.content) ? result.content : [];
	const text = content.map(part => (isObject(part) && part.type === "text" ? str(part.text) : undefined)).find(part => part !== undefined) ?? "";
	if (result.isError === true) throw new Error(toolError(text));
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`Linear's list_issues answered something other than JSON: ${text.slice(0, 200)}`);
	}
	if (!isObject(data) || !Array.isArray(data.issues)) throw new Error("Linear's list_issues answered without issues");
	return {
		issues: data.issues.map(parseIssue).filter(issue => issue !== null),
		next: data.hasNextPage === true ? (str(data.cursor) ?? null) : null,
	};
}

interface LinearServer {
	name: string;
	url: string;
	credentialId: string;
}

/** The Linear server in omp's user-level `mcp.json`, by its URL's host. */
async function linearServer(): Promise<LinearServer> {
	const path = join(agentDir, "mcp.json");
	const file = Bun.file(path);
	let config: unknown = {};
	if (await file.exists()) {
		try {
			config = await file.json();
		} catch (err) {
			throw new Error(`Cannot read ${path}: ${errorText(err)}`);
		}
	}
	const servers = isObject(config) && isObject(config.mcpServers) ? Object.entries(config.mcpServers) : [];
	for (const [name, server] of servers) {
		const url = isObject(server) ? str(server.url) : undefined;
		if (!url || !URL.canParse(url) || new URL(url).host !== LINEAR_HOST) continue;
		const credentialId = isObject(server) && isObject(server.auth) ? str(server.auth.credentialId) : undefined;
		if (!credentialId) throw new Error(`omp has no sign-in for its "${name}" MCP server. Run /mcp reauth ${name} in omp.`);
		return { name, url, credentialId };
	}
	throw new Error(`Add Linear's MCP server to omp to see your tickets: run /mcp add in omp with the URL ${LINEAR_URL}, then sign in.`);
}

/** `omp token`'s answers by credential id. */
const tokens: Cache<string> = new Map();

const tokenOf = (credentialId: string): Promise<string> =>
	cached(
		tokens,
		credentialId,
		false,
		async () => {
			const token = (await runChecked([...ompCommand, "token", credentialId], { timeoutMs: TIMEOUT_MS })).trim();
			if (!token) throw new Error("omp token printed no token for Linear's MCP server");
			return token;
		},
		TOKEN_MS,
	);

async function listIssues(server: LinearServer, args: Record<string, unknown>): Promise<{ issues: Ticket[]; next: string | null }> {
	const response = await fetch(server.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${await tokenOf(server.credentialId)}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_issues", arguments: args } }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (response.status === 401) {
		tokens.delete(server.credentialId);
		throw new Error(`Linear refused omp's sign-in. Run /mcp reauth ${server.name} in omp.`);
	}
	if (!response.ok) throw new Error(`Linear's MCP server answered HTTP ${response.status}`);
	return parseListIssues(await response.text());
}

async function queryTickets(): Promise<Ticket[]> {
	const server = await linearServer();
	const lists = await Promise.all(
		QUERIES.map(async query => {
			const found: Ticket[] = [];
			let cursor: string | null = null;
			for (let page = 0; page < MAX_PAGES; page++) {
				const answer = await listIssues(server, { assignee: "me", limit: PAGE, fields: FIELDS, ...query, ...(cursor && { cursor }) });
				found.push(...answer.issues);
				cursor = answer.next;
				if (!cursor) break;
			}
			return found;
		}),
	);
	return [...new Map(lists.flat().map(ticket => [ticket.id, ticket])).values()];
}

const loaded: Cache<Ticket[]> = new Map();

/** The viewer's assigned Linear issues, or why they could not be read. `fresh` skips the cache. */
export async function loadTickets(fresh: boolean): Promise<TicketsAnswer> {
	try {
		return { tickets: await cached(loaded, "", fresh, queryTickets) };
	} catch (err) {
		return { error: errorText(err) };
	}
}
