import { describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDetailAnswer, parseInboxAnswer, parseRemote, repoOf } from "./inbox";
import { runChecked } from "./proc";

const repo = { owner: "acme", repo: "webapp" };
const me = { login: "me", avatarUrl: "https://avatars.example/me" };

const node = (number: number, fields: Record<string, unknown>) => ({
	number,
	title: `PR ${number}`,
	isDraft: false,
	state: "OPEN",
	reviewDecision: "REVIEW_REQUIRED",
	mergeable: "MERGEABLE",
	headRefName: `me/branch-${number}`,
	baseRefName: "main",
	updatedAt: "2026-10-01T10:00:00Z",
	mergedAt: null,
	author: me,
	repository: { defaultBranchRef: { name: "main" } },
	commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
	reviewThreads: { totalCount: 0, nodes: [] },
	...fields,
});

describe("parseRemote", () => {
	test("reads GitHub's ssh and https remotes and refuses other hosts", () => {
		expect(parseRemote("git@github.com:acme/web.app.git\n")).toEqual({ owner: "acme", repo: "web.app" });
		expect(parseRemote("https://github.com/acme/webapp")).toEqual({ owner: "acme", repo: "webapp" });
		expect(parseRemote("ssh://git@github.com/acme/webapp.git")).toEqual({ owner: "acme", repo: "webapp" });
		expect(parseRemote("github.com:acme/webapp.git")).toEqual({ owner: "acme", repo: "webapp" });
		expect(parseRemote("https://gitlab.com/acme/webapp.git")).toBeNull();
	});
});

test("a workspace without a GitHub origin is retried after its negative cache expires", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	try {
		await runChecked(["git", "init", "-q", dir]);
		setSystemTime(new Date("2026-10-02T12:00:00Z"));
		expect(await repoOf(dir)).toBeNull();
		await runChecked(["git", "-C", dir, "remote", "add", "origin", "git@github.com:acme/webapp.git"]);
		expect(await repoOf(dir)).toBeNull();
		setSystemTime(new Date("2026-10-02T12:10:01Z"));
		expect(await repoOf(dir)).toEqual({ owner: "acme", repo: "webapp" });
	} finally {
		setSystemTime();
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("parseInboxAnswer", () => {
	test("maps GitHub's states, keeps a PR once, and names the base of a stacked PR", () => {
		const prs = parseInboxAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, {
								baseRefName: "me/branch-0",
								additions: 587,
								deletions: 125,
								reviewDecision: "APPROVED",
								mergeable: "CONFLICTING",
								commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
							}),
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
				conflicts: true,
				additions: 587,
				deletions: 125,
				head: "me/branch-1",
				stackedOn: "me/branch-0",
				unresolved: { count: 0, exact: true },
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
				conflicts: false,
				additions: 0,
				deletions: 0,
				head: "me/branch-2",
				stackedOn: null,
				unresolved: { count: 0, exact: true },
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
				conflicts: false,
				additions: 0,
				deletions: 0,
				head: "me/branch-3",
				stackedOn: null,
				unresolved: { count: 0, exact: true },
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
				conflicts: false,
				additions: 0,
				deletions: 0,
				head: "me/branch-4",
				stackedOn: null,
				unresolved: { count: 0, exact: true },
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

	test("a change request waits on review again once every reviewer who asked for changes is asked for a new review", () => {
		const lencshu = { login: "lencshu", avatarUrl: null };
		const bsaintot = { login: "bsaintot", avatarUrl: null };
		const changes = (...authors: (typeof lencshu)[]) => ({ nodes: authors.map(author => ({ state: "CHANGES_REQUESTED", author })) });
		const requested = (...reviewers: (typeof lencshu)[]) => ({ nodes: reviewers.map(requestedReviewer => ({ requestedReviewer })) });
		const prs = parseInboxAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, { reviewDecision: "CHANGES_REQUESTED", latestReviews: changes(lencshu) }),
							node(2, { reviewDecision: "CHANGES_REQUESTED", latestReviews: changes(lencshu), reviewRequests: requested(lencshu) }),
							node(3, { reviewDecision: "CHANGES_REQUESTED", latestReviews: changes(lencshu, bsaintot), reviewRequests: requested(lencshu) }),
						],
					},
				},
			},
			repo,
		);
		expect(prs.map(pr => [pr.number, pr.review])).toEqual([
			[1, "changes-requested"],
			[2, "review-required"],
			[3, "changes-requested"],
		]);
	});

	test("counts unresolved review threads, as a floor when GitHub lists only the first page", () => {
		const threads = (resolved: boolean[], totalCount = resolved.length) => ({ totalCount, nodes: resolved.map(isResolved => ({ isResolved })) });
		const prs = parseInboxAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, {}),
							node(2, { reviewThreads: threads([true, false, true, false, false]) }),
							node(3, { reviewThreads: threads(Array(100).fill(false), 130) }),
							node(4, { reviewThreads: threads(Array(100).fill(true), 101) }),
						],
					},
				},
			},
			repo,
		);
		expect(prs.map(pr => [pr.number, pr.unresolved])).toEqual([
			[1, { count: 0, exact: true }],
			[2, { count: 3, exact: true }],
			[3, { count: 100, exact: false }],
			[4, { count: 0, exact: false }],
		]);
	});

	test("an answer without data reports GitHub's errors", () => {
		expect(() => parseInboxAnswer({ errors: [{ message: "Could not resolve to a Repository" }] }, repo)).toThrow("Could not resolve to a Repository");
	});
});

