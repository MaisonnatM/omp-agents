import { describe, expect, test } from "bun:test";
import { parseListIssues } from "./tickets";

const issue = (id: string, fields: Record<string, unknown> = {}) => ({
	id,
	title: `Issue ${id}`,
	url: `https://linear.app/acme/issue/${id}/issue`,
	priority: { value: 3, name: "Medium" },
	status: "In Review",
	statusType: "started",
	labels: ["Front"],
	project: "Collect feedbacks",
	team: "Engineering",
	dueDate: null,
	updatedAt: "2026-10-01T14:46:18.399Z",
	gitBranchName: `${id.toLowerCase()}-issue`,
	...fields,
});

/** A `text/event-stream` answer to `tools/call`, the way Linear's MCP server sends one. */
const sse = (result: unknown): string => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`;
const listed = (data: unknown): string => sse({ content: [{ type: "text", text: JSON.stringify(data) }] });

describe("parseListIssues", () => {
	test("maps Linear's fields, folds duplicates into canceled, and reads a missing project as none", () => {
		const { project: _, ...noProject } = issue("ENG-2", { statusType: "duplicate", status: "Duplicate", priority: { value: 0, name: "No priority" } });
		const answer = listed({ issues: [issue("ENG-1", { dueDate: "2026-10-05" }), noProject], hasNextPage: false });
		expect(parseListIssues(answer)).toEqual({
			issues: [
				{
					id: "ENG-1",
					title: "Issue ENG-1",
					url: "https://linear.app/acme/issue/ENG-1/issue",
					status: "In Review",
					statusType: "started",
					priority: 3,
					labels: ["Front"],
					project: "Collect feedbacks",
					team: "Engineering",
					dueDate: "2026-10-05",
					updatedAt: "2026-10-01T14:46:18.399Z",
					branch: "eng-1-issue",
				},
				{
					id: "ENG-2",
					title: "Issue ENG-2",
					url: "https://linear.app/acme/issue/ENG-2/issue",
					status: "Duplicate",
					statusType: "canceled",
					priority: 0,
					labels: ["Front"],
					project: null,
					team: "Engineering",
					dueDate: null,
					updatedAt: "2026-10-01T14:46:18.399Z",
					branch: "eng-2-issue",
				},
			],
			next: null,
		});
	});

	test("drops an issue without an id, a status, or a known state type, and keeps the rest", () => {
		const answer = listed({ issues: [issue("ENG-1"), issue("", {}), issue("ENG-3", { status: undefined }), issue("ENG-4", { statusType: "archived" }), "ENG-5"] });
		expect(parseListIssues(answer).issues.map(({ id }) => id)).toEqual(["ENG-1"]);
	});

	test("names the next page's cursor only while Linear has one", () => {
		expect(parseListIssues(listed({ issues: [], hasNextPage: true, cursor: "abc" })).next).toBe("abc");
		expect(parseListIssues(listed({ issues: [], hasNextPage: false, cursor: "abc" })).next).toBeNull();
	});

	test("reads a plain JSON answer too", () => {
		const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ issues: [issue("ENG-1")] }) }] } });
		expect(parseListIssues(body).issues.map(({ id }) => id)).toEqual(["ENG-1"]);
	});

	test("throws Linear's message for a JSON-RPC error and for a failed tool call", () => {
		expect(() => parseListIssues(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid arguments" } })}\n`)).toThrow("Invalid arguments");
		expect(() => parseListIssues(sse({ isError: true, content: [{ type: "text", text: "Team not found" }] }))).toThrow("Team not found");
		expect(() => parseListIssues(sse({ isError: true, content: [{ type: "text", text: JSON.stringify({ message: "Rate limited" }) }] }))).toThrow("Rate limited");
	});
});
