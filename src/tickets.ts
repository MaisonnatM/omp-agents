/**
 * The tickets page's issues: the viewer's assigned Linear issues, one issue in full for its sheet, what its pickers
 * offer, and the changes they make, read and written through Linear's MCP server with the OAuth credential that omp
 * keeps for it. That token works on the MCP endpoint only, not on Linear's GraphQL API.
 */
import { createCache } from "./cache";
import { isObject, num, str } from "./json";
import { linearServer } from "./linear";
import { serveUpload, uploadAddress } from "./linear-uploads";
import { callMcpTool, type McpServer, toolJson } from "./omp/mcp";
import {
	TICKET_STATUS_TYPES,
	type Ticket,
	type TicketChoice,
	type TicketComment,
	type TicketDetail,
	type TicketEdit,
	type TicketOptions,
	type TicketPriority,
	type TicketsAnswer,
	type TicketStatusType,
} from "./shared";

/** Linear's page size cap for `list_issues`, `list_users`, and `list_issue_labels`. */
const PAGE = 250;
/** `list_projects` pages at most this many. */
const PROJECT_PAGE = 50;
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

/** Linear's workflow order, which its status menu follows. */
const WORKFLOW_ORDER: TicketStatusType[] = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

const isPriority = (value: number | undefined): value is TicketPriority => value === 0 || value === 1 || value === 2 || value === 3 || value === 4;

/** A state type as the page reads it: Linear's `duplicate` is a kind of canceled. */
const statusTypeOf = (type: string | undefined): TicketStatusType | undefined => (type === "duplicate" ? "canceled" : TICKET_STATUS_TYPES.find(known => known === type));

