import { describe, expect, test } from "bun:test";
import { parseInboxAnswer, parseRemote } from "./inbox";

const repo = { owner: "acme", repo: "webapp" };
const me = { login: "me", avatarUrl: "https://avatars.example/me" };

const node = (number: number, fields: Record<string, unknown>) => ({
	number,
	title: `PR ${number}`,
	isDraft: false,
	state: "OPEN",
	reviewDecision: "REVIEW_REQUIRED",
	headRefName: `me/branch-${number}`,
	baseRefName: "main",
	updatedAt: "2026-10-01T10:00:00Z",
	mergedAt: null,
	author: me,
	repository: { defaultBranchRef: { name: "main" } },
	commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
	...fields,
});

describe("parseRemote", () => {
	test("reads GitHub's ssh and https remotes and refuses other hosts", () => {
		expect(parseRemote("git@github.com:acme/web.app.git\n")).toEqual({ owner: "acme", repo: "web.app" });
		expect(parseRemote("https://github.com/acme/webapp")).toEqual({ owner: "acme", repo: "webapp" });
		expect(parseRemote("ssh://git@github.com/acme/webapp.git")).toEqual({ owner: "acme", repo: "webapp" });
		expect(parseRemote("https://gitlab.com/acme/webapp.git")).toBeNull();
	});
});

describe("parseInboxAnswer", () => {
	test("maps GitHub's states, keeps a PR once, and names the base of a stacked PR", () => {
		const prs = parseInboxAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, { baseRefName: "me/branch-0", reviewDecision: "APPROVED", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } }),
							node(2, { isDraft: true, reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }),
						],
					},
					reviewing: { nodes: [node(3, { author: { login: "teammate", avatarUrl: null }, reviewDecision: "CHANGES_REQUESTED" }), node(1, {})] },
					merged: { nodes: [node(4, { state: "MERGED", mergedAt: "2026-09-30T08:00:00Z" })] },
				},
			},
			repo,
		);
		expect(prs).toEqual([
			{
				...repo,
				number: 1,
				title: "PR 1",
				author: me,
				reviewers: [],
				role: "author",
				state: "open",
				review: "approved",
				checks: "failing",
				head: "me/branch-1",
				stackedOn: "me/branch-0",
				updatedAt: Date.parse("2026-10-01T10:00:00Z"),
			},
			{
				...repo,
				number: 2,
				title: "PR 2",
				author: me,
				reviewers: [],
				role: "author",
				state: "draft",
				review: "none",
				checks: "none",
				head: "me/branch-2",
				stackedOn: null,
				updatedAt: Date.parse("2026-10-01T10:00:00Z"),
			},
			{
				...repo,
				number: 3,
				title: "PR 3",
				author: { login: "teammate", avatarUrl: null },
				reviewers: [],
				role: "reviewer",
				state: "open",
				review: "changes-requested",
				checks: "passing",
				head: "me/branch-3",
				stackedOn: null,
				updatedAt: Date.parse("2026-10-01T10:00:00Z"),
			},
			{
				...repo,
				number: 4,
				title: "PR 4",
				author: me,
				reviewers: [],
				role: "author",
				state: "merged",
				review: "review-required",
				checks: "passing",
				head: "me/branch-4",
				stackedOn: null,
				updatedAt: Date.parse("2026-09-30T08:00:00Z"),
			},
		]);
	});

	test("lists each reviewer once: a pending request over an older review, and neither the author nor a dismissed review", () => {
		const [pr] = parseInboxAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, {
								reviewRequests: {
									nodes: [
										{ requestedReviewer: { login: "bsaintot", avatarUrl: "https://avatars.example/bsaintot" } },
										{ requestedReviewer: { slug: "frontend", avatarUrl: "https://avatars.example/frontend" } },
									],
								},
								latestReviews: {
									nodes: [
										{ state: "COMMENTED", author: { login: "bsaintot", avatarUrl: "https://avatars.example/bsaintot" } },
										{ state: "APPROVED", author: { login: "lencshu", avatarUrl: "https://avatars.example/lencshu" } },
										{ state: "COMMENTED", author: me },
										{ state: "DISMISSED", author: { login: "cursor", avatarUrl: null } },
									],
								},
							}),
						],
					},
				},
			},
			repo,
		);
		expect(pr?.reviewers).toEqual([
			{ login: "bsaintot", avatarUrl: "https://avatars.example/bsaintot", state: "requested" },
			{ login: "frontend", avatarUrl: "https://avatars.example/frontend", state: "requested" },
			{ login: "lencshu", avatarUrl: "https://avatars.example/lencshu", state: "approved" },
		]);
	});

	test("an answer without data reports GitHub's errors", () => {
		expect(() => parseInboxAnswer({ errors: [{ message: "Could not resolve to a Repository" }] }, repo)).toThrow("Could not resolve to a Repository");
	});
});
