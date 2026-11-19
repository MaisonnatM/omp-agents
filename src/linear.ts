/**
 * Reads a Linear issue for the session's Linear tab through the Linear MCP server in omp's config, with omp's sign-in to it,
 * so the dashboard keeps no Linear token or client of its own.
 */
import { createCache } from "./cache";
import { isObject, parseJson, str } from "./json";
import { callMcpTool, findMcpServers } from "./omp/mcp";
import type { LinearIssue } from "./shared/linear";

const LINEAR_HOST = "mcp.linear.app";

/** What the tab shows of an issue, asked of `get_issue` so the answer leaves out its attachments and history. */
const FIELDS = ["title", "description", "url", "status", "statusType", "priority", "assignee", "project", "team", "labels", "updatedAt"];

/** omp loads no Linear MCP server, so only adding one in Settings › MCP servers helps. */
export class NoLinearServer extends Error {}

/** `value`'s `name` when it is an object, else `value` itself when it is a string. */
const nameOf = (value: unknown): string | undefined => (isObject(value) ? str(value.name) : str(value));

/** `value` as milliseconds since the epoch when it is a date Linear wrote, else `null`. */
const timeOf = (value: unknown): number | null => {
	const time = Date.parse(str(value) ?? "");
	return Number.isFinite(time) ? time : null;
};

/**
 * Code fenced by backticks or tildes, inline code, or one of Linear's self-closing mention tags, such as
 * `<issue id="…" label="ENG-1" href="…" />`, with its attributes as the second group; code is matched only to be kept as written.
 */
const CODE_OR_MENTION = /(`{3,}|~{3,})[\s\S]*?(?:\1|$)|`[^`\n]*`|<(?:issue|pull-request|user|project|document|team|cycle|initiative|milestone)\s([^<>]*?)\/>/g;
const LABEL = /\blabel="([^"]*)"/;
const HREF = /\bhref="([^"]*)"/;

/**
 * `markdown` with Linear's mention tags outside code turned into Markdown links to what they mention, since the tab
 * renders no raw HTML and would show the tags as text.
 */
const linkMentions = (markdown: string): string =>
	markdown.replace(CODE_OR_MENTION, (match, _fence: string | undefined, attributes: string | undefined) => {
		const label = attributes === undefined ? undefined : LABEL.exec(attributes)?.[1];
		if (!label) return match;
		const href = HREF.exec(attributes ?? "")?.[1];
		return href ? `[${label}](${href})` : label;
	});

/** The issue `get_issue` answered as `value`; `null` when it lacks an id, a title, or a link. */
export function parseLinearIssue(value: unknown): LinearIssue | null {
	if (!isObject(value)) return null;
	const id = str(value.id);
	const title = str(value.title);
	const url = str(value.url);
	if (!id || title === undefined || !url) return null;
	const priority = nameOf(value.priority);
	return {
		id,
		title,
		url,
		status: str(value.status) || null,
		statusType: str(value.statusType) || null,
		priority: priority && priority !== "No priority" ? priority : null,
		assignee: nameOf(value.assignee) ?? null,
		project: nameOf(value.project) ?? null,
		team: nameOf(value.team) ?? null,
		labels: Array.isArray(value.labels) ? value.labels.flatMap(label => nameOf(label) ?? []) : [],
		description: linkMentions(str(value.description) ?? ""),
		updatedAt: timeOf(value.updatedAt),
	};
}

/** Issues by id, kept as long as pull requests' reads are, so switching tabs or sessions asks Linear once. */
const issues = createCache<LinearIssue>();

/**
 * Issue `id` as omp's Linear MCP server answers it with omp's sign-in. Throws {@link NoLinearServer} when omp's config has
 * none, and the `message` of the JSON Linear answers a failed call with, such as `Could not find referenced Issue.`.
 */
export const readLinearIssue = (id: string): Promise<LinearIssue> =>
	issues.get(id, async () => {
		const [server] = await findMcpServers(LINEAR_HOST);
		if (!server) throw new NoLinearServer("omp has no Linear MCP server. Add Linear in Settings › MCP servers.");
		const text = await callMcpTool(server, "get_issue", { id, fields: FIELDS }).catch((err: unknown) => {
			const failure = err instanceof Error ? parseJson(err.message) : undefined;
			const message = isObject(failure) ? str(failure.message) : undefined;
			throw message ? new Error(message) : err;
		});
		const parsed = parseJson(text);
		if (parsed === undefined) throw new Error(`Linear answered something other than an issue: ${text.slice(0, 200)}`);
		const issue = parseLinearIssue(parsed);
		if (!issue) throw new Error(`Linear answered no issue ${id}`);
		return issue;
	});
