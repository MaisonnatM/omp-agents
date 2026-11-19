import { describe, expect, test } from "bun:test";
import { parseLinearIssue } from "./linear";

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
	labels: [{ name: "Agents" }, "CI"],
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
			updatedAt: "2026-11-18T14:00:00.000Z",
		});
	});

	test("an issue without a priority, assignee, or description shows none", () => {
		const issue = parseLinearIssue({ id: "ENG-1", title: "Bare", url: "https://linear.app/yampa/issue/ENG-1", priority: { value: 0, name: "No priority" } });
		expect(issue).toMatchObject({ priority: null, assignee: null, project: null, labels: [], description: "" });
	});

	test("an answer without an id, a title, or a link is no issue", () => {
		expect(parseLinearIssue({ ...answer, url: undefined })).toBeNull();
		expect(parseLinearIssue({ ...answer, id: "" })).toBeNull();
		expect(parseLinearIssue("Issue not found")).toBeNull();
	});
});
