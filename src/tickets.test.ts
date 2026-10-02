import { describe, expect, test } from "bun:test";
import { linearMarkdown, parseIssueDetail, parseIssues } from "./tickets";

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

describe("parseIssues", () => {
	test("maps Linear's fields, folds duplicates into canceled, and reads a missing project as none", () => {
		const { project: _, ...noProject } = issue("ENG-2", { statusType: "duplicate", status: "Duplicate", priority: { value: 0, name: "No priority" } });
		const answer = listed({ issues: [issue("ENG-1", { dueDate: "2026-10-05" }), noProject], hasNextPage: false });
		expect(parseIssues(answer)).toEqual({
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
		expect(parseIssues(answer).issues.map(({ id }) => id)).toEqual(["ENG-1"]);
	});

	test("names the next page's cursor only while Linear has one", () => {
		expect(parseIssues(listed({ issues: [], hasNextPage: true, cursor: "abc" })).next).toBe("abc");
		expect(parseIssues(listed({ issues: [], hasNextPage: false, cursor: "abc" })).next).toBeNull();
	});

	test("throws when the tool answers text that is not an issue list", () => {
		expect(() => parseIssues("Team not found")).toThrow("something other than JSON: Team not found");
		expect(() => parseIssues(JSON.stringify({ items: [] }))).toThrow("without issues");
	});
});

describe("linearMarkdown", () => {
	test("turns Linear's issue mentions into links and its images into image links, and drops an image without a source", () => {
		const text = [
			'Fixed in <issue id="2cfd" href="https://linear.app/acme/issue/ENG-2305/count">ENG-2305</issue>; see',
			'<linear-image>{"type":"image","attrs":{"src":"https://uploads.linear.app/a/b?signature=x"}}</linear-image>',
			"<linear-image>{}</linear-image>",
		].join("\n");
		expect(linearMarkdown(text)).toBe("Fixed in [ENG-2305](<https://linear.app/acme/issue/ENG-2305/count>); see\n![image](<https://uploads.linear.app/a/b?signature=x>)\n");
	});
});

describe("parseIssueDetail", () => {
	const comment = (id: string, createdAt: string, parentId: string | null, body = id) => ({ id, body, createdAt, parentId, author: { id: "u", name: "Ada" } });

	test("threads the comments oldest first, a reply under its first comment, and keeps the issue's links", () => {
		const issueText = JSON.stringify(
			issue("ENG-1", {
				description: "Do it",
				createdBy: "Grace",
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
		const detail = parseIssueDetail(issueText, commentsText);
		expect(detail.description).toBe("Do it");
		expect(detail.createdBy).toBe("Grace");
		expect(detail.attachments).toEqual([
			{ title: "feat: do it", url: "https://github.com/acme/web/pull/1" },
			{ title: "https://example.com", url: "https://example.com" },
		]);
		expect(detail.threads.map(thread => thread.map(({ body }) => body))).toEqual([["root", "reply"], ["later"], ["orphan"]]);
		expect(detail.threads[0]![0]!.author).toBe("Ada");
	});

	test("throws when get_issue answers no issue", () => {
		expect(() => parseIssueDetail("Issue not found", JSON.stringify({ comments: [] }))).toThrow("get_issue answered something other than JSON");
		expect(() => parseIssueDetail(JSON.stringify({ title: "No id" }), JSON.stringify({ comments: [] }))).toThrow("without an issue");
	});
});
