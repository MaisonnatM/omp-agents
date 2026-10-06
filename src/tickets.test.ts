import { describe, expect, test } from "bun:test";
import { uploadAddress } from "./linear-uploads";
import { linearMarkdown, parseIssueDetail, parseIssues, parsePage, parseTicketOptions } from "./tickets";

const signed = (path: string): string => `https://uploads.linear.app${path}?signature=x`;
const proxied = (path: string): string => `/api/ticket/media?issue=ENG-1&path=${encodeURIComponent(path)}`;
const media = (url: string): string => uploadAddress("ENG-1", url);

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

const listed = (data: unknown): string => JSON.stringify(data);

const colors = new Map([["ENG", new Map([["Front", "#f2c94c"]])]]);

describe("parseIssues", () => {
	test("maps Linear's fields, colors labels as their team does, folds duplicates into canceled, and reads a missing project as none", () => {
		const { project: _, ...noProject } = issue("ENG-2", { statusType: "duplicate", status: "Duplicate", priority: { value: 0, name: "No priority" }, labels: ["Front", "Retired"] });
		expect(parseIssues([issue("ENG-1", { dueDate: "2026-10-05" }), noProject, issue("OPS-1")], colors)).toEqual([
			{
				id: "ENG-1",
				title: "Issue ENG-1",
				url: "https://linear.app/acme/issue/ENG-1/issue",
				status: "In Review",
				statusType: "started",
				priority: 3,
				labels: [{ name: "Front", color: "#f2c94c" }],
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
				labels: [
					{ name: "Front", color: "#f2c94c" },
					{ name: "Retired", color: "" },
				],
				project: null,
				team: "Engineering",
				dueDate: null,
				updatedAt: "2026-10-01T14:46:18.399Z",
				branch: "eng-2-issue",
			},
			expect.objectContaining({ id: "OPS-1", labels: [{ name: "Front", color: "" }] }),
		]);
	});

	test("drops an issue without an id, a status, or a known state type, and keeps the rest once", () => {
		const issues = [issue("ENG-1"), issue("", {}), issue("ENG-3", { status: undefined }), issue("ENG-4", { statusType: "archived" }), issue("ENG-1")];
		expect(parseIssues(issues, colors).map(({ id }) => id)).toEqual(["ENG-1"]);
	});
});

describe("parsePage", () => {
	test("names the next page's cursor only while Linear has one", () => {
		expect(parsePage("list_issues", "issues", listed({ issues: [], hasNextPage: true, cursor: "abc" })).next).toBe("abc");
		expect(parsePage("list_issues", "issues", listed({ issues: [], hasNextPage: false, cursor: "abc" })).next).toBeNull();
	});

	test("throws when the tool answers text that is not an issue list", () => {
		expect(() => parsePage("list_issues", "issues", "Team not found")).toThrow("something other than JSON: Team not found");
		expect(() => parsePage("list_issues", "issues", JSON.stringify({ items: [] }))).toThrow("without issues");
	});
});

describe("linearMarkdown", () => {
	test("turns Linear's issue mentions into links and its images into image links, and drops an image without a source", () => {
		const text = [
			'Fixed in <issue id="2cfd" href="https://linear.app/acme/issue/ENG-2305/count">ENG-2305</issue>; see',
			`<linear-image>{"type":"image","attrs":{"src":"${signed("/a/b")}"}}</linear-image>`,
			"<linear-image>{}</linear-image>",
		].join("\n");
		expect(linearMarkdown(text, media)).toBe(`Fixed in [ENG-2305](<https://linear.app/acme/issue/ENG-2305/count>); see\n![image](<${proxied("/a/b")}>)\n`);
	});

	test("plays a video embed, links another embedded file, and loads every Linear upload through the server", () => {
		const text = [
			"Recording:",
			`<linear-embed node-type="video">{"uploadState":"finished","uploadId":null,"src":"${signed("/org/v")}"}</linear-embed>`,
			`<linear-embed node-type="file">{"src":"${signed("/org/f")}"}</linear-embed>`,
			`[log](<${signed("/org/log")}>) and [docs](<https://example.com/a?b=c>)`,
		].join("\n");
		expect(linearMarkdown(text, media)).toBe(
			[
				"Recording:\n\n",
				`<video controls preload="metadata" src="${proxied("/org/v")}"></video>\n\n`,
				`[Attached file](<${proxied("/org/f")}>)`,
				`[log](<${proxied("/org/log")}>) and [docs](<https://example.com/a?b=c>)`,
			].join("\n"),
		);
	});
});

