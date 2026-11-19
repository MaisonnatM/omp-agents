import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NoLinearServer, parseLinearIssue, readLinearIssue } from "./linear";
import * as mcp from "./omp/mcp";

/** `get_issue`'s answer as Linear's MCP server gives it for the fields the tab asks for. */
const answer = {
	id: "ENG-3025",
	title: "Move our verification loop to the Claude Code model",
	url: "https://linear.app/yampa/issue/ENG-3025/move-our-verification-loop",
	status: "Backlog",
	statusType: "backlog",
	priority: { value: 3, name: "Medium" },
	assignee: "Maxence Maisonnat",
	project: { id: "p1", name: "Verification" },
	team: "Engineering",
	labels: [{ id: "l1", name: "Agents" }, { id: "l2", name: "CI" }],
	description:
		'Follows <issue id="0b1" label="ENG-3026" href="https://linear.app/yampa/issue/ENG-3026/x" /> and <pull-request id="7" label="#7449" href="https://github.com/yampa-ai/yampa/pull/7449" />; see <user id="u1" label="Maxence" />.',
	updatedAt: "2026-11-18T14:00:00.000Z",
};

describe("parseLinearIssue", () => {
	test("reads names from objects or strings and turns Linear's mention tags into links", () => {
		expect(parseLinearIssue(answer)).toEqual({
			id: "ENG-3025",
			title: "Move our verification loop to the Claude Code model",
			url: "https://linear.app/yampa/issue/ENG-3025/move-our-verification-loop",
			status: "Backlog",
			statusType: "backlog",
			priority: "Medium",
			assignee: "Maxence Maisonnat",
			project: "Verification",
			team: "Engineering",
			labels: ["Agents", "CI"],
			description: "Follows [ENG-3026](https://linear.app/yampa/issue/ENG-3026/x) and [#7449](https://github.com/yampa-ai/yampa/pull/7449); see Maxence.",
			updatedAt: Date.parse("2026-11-18T14:00:00.000Z"),
		});
	});

	test("leaves tags inside code, and tags Linear does not mention with, as written", () => {
		const tag = '<issue id="0b1" label="ENG-3026" href="https://linear.app/yampa/issue/ENG-3026/x" />';
		const description = `Run \`${tag}\`, then:\n\n\`\`\`html\n${tag}\n<br label="x" />\n\`\`\`\n\n<widget label="Chart" />`;
		expect(parseLinearIssue({ ...answer, description })?.description).toBe(description);
	});

	test("an issue without a priority, assignee, status, date, or description shows none", () => {
		const issue = parseLinearIssue({ id: "ENG-1", title: "Bare", url: "https://linear.app/yampa/issue/ENG-1", priority: { value: 0, name: "No priority" } });
		expect(issue).toMatchObject({ status: null, statusType: null, priority: null, assignee: null, project: null, labels: [], description: "", updatedAt: null });
	});

	test("an answer without an id, a title, or a link is no issue", () => {
		expect(parseLinearIssue({ ...answer, url: undefined })).toBeNull();
		expect(parseLinearIssue({ ...answer, id: "" })).toBeNull();
		expect(parseLinearIssue("Issue not found")).toBeNull();
	});
});

describe("readLinearIssue", () => {
	const server: mcp.McpServer = { name: "linear", url: "https://mcp.linear.app/mcp", credentialId: "mcp-oauth:linear", config: { type: "http", url: "https://mcp.linear.app/mcp" } };

	afterEach(() => mock.restore());

	test("asks the Linear server omp loads for the issue", async () => {
		spyOn(mcp, "findMcpServers").mockResolvedValue([server]);
		const call = spyOn(mcp, "callMcpTool").mockResolvedValue(JSON.stringify(answer));
		expect(await readLinearIssue("ENG-3025")).toMatchObject({ id: "ENG-3025", labels: ["Agents", "CI"] });
		expect(call).toHaveBeenCalledWith(server, "get_issue", expect.objectContaining({ id: "ENG-3025" }));
	});

	test("a failed read says the message of the JSON Linear answers it with", async () => {
		spyOn(mcp, "findMcpServers").mockResolvedValue([server]);
		spyOn(mcp, "callMcpTool").mockRejectedValue(new Error(JSON.stringify({ message: "Could not find referenced Issue." })));
		await expect(readLinearIssue("ENG-999999")).rejects.toThrow(new Error("Could not find referenced Issue."));
	});

	test("without a Linear server in omp's config, the read says to add one", async () => {
		spyOn(mcp, "findMcpServers").mockResolvedValue([]);
		await expect(readLinearIssue("ENG-1")).rejects.toBeInstanceOf(NoLinearServer);
	});
});