describe("parseDetailAnswer", () => {
	const pr = { ...repo, number: 7 };
	const teammate = { login: "teammate", avatarUrl: null };
	const answer = (fields: Record<string, unknown>) => ({
		data: {
			repository: {
				pullRequest: {
					number: 7,
					title: "PR 7",
					body: "Fixes it",
					isDraft: false,
					state: "OPEN",
					reviewDecision: null,
					headRefName: "me/branch-7",
					baseRefName: "main",
					createdAt: "2026-09-30T08:00:00Z",
					additions: 3,
					deletions: 1,
					changedFiles: 1,
					author: me,
					...fields,
				},
			},
		},
	});

	test("lists failing checks first, an unfinished run as pending, and a commit status by its context, beside GitHub's rollup", () => {
		const { checkRuns, checks, unresolved } = parseDetailAnswer(
			answer({
				commits: {
					nodes: [
						{
							commit: {
								statusCheckRollup: {
									state: "FAILURE",
									contexts: {
										nodes: [
											{ name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci.example/lint" },
											{ name: "docs", status: "COMPLETED", conclusion: "SKIPPED", detailsUrl: null },
											{ name: "build", status: "IN_PROGRESS", conclusion: null, detailsUrl: null },
											{ context: "deploy", state: "ERROR", targetUrl: "https://ci.example/deploy" },
											{ name: "test", status: "COMPLETED", conclusion: "TIMED_OUT", detailsUrl: null },
										],
									},
								},
							},
						},
					],
				},
			}),
			pr,
		);
		expect(checks).toBe("failing");
		expect(unresolved).toEqual({ count: 0, exact: true });
		expect(checkRuns).toEqual([
			{ name: "deploy", state: "failing", url: "https://ci.example/deploy" },
			{ name: "test", state: "failing", url: null },
			{ name: "build", state: "pending", url: null },
			{ name: "lint", state: "passing", url: "https://ci.example/lint" },
			{ name: "docs", state: "skipped", url: null },
		]);
	});

	test("merges comments and reviews by time, leaves out bare comment reviews and resolved threads", () => {
		const detail = parseDetailAnswer(
			answer({
				state: "CLOSED",
				comments: { nodes: [{ author: teammate, body: "Why?", createdAt: "2026-09-30T10:00:00Z", url: "https://github.example/c1" }] },
				reviews: {
					nodes: [
						{ state: "APPROVED", submittedAt: "2026-09-30T11:00:00Z", author: teammate, body: "", url: null },
						{ state: "COMMENTED", submittedAt: "2026-09-30T09:00:00Z", author: teammate, body: "", url: null },
						{ state: "PENDING", submittedAt: null, author: me, body: "draft", url: null },
						{ state: "CHANGES_REQUESTED", submittedAt: "2026-09-30T09:30:00Z", author: teammate, body: "Not yet", url: null },
					],
				},
				reviewThreads: {
					nodes: [
						{ isResolved: true, path: "a.ts", line: 1, comments: { nodes: [] } },
						{ isResolved: false, path: "b.ts", line: null, comments: { nodes: [{ author: null, body: "Gone line", createdAt: "2026-09-30T09:00:00Z", url: null }] } },
					],
				},
			}),
			pr,
		);
		expect(detail.state).toBe("closed");
		expect(detail.conversation.map(event => [event.review, event.body])).toEqual([
			["changes-requested", "Not yet"],
			[null, "Why?"],
			["approved", ""],
		]);
		expect(detail.threads).toEqual([
			{ path: "b.ts", line: null, comments: [{ author: { login: "ghost", avatarUrl: null }, body: "Gone line", at: Date.parse("2026-09-30T09:00:00Z"), url: null }] },
		]);
	});

	test("reports conflicts only on an open or draft PR that GitHub finds CONFLICTING", () => {
		const conflicts = (fields: Record<string, unknown>) => parseDetailAnswer(answer(fields), pr).conflicts;
		expect([
			conflicts({ mergeable: "CONFLICTING" }),
			conflicts({ mergeable: "CONFLICTING", isDraft: true }),
			conflicts({ mergeable: "UNKNOWN" }),
			conflicts({ mergeable: "CONFLICTING", state: "CLOSED" }),
			conflicts({ mergeable: "CONFLICTING", state: "MERGED" }),
		]).toEqual([true, true, false, false, false]);
	});

	test("keeps the pull request's own commits and drops the trunk commits its branch took in", () => {
		const commit = (sha: string, owners: number[]) => ({
			commit: { abbreviatedOid: sha, messageHeadline: sha, committedDate: "2026-09-30T09:00:00Z", author: { name: "Me", user: me }, associatedPullRequests: { nodes: owners.map(number => ({ number })) } },
		});
		const { commits } = parseDetailAnswer(answer({ history: { nodes: [commit("trunk", [5]), commit("mine", [7, 8]), commit("unpushed", [])] } }), pr);
		expect(commits.map(({ sha }) => sha)).toEqual(["mine", "unpushed"]);
	});

	test("a repository without that pull request is an error, not an empty one", () => {
		expect(() => parseDetailAnswer({ data: { repository: { pullRequest: null } } }, pr)).toThrow("GitHub has no pull request acme/webapp#7");
	});
});
