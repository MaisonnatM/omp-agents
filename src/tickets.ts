/**
 * The tickets page's issues: the viewer's assigned Linear issues, and one issue in full for its sheet, read through
 * Linear's MCP server with the OAuth credential that omp keeps for it. That token works on the MCP endpoint only, not
 * on Linear's GraphQL API.
 */
import { createCache } from "./cache";
import { isObject, num, str } from "./json";
import { linearServer } from "./linear";
import { callMcpTool, type McpServer, toolJson } from "./omp/mcp";
import { TICKET_STATUS_TYPES, type Ticket, type TicketComment, type TicketDetail, type TicketPriority, type TicketsAnswer } from "./shared";

/** Linear's page size cap for `list_issues`. */
const PAGE = 250;
/** Pages read at most per query, so a cursor that never ends cannot loop forever. */
const MAX_PAGES = 20;
/** How many days back the page lists closed issues. */
const CLOSED_DAYS = 7;

const FIELDS = ["id", "title", "url", "priority", "status", "statusType", "labels", "project", "team", "dueDate", "updatedAt", "gitBranchName"];

/** Linear's state types, and `duplicate`, which the query takes as a state of its own and the page reads as canceled. */
const QUERY_STATES = [...TICKET_STATUS_TYPES, "duplicate"] as const;
const CLOSED_STATES: readonly string[] = ["completed", "canceled", "duplicate"];

/** Every open state type in full, and closed ones updated lately. */
const QUERIES: Record<string, unknown>[] = QUERY_STATES.map(state => (CLOSED_STATES.includes(state) ? { state, updatedAt: `-P${CLOSED_DAYS}D` } : { state }));

const isPriority = (value: number | undefined): value is TicketPriority => value === 0 || value === 1 || value === 2 || value === 3 || value === 4;

function parseIssue(raw: unknown): Ticket | null {
	if (!isObject(raw)) return null;
	const id = str(raw.id);
	const title = str(raw.title);
	const url = str(raw.url);
	const status = str(raw.status);
	const type = str(raw.statusType);
	const statusType = type === "duplicate" ? "canceled" : TICKET_STATUS_TYPES.find(known => known === type);
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

/** The tickets in one `list_issues` answer's text and the cursor of the next page, `null` on the last. */
export function parseIssues(toolText: string): { issues: Ticket[]; next: string | null } {
	const data = toolJson("Linear", "list_issues", toolText);
	if (!isObject(data) || !Array.isArray(data.issues)) throw new Error("Linear's list_issues answered without issues");
	return {
		issues: data.issues.map(parseIssue).filter(issue => issue !== null),
		next: data.hasNextPage === true ? (str(data.cursor) ?? null) : null,
	};
}

/** The `src` in a `<linear-image>` tag's JSON. */
function imageSrc(json: string): string | undefined {
	try {
		const image: unknown = JSON.parse(json);
		return isObject(image) && isObject(image.attrs) ? str(image.attrs.src) : undefined;
	} catch {
		return undefined;
	}
}

/** Linear's markdown with its own tags made plain markdown: an issue mention becomes a link to the issue, and an image an image link. */
export function linearMarkdown(text: string): string {
	return text
		.replace(/<issue\b[^>]*\bhref="([^"]+)"[^>]*>(.*?)<\/issue>/gs, (_, href: string, label: string) => `[${label}](<${href}>)`)
		.replace(/<linear-image>(.*?)<\/linear-image>/gs, (_, json: string) => {
			const src = imageSrc(json);
			return src ? `![image](<${src}>)` : "";
		});
}

/** The comments of one `list_comments` answer as threads, oldest first; a reply whose first comment is missing starts its own. */
function parseThreads(toolText: string): TicketComment[][] {
	const data = toolJson("Linear", "list_comments", toolText);
	const raw = isObject(data) && Array.isArray(data.comments) ? data.comments.filter(isObject) : [];
	const comments = raw
		.map(comment => ({
			id: str(comment.id) ?? "",
			parentId: str(comment.parentId) ?? null,
			author: (isObject(comment.author) ? str(comment.author.name) : undefined) ?? "Someone",
			body: linearMarkdown(str(comment.body) ?? ""),
			createdAt: str(comment.createdAt) ?? "",
		}))
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const threads = new Map<string, TicketComment[]>();
	for (const { id, parentId, ...comment } of comments) {
		const thread = parentId === null ? undefined : threads.get(parentId);
		if (thread) thread.push(comment);
		else threads.set(id, [comment]);
	}
	return [...threads.values()];
}

/** One issue in full from the texts of its `get_issue` and `list_comments` answers. */
export function parseIssueDetail(issueText: string, commentsText: string): TicketDetail {
	const raw = toolJson("Linear", "get_issue", issueText);
	const ticket = parseIssue(raw);
	if (!ticket || !isObject(raw)) throw new Error("Linear's get_issue answered without an issue");
	const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter(isObject) : [];
	return {
		...ticket,
		description: linearMarkdown(str(raw.description) ?? ""),
		createdBy: str(raw.createdBy) ?? null,
		createdAt: str(raw.createdAt) ?? ticket.updatedAt,
		attachments: attachments.flatMap(attachment => {
			const url = str(attachment.url);
			return url ? [{ title: str(attachment.title) || url, url }] : [];
		}),
		threads: parseThreads(commentsText),
	};
}

/** Reads every `list_issues` page of one query. */
async function listAll(server: McpServer, query: Record<string, unknown>): Promise<Ticket[]> {
	const found: Ticket[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const args = { assignee: "me", limit: PAGE, fields: FIELDS, ...query, ...(cursor && { cursor }) };
		const answer = parseIssues(await callMcpTool(server, "list_issues", args));
		found.push(...answer.issues);
		cursor = answer.next;
		if (!cursor) break;
	}
	return found;
}

async function queryTickets(): Promise<Ticket[]> {
	const server = await linearServer();
	const lists = await Promise.all(QUERIES.map(query => listAll(server, query)));
	return [...new Map(lists.flat().map(ticket => [ticket.id, ticket])).values()];
}

const loaded = createCache<Ticket[]>();

/** The viewer's assigned Linear issues; a failed read throws Linear's or omp's message. `fresh` skips the cache. */
export async function loadTickets(fresh: boolean): Promise<TicketsAnswer> {
	return { tickets: await loaded.get("", queryTickets, fresh) };
}

/** Issue `id` (`ENG-2368`) in full, with its description and comments; a failed read throws Linear's or omp's message. */
export async function loadTicketDetail(id: string): Promise<TicketDetail> {
	const server = await linearServer();
	const [issue, comments] = await Promise.all([callMcpTool(server, "get_issue", { id }), callMcpTool(server, "list_comments", { issueId: id, limit: PAGE })]);
	return parseIssueDetail(issue, comments);
}