describe("parseIssueDetail", () => {
	const comment = (id: string, createdAt: string, parentId: string | null, body = id) => ({ id, body, createdAt, parentId, author: { id: "u", name: "Ada" } });

	test("threads the comments oldest first, a reply under its first comment, and keeps the issue's links", () => {
		const issueText = JSON.stringify(
			issue("ENG-1", {
				description: "Do it",
				createdBy: "Grace",
				assignee: "Ada Lovelace",
				assigneeId: "u-1",
				teamId: "t-1",
				createdAt: "2026-09-01T00:00:00.000Z",
				attachments: [{ id: "a", title: "feat: do it", url: "https://github.com/acme/web/pull/1" }, { id: "b", title: "", url: "https://example.com" }, { id: "c" }],
			}),
		);
		// Linear lists comments newest first.
		const commentsText = JSON.stringify({
			comments: [
				comment("reply", "2026-09-03T00:00:00.000Z", "root"),
				comment("orphan", "2026-09-04T00:00:00.000Z", "gone"),
				comment("later", "2026-09-02T12:00:00.000Z", null),
				comment("root", "2026-09-02T00:00:00.000Z", null),
			],
		});
		const detail = parseIssueDetail(issueText, commentsText, colors, media);
		expect(detail.labels).toEqual([{ name: "Front", color: "#f2c94c" }]);
		expect(detail.description).toBe("Do it");
		expect(detail.createdBy).toBe("Grace");
		expect(detail.assignee).toEqual({ id: "u-1", name: "Ada Lovelace" });
		expect(detail.teamId).toBe("t-1");
		expect(detail.attachments).toEqual([
			{ title: "feat: do it", url: "https://github.com/acme/web/pull/1" },
			{ title: "https://example.com", url: "https://example.com" },
		]);
		expect(detail.threads.map(thread => thread.map(({ body }) => body))).toEqual([["root", "reply"], ["later"], ["orphan"]]);
		expect(detail.threads[0]![0]!.author).toBe("Ada");
	});

	test("reads an issue without an assignee as unassigned", () => {
		const detail = parseIssueDetail(JSON.stringify(issue("ENG-1", { assignee: null, assigneeId: null })), JSON.stringify({ comments: [] }), colors, media);
		expect(detail.assignee).toBeNull();
	});

	test("throws when get_issue answers no issue", () => {
		expect(() => parseIssueDetail("Issue not found", JSON.stringify({ comments: [] }), colors, media)).toThrow("get_issue answered something other than JSON");
		expect(() => parseIssueDetail(JSON.stringify({ title: "No id" }), JSON.stringify({ comments: [] }), colors, media)).toThrow("without an issue");
	});
});

describe("parseTicketOptions", () => {
	test("orders states as Linear's workflow does, keeps only active people and live labels, and sorts the rest by name", () => {
		const statuses = JSON.stringify([
			{ id: "s-done", type: "completed", name: "Done" },
			{ id: "s-dup", type: "duplicate", name: "Duplicate" },
			{ id: "s-todo", type: "unstarted", name: "Todo" },
			{ id: "s-back", type: "backlog", name: "Backlog" },
			{ id: "s-odd", type: "archived", name: "Odd" },
		]);
		const options = parseTicketOptions(
			statuses,
			[{ id: "u-2", name: "Zoe", isActive: true }, { id: "u-3", name: "Gone", isActive: false }, { id: "u-1", name: "Ada" }],
			[{ id: "l-1", name: "Front", color: "#f00", archivedAt: null }, { id: "l-2", name: "Old", archivedAt: "2026-01-01" }, { id: "l-3", name: "Bug" }],
			[{ id: "P-2", name: "Widget" }, { id: "P-1", name: "Analytics" }, { name: "No id" }],
		);
		expect(options).toEqual({
			statuses: [
				{ id: "s-back", name: "Backlog", type: "backlog" },
				{ id: "s-todo", name: "Todo", type: "unstarted" },
				{ id: "s-done", name: "Done", type: "completed" },
				{ id: "s-dup", name: "Duplicate", type: "canceled" },
			],
			users: [
				{ id: "u-1", name: "Ada" },
				{ id: "u-2", name: "Zoe" },
			],
			labels: [
				{ id: "l-3", name: "Bug", color: "" },
				{ id: "l-1", name: "Front", color: "#f00" },
			],
			projects: [
				{ id: "P-1", name: "Analytics" },
				{ id: "P-2", name: "Widget" },
			],
		});
	});
});
