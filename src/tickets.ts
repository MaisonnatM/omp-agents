/**
 * The tickets page's issues: the viewer's assigned Linear issues, one issue in full for the main content, what its pickers
 * offer, and the changes they make, read and written through Linear's MCP server with the OAuth credential that omp
 * keeps for it. That token works on the MCP endpoint only, not on Linear's GraphQL API.
 */
import { createCache } from "./cache";
import { isObject, num, oneOf, str } from "./json";
import { linearServer } from "./linear";
import { proxyUploads, rememberUploads, serveUpload } from "./linear-uploads";
import { callMcpTool, type McpServer, toolJson } from "./omp/mcp";
import {
	TICKET_ID,
	TICKET_PRIORITIES,
	TICKET_STATUS_TYPES,
	type Ticket,
	type TicketChoice,
	type TicketComment,
	type TicketDetail,
	type TicketDraft,
	type TicketEdit,
	type TicketLabel,
	type TicketOptions,
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

const isPriority = oneOf(TICKET_PRIORITIES);
const isStatusType = oneOf(TICKET_STATUS_TYPES);

/** Each label's color by name, under the key of the team it belongs to (`ENG`); a team's labels include the workspace's. */
export type LabelColors = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The key of the team an issue belongs to, which prefixes its identifier: `ENG` for `ENG-2368`. */
const teamKey = (id: string): string => id.slice(0, id.lastIndexOf("-"));

/** A state type as the page reads it: Linear's `duplicate` is a kind of canceled. */
const statusTypeOf = (type: string | undefined): TicketStatusType | undefined => {
	if (type === "duplicate") return "canceled";
	return isStatusType(type) ? type : undefined;
};

function parseIssue(raw: unknown, colors: LabelColors): Ticket | null {
	if (!isObject(raw)) return null;
	const id = str(raw.id);
	const title = str(raw.title);
	const url = str(raw.url);
	const status = str(raw.status);
	const statusType = statusTypeOf(str(raw.statusType));
	const updatedAt = str(raw.updatedAt);
	if (!id || title === undefined || !url || !status || !statusType || !updatedAt) return null;
	const priority = num(isObject(raw.priority) ? raw.priority.value : raw.priority);
	const teamColors = colors.get(teamKey(id));
	return {
		id,
		title,
		url,
		status,
		statusType,
		priority: isPriority(priority) ? priority : 0,
		labels: Array.isArray(raw.labels) ? raw.labels.filter(label => typeof label === "string").map(name => ({ name, color: teamColors?.get(name) ?? "" })) : [],
		project: str(raw.project) ?? null,
		team: str(raw.team) ?? "",
		dueDate: str(raw.dueDate) ?? null,
		updatedAt,
		branch: str(raw.gitBranchName) ?? "",
	};
}

/** The objects under `key` in one page of `tool`'s answer, and the cursor of the next page, `null` on the last. */
export function parsePage(tool: string, key: string, toolText: string): { items: Record<string, unknown>[]; next: string | null } {
	const data = toolJson("Linear", tool, toolText);
	const items = isObject(data) ? data[key] : undefined;
	if (!isObject(data) || !Array.isArray(items)) throw new Error(`Linear's ${tool} answered without ${key}`);
	return { items: items.filter(isObject), next: data.hasNextPage === true ? (str(data.cursor) ?? null) : null };
}

const pageOf = (tool: string, key: string) => (toolText: string) => parsePage(tool, key, toolText);

/** The tickets among `list_issues` answers' issues, each once, their labels colored from `colors`. */
export function parseIssues(issues: Record<string, unknown>[], colors: LabelColors): Ticket[] {
	const tickets = issues.map(raw => parseIssue(raw, colors)).filter(ticket => ticket !== null);
	return [...new Map(tickets.map(ticket => [ticket.id, ticket])).values()];
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

/**
 * Linear's markdown with its own tags made plain markdown: an issue mention becomes a link to the issue, an image an
 * image link, a video a `<video>` player, and another embedded file a link. Each of Linear's uploads loads from this
 * server's media route for `issue`.
 */
export function linearMarkdown(text: string, issue: string): string {
	return proxyUploads(
		issue,
		text
			.replace(/<issue\b[^>]*\bhref="([^"]+)"[^>]*>(.*?)<\/issue>/gs, (_, href: string, label: string) => `[${label}](<${href}>)`)
			.replace(/<linear-image>(.*?)<\/linear-image>/gs, (_, json: string) => {
				const src = tagSrc(json);
				return src ? `![image](<${src}>)` : "";
			})
			.replace(/<linear-embed\b([^>]*)>(.*?)<\/linear-embed>/gs, (_, attrs: string, json: string) => {
				const src = tagSrc(json);
				if (!src) return "";
				return /\bnode-type="video"/.test(attrs) ? `\n\n<video controls preload="metadata" src="${src}"></video>\n\n` : `[Attached file](<${src}>)`;
			}),
	);
}

/** The comments of one `list_comments` answer as threads, oldest first; a reply whose first comment is missing starts its own. */
function parseThreads(toolText: string, issue: string): TicketComment[][] {
	const data = toolJson("Linear", "list_comments", toolText);
	const raw = isObject(data) && Array.isArray(data.comments) ? data.comments.filter(isObject) : [];
	const comments = raw
		.map(comment => ({
			id: str(comment.id) ?? "",
			parentId: str(comment.parentId) ?? null,
			author: (isObject(comment.author) ? str(comment.author.name) : undefined) ?? "Someone",
			body: linearMarkdown(str(comment.body) ?? "", issue),
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
export function parseIssueDetail(issueText: string, commentsText: string, colors: LabelColors): TicketDetail {
	const raw = toolJson("Linear", "get_issue", issueText);
	const ticket = parseIssue(raw, colors);
	if (!ticket || !isObject(raw)) throw new Error("Linear's get_issue answered without an issue");
	const teamId = str(raw.teamId);
	if (!teamId) throw new Error(`Linear's get_issue answered ${ticket.id} without its team's id`);
	const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter(isObject) : [];
	const assigneeId = str(raw.assigneeId);
	const assignee = str(raw.assignee);
	return {
		...ticket,
		description: linearMarkdown(str(raw.description) ?? "", ticket.id),
		createdBy: str(raw.createdBy) ?? null,
		createdAt: str(raw.createdAt) ?? ticket.updatedAt,
		assignee: assigneeId && assignee ? { id: assigneeId, name: assignee } : null,
		teamId,
		attachments: attachments.flatMap(attachment => {
			const url = str(attachment.url);
			return url ? [{ title: str(attachment.title) || url, url }] : [];
		}),
		threads: parseThreads(commentsText, ticket.id),
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

/** Live labels with their colors from `list_issue_labels` answers. */
function parseLabels(labels: Record<string, unknown>[]): TicketLabel[] {
	return labels
		.filter(label => !label.archivedAt)
		.flatMap(raw => {
			const name = str(raw.name);
			return name ? [{ name, color: str(raw.color) ?? "" }] : [];
		});
}

const teamColors = createCache<ReadonlyMap<string, string>>(5 * 60_000);

/** The label colors of the teams of issues `ids`, which Linear's issue tools leave out. `fresh` skips the cache. */
async function loadLabelColors(server: McpServer, ids: string[], fresh = false): Promise<LabelColors> {
	const teams = [...new Set(ids.map(teamKey))];
	const colors = await Promise.all(
		teams.map(team =>
			teamColors.get(
				team,
				async () => {
					const labels = await allPages(server, "list_issue_labels", { team, limit: PAGE }, pageOf("list_issue_labels", "labels"));
					return new Map(parseLabels(labels).map(({ name, color }) => [name, color]));
				},
				fresh,
			),
		),
	);
	return new Map(teams.map((team, index) => [team, colors[index]!]));
}

async function queryTickets(fresh: boolean): Promise<Ticket[]> {
	const server = await linearServer();
	const lists = await Promise.all(QUERIES.map(query => allPages(server, "list_issues", { assignee: "me", limit: PAGE, fields: FIELDS, ...query }, pageOf("list_issues", "issues"))));
	const issues = lists.flat();
	return parseIssues(issues, await loadLabelColors(server, issues.map(issue => str(issue.id) ?? ""), fresh));
}

const loaded = createCache<Ticket[]>();

/** The viewer's assigned Linear issues; a failed read throws Linear's or omp's message. `fresh` skips the cache. */
export async function loadTickets(fresh: boolean): Promise<TicketsAnswer> {
	return { tickets: await loaded.get("", () => queryTickets(fresh), fresh) };
}

/** The raw `get_issue` and `list_comments` answers for issue `id`. */
const readIssueTexts = (server: McpServer, id: string): Promise<[string, string]> =>
	Promise.all([callMcpTool(server, "get_issue", { id }), callMcpTool(server, "list_comments", { issueId: id, limit: PAGE })]);

/** Issue `id` (`ENG-2368`) in full, with its description and comments; a failed read throws Linear's or omp's message. */
export async function loadTicketDetail(id: string): Promise<TicketDetail> {
	const server = await linearServer();
	const [[issue, comments], colors] = await Promise.all([readIssueTexts(server, id), loadLabelColors(server, [id])]);
	rememberUploads(issue, comments);
	return parseIssueDetail(issue, comments, colors);
}

/** The files of one issue whose addresses expired share one read of the issue, which signs them all anew. */
const resigned = createCache<void>(10_000);

/** Upload `path` that issue `id` embeds, as `serveUpload` answers it. */
export const loadTicketMedia = (id: string, path: string, range: string | null, signal: AbortSignal): Promise<Response | null> =>
	serveUpload(path, range, signal, () =>
		resigned.get(id, async () => {
			rememberUploads(...(await readIssueTexts(await linearServer(), id)));
		}),
	);

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
		statuses: statuses.filter(isObject).flatMap(raw => {
			const status = str(raw.name);
			const statusType = statusTypeOf(str(raw.type));
			return status && statusType ? [{ status, statusType }] : [];
		}),
		users: users
			.filter(user => user.isActive !== false)
			.map(choiceOf)
			.filter(user => user !== null)
			.sort(byName),
		labels: parseLabels(labels).sort((a, b) => a.name.localeCompare(b.name)),
		projects: projects
			.flatMap(project => str(project.name) ?? [])
			.sort((a, b) => a.localeCompare(b)),
	};
}

async function queryOptions(team: string): Promise<TicketOptions> {
	const server = await linearServer();
	const [statuses, users, labels, projects] = await Promise.all([
		callMcpTool(server, "list_issue_statuses", { team }),
		allPages(server, "list_users", { limit: PAGE }, pageOf("list_users", "users")),
		allPages(server, "list_issue_labels", { team, limit: PAGE }, pageOf("list_issue_labels", "labels")),
		allPages(server, "list_projects", { team, limit: PROJECT_PAGE }, pageOf("list_projects", "projects")),
	]);
	return parseTicketOptions(statuses, users, labels, projects);
}

const options = createCache<TicketOptions>(5 * 60_000);

/** What the field pickers offer for an issue of team `team`, Linear's id of it. */
export const loadTicketOptions = (team: string): Promise<TicketOptions> => options.get(team, () => queryOptions(team));

/** Applies `edit` in Linear and answers the issue as it is after it; the tickets list is read anew on its next request. */
export async function saveTicket(edit: TicketEdit): Promise<TicketDetail> {
	await callMcpTool(await linearServer(), "save_issue", { ...edit });
	loaded.drop("");
	return loadTicketDetail(edit.id);
}

const teams = createCache<TicketChoice[]>(60 * 60_000);

/** The workspace's Linear teams, by name, for the team a new issue goes in. */
export const loadTeams = (): Promise<TicketChoice[]> => teams.get("", queryTeams);

async function queryTeams(): Promise<TicketChoice[]> {
	const server = await linearServer();
	const raw = await allPages(server, "list_teams", { limit: PAGE }, pageOf("list_teams", "teams"));
	return raw
		.map(choiceOf)
		.filter(team => team !== null)
		.sort(byName);
}

/** Opens `draft` in Linear, assigned to the viewer, and answers its identifier; the tickets list is read anew on its next request. */
export async function createTicket({ title, description, team }: TicketDraft): Promise<{ identifier: string }> {
	const text = await callMcpTool(await linearServer(), "save_issue", { title, description, team, assignee: "me" });
	loaded.drop("");
	const issue = toolJson("Linear", "save_issue", text);
	const identifier = isObject(issue) ? [issue.identifier, issue.id].find(value => typeof value === "string" && TICKET_ID.test(value)) : undefined;
	if (typeof identifier !== "string") throw new Error("Linear's save_issue answered without the new issue's identifier");
	return { identifier };
}