function parseIssue(raw: unknown): Ticket | null {
	if (!isObject(raw)) return null;
	const id = str(raw.id);
	const title = str(raw.title);
	const url = str(raw.url);
	const status = str(raw.status);
	const statusType = statusTypeOf(str(raw.statusType));
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

/** The objects under `key` in one page of `tool`'s answer, and the cursor of the next page, `null` on the last. */
function parsePage(tool: string, key: string, toolText: string): { items: Record<string, unknown>[]; next: string | null } {
	const data = toolJson("Linear", tool, toolText);
	const items = isObject(data) ? data[key] : undefined;
	if (!isObject(data) || !Array.isArray(items)) throw new Error(`Linear's ${tool} answered without ${key}`);
	return { items: items.filter(isObject), next: data.hasNextPage === true ? (str(data.cursor) ?? null) : null };
}

/** The tickets in one `list_issues` answer's text and the cursor of the next page, `null` on the last. */
export function parseIssues(toolText: string): { items: Ticket[]; next: string | null } {
	const { items, next } = parsePage("list_issues", "issues", toolText);
	return { items: items.map(parseIssue).filter(issue => issue !== null), next };
}

/** The `src` in the JSON of a `<linear-image>` (under `attrs`) or a `<linear-embed>` tag. */
function tagSrc(json: string): string | undefined {
	try {
		const tag: unknown = JSON.parse(json);
		if (!isObject(tag)) return undefined;
		return str(isObject(tag.attrs) ? tag.attrs.src : tag.src);
	} catch {
		return undefined;
	}
}

const UPLOAD_URL = /https:\/\/uploads\.linear\.app\/[^\s"'<>()[\]\\]+/g;

/**
 * Linear's markdown with its own tags made plain markdown: an issue mention becomes a link to the issue, an image an
 * image link, a video a `<video>` player, and another embedded file a link. `media` gives the address the page loads
 * each of Linear's uploads from.
 */
export function linearMarkdown(text: string, media: (url: string) => string): string {
	return text
		.replace(/<issue\b[^>]*\bhref="([^"]+)"[^>]*>(.*?)<\/issue>/gs, (_, href: string, label: string) => `[${label}](<${href}>)`)
		.replace(/<linear-image>(.*?)<\/linear-image>/gs, (_, json: string) => {
			const src = tagSrc(json);
			return src ? `![image](<${src}>)` : "";
		})
		.replace(/<linear-embed\b([^>]*)>(.*?)<\/linear-embed>/gs, (_, attrs: string, json: string) => {
			const src = tagSrc(json);
			if (!src) return "";
			return /\bnode-type="video"/.test(attrs) ? `\n\n<video controls preload="metadata" src="${src}"></video>\n\n` : `[Attached file](<${src}>)`;
		})
		.replace(UPLOAD_URL, url => media(url));
}

/** The comments of one `list_comments` answer as threads, oldest first; a reply whose first comment is missing starts its own. */
function parseThreads(toolText: string, media: (url: string) => string): TicketComment[][] {
	const data = toolJson("Linear", "list_comments", toolText);
	const raw = isObject(data) && Array.isArray(data.comments) ? data.comments.filter(isObject) : [];
	const comments = raw
		.map(comment => ({
			id: str(comment.id) ?? "",
			parentId: str(comment.parentId) ?? null,
			author: (isObject(comment.author) ? str(comment.author.name) : undefined) ?? "Someone",
			body: linearMarkdown(str(comment.body) ?? "", media),
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

/** One issue in full from the texts of its `get_issue` and `list_comments` answers; `media` as for `linearMarkdown`. */
export function parseIssueDetail(issueText: string, commentsText: string, media: (url: string) => string): TicketDetail {
	const raw = toolJson("Linear", "get_issue", issueText);
	const ticket = parseIssue(raw);
	if (!ticket || !isObject(raw)) throw new Error("Linear's get_issue answered without an issue");
	const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter(isObject) : [];
	const assigneeId = str(raw.assigneeId);
	const assignee = str(raw.assignee);
	return {
		...ticket,
		description: linearMarkdown(str(raw.description) ?? "", media),
		createdBy: str(raw.createdBy) ?? null,
		createdAt: str(raw.createdAt) ?? ticket.updatedAt,
		assignee: assigneeId && assignee ? { id: assigneeId, name: assignee } : null,
		teamId: str(raw.teamId) ?? "",
		attachments: attachments.flatMap(attachment => {
			const url = str(attachment.url);
			return url ? [{ title: str(attachment.title) || url, url }] : [];
		}),
		threads: parseThreads(commentsText, media),
	};
}

/** Every page of `tool`'s answer to `args`, each read by `parse`. */
async function allPages<T>(server: McpServer, tool: string, args: Record<string, unknown>, parse: (toolText: string) => { items: T[]; next: string | null }): Promise<T[]> {
	const found: T[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const answer = parse(await callMcpTool(server, tool, { ...args, ...(cursor && { cursor }) }));
		found.push(...answer.items);
		cursor = answer.next;
		if (!cursor) break;
	}
	return found;
}

async function queryTickets(): Promise<Ticket[]> {
	const server = await linearServer();
	const lists = await Promise.all(QUERIES.map(query => allPages(server, "list_issues", { assignee: "me", limit: PAGE, fields: FIELDS, ...query }, parseIssues)));
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
	return parseIssueDetail(issue, comments, url => uploadAddress(id, url));
}

/** The files of one issue whose addresses expired share one read of the issue, which signs them all anew. */
const resigned = createCache<TicketDetail>(10_000);

/** Upload `path` that issue `id` embeds, as `serveUpload` answers it. */
export const loadTicketMedia = (id: string, path: string, range: string | null, signal: AbortSignal): Promise<Response | null> =>
	serveUpload(path, range, signal, () => resigned.get(id, () => loadTicketDetail(id)));

function choiceOf(raw: Record<string, unknown>): TicketChoice | null {
	const id = str(raw.id);
	const name = str(raw.name);
	return id && name ? { id, name } : null;
}

const byName = (a: TicketChoice, b: TicketChoice): number => a.name.localeCompare(b.name);

/** The states, people, labels, and projects the pickers offer, from the answers of Linear's list tools. */
export function parseTicketOptions(statusesText: string, users: Record<string, unknown>[], labels: Record<string, unknown>[], projects: Record<string, unknown>[]): TicketOptions {
	const statuses = toolJson("Linear", "list_issue_statuses", statusesText);
	if (!Array.isArray(statuses)) throw new Error("Linear's list_issue_statuses answered without statuses");
	return {
		statuses: statuses
			.filter(isObject)
			.flatMap(raw => {
				const choice = choiceOf(raw);
				const type = statusTypeOf(str(raw.type));
				return choice && type ? [{ ...choice, type }] : [];
			})
			.sort((a, b) => WORKFLOW_ORDER.indexOf(a.type) - WORKFLOW_ORDER.indexOf(b.type)),
		users: users
			.filter(user => user.isActive !== false)
			.map(choiceOf)
			.filter(user => user !== null)
			.sort(byName),
		labels: labels
			.filter(label => !label.archivedAt)
			.flatMap(raw => {
				const choice = choiceOf(raw);
				return choice ? [{ ...choice, color: str(raw.color) ?? "" }] : [];
			})
			.sort(byName),
		projects: projects
			.map(choiceOf)
			.filter(project => project !== null)
			.sort(byName),
	};
}

async function queryOptions(team: string): Promise<TicketOptions> {
	const server = await linearServer();
	const page = (tool: string, key: string) => (toolText: string) => parsePage(tool, key, toolText);
	const [statuses, users, labels, projects] = await Promise.all([
		callMcpTool(server, "list_issue_statuses", { team }),
		allPages(server, "list_users", { limit: PAGE }, page("list_users", "users")),
		allPages(server, "list_issue_labels", { team, limit: PAGE }, page("list_issue_labels", "labels")),
		allPages(server, "list_projects", { team, limit: PROJECT_PAGE }, page("list_projects", "projects")),
	]);
	return parseTicketOptions(statuses, users, labels, projects);
}

const options = createCache<TicketOptions>(5 * 60_000);

/** What the sheet's pickers offer for an issue of team `team`, Linear's id of it. */
export const loadTicketOptions = (team: string): Promise<TicketOptions> => options.get(team, () => queryOptions(team));

/** Applies `edit` in Linear and answers the issue as it is after it; the tickets list is read anew on its next request. */
export async function saveTicket(edit: TicketEdit): Promise<TicketDetail> {
	await callMcpTool(await linearServer(), "save_issue", { ...edit });
	loaded.drop("");
	return loadTicketDetail(edit.id);
}
