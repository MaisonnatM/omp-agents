/**
 * Reads a Linear issue for the session's Linear tab through the Linear MCP server in omp's config, with omp's sign-in to it,
 * so the dashboard keeps no Linear token or client of its own.
 */
import { isObject, str } from "./json";
import { callMcpTool, findMcpServers } from "./omp/mcp";
import type { LinearIssue } from "./shared/linear";

const LINEAR_HOST = "mcp.linear.app";

/** What the tab shows of an issue, asked of `get_issue` so the answer leaves out its attachments and history. */
const FIELDS = ["title", "description", "url", "status", "statusType", "priority", "assignee", "project", "team", "labels", "updatedAt"];

/** `value`'s `name` when it is an object, else `value` itself when it is a string. */
const nameOf = (value: unknown): string | undefined => (isObject(value) ? str(value.name) : str(value));

/** An attribute of a Linear mention tag, such as the `label` of `<issue id="…" label="ENG-1" href="…" />`. */
const attribute = (attributes: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];

/**
 * `markdown` with Linear's mention tags, such as `<issue … />` and `<pull-request … />`, turned into Markdown links to what they
 * mention, since the tab renders no raw HTML and would show the tags as text.
 */
const linkMentions = (markdown: string): string =>
	markdown.replace(/<[a-z][\w-]*\s([^<>]*?)\/>/g, (tag, attributes: string) => {
		const label = attribute(attributes, "label");
		const href = attribute(attributes, "href");
		if (!label) return tag;
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
		status: str(value.status) ?? "",
		statusType: str(value.statusType) ?? "",
		priority: priority && priority !== "No priority" ? priority : null,
		assignee: nameOf(value.assignee) ?? null,
		project: nameOf(value.project) ?? null,
		team: nameOf(value.team) ?? null,
		labels: Array.isArray(value.labels) ? value.labels.flatMap(label => nameOf(label) ?? []) : [],
		description: linkMentions(str(value.description) ?? ""),
		updatedAt: str(value.updatedAt) ?? "",
	};
}

/** Issue `id` as omp's Linear MCP server answers it with omp's sign-in; throws when omp's config has no Linear server or the read fails. */
export async function readLinearIssue(id: string): Promise<LinearIssue> {
	const [server] = await findMcpServers(LINEAR_HOST);
	if (!server) throw new Error("omp has no Linear MCP server. Add Linear in Settings › MCP servers.");
	const text = await callMcpTool(server, "get_issue", { id, fields: FIELDS });
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`Linear answered something other than an issue: ${text.slice(0, 200)}`);
	}
	const issue = parseLinearIssue(parsed);
	if (!issue) throw new Error(`Linear answered no issue ${id}`);
	return issue;
}
