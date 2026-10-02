import { describe, expect, test } from "bun:test";
import type { InboxPullRequest } from "../src/shared";
import { inboxSections } from "./inbox-model";

describe("inbox sections", () => {
	const pr = (number: number, fields: Partial<InboxPullRequest>): InboxPullRequest => ({
		owner: "acme",
		repo: "webapp",
		number,
		title: `PR ${number}`,
		author: { login: "me", avatarUrl: null },
		reviewers: [],
		role: "author",
		state: "open",
		review: "review-required",
		checks: "passing",
		head: `me/branch-${number}`,
		stackedOn: null,
		unresolved: { count: 0, exact: true },
		updatedAt: number,
		...fields,
	});

	test("each PR lands in the first section that takes it, newest first, and empty sections drop out", () => {
		const sections = inboxSections([
			pr(1, { role: "reviewer", review: "changes-requested", author: { login: "teammate", avatarUrl: null } }),
			pr(2, { review: "changes-requested" }),
			pr(3, { review: "approved" }),
			pr(4, {}),
			pr(5, { review: "none" }),
			pr(6, { state: "draft", review: "approved" }),
			pr(7, { state: "merged", review: "approved" }),
			pr(8, { role: "reviewer", state: "merged" }),
		]);
		expect(sections.map(section => [section.title, section.pullRequests.map(p => p.number)])).toEqual([
			["Needs your review", [1]],
			["Returned to you", [2]],
			["Approved", [3]],
			["Waiting for review", [5, 4]],
			["Drafts", [6]],
			["Recently merged", [8, 7]],
		]);
		expect(inboxSections([pr(1, { state: "draft" })]).map(section => section.title)).toEqual(["Drafts"]);
	});
});
