import { describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchPullRequest, loadPullRequests, parseDetailAnswer, parseListAnswer, parseMergedAnswer, parseRemote, readBehindBy, repoOf } from "./pull-requests";
import { runChecked } from "./proc";
import * as proc from "./proc";

const repo = { owner: "acme", repo: "webapp" };
const me = { login: "me", avatarUrl: "https://avatars.example/me" };


test("base freshness reads GitHub's behind count and leaves unavailable comparisons unknown", async () => {
	const read = spyOn(proc, "runJson").mockResolvedValueOnce({ behind_by: 12 }).mockRejectedValueOnce(new Error("Not Found"));
	try {
		expect(await readBehindBy({ ...repo, number: 7 }, "release/main", "abc")).toBe(12);
		expect(read.mock.calls[0]?.[0]).toEqual(["gh", "api", "repos/acme/webapp/compare/release%2Fmain...abc?per_page=1"]);
		expect(await readBehindBy({ ...repo, number: 8 }, "main", "deleted")).toBeNull();
	} finally {
		read.mockRestore();
	}
});
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

describe("parseMergedAnswer", () => {
	test("keeps each branch whose newest pull request merged, by its alias", () => {
		const answer = {
			data: {
				repository: {
					b0: { nodes: [{ number: 7, state: "MERGED", mergedAt: "2026-10-01T10:00:00Z" }] },
					b1: { nodes: [{ number: 8, state: "OPEN", mergedAt: null }] },
					b2: { nodes: [] },
					b3: { nodes: [{ number: 9, state: "CLOSED", mergedAt: null }] },
				},
			},
		};
		expect(parseMergedAnswer(answer, ["landed", "open", "none", "closed"])).toEqual(new Map([["landed", { number: 7, mergedAt: Date.parse("2026-10-01T10:00:00Z") }]]));
	});
});

test("branchPullRequest asks GitHub's REST API for the branch's pull requests and names the newest open or merged one, and none when it heads none", async () => {
	const pr = (number: number, state: string, merged_at: string | null = null) => ({ number, state, merged_at });
	const read = spyOn(proc, "runJson")
		.mockResolvedValueOnce([pr(12, "closed"), pr(10, "open"), pr(11, "closed", "2026-10-01T00:00:00Z")])
		.mockResolvedValueOnce([pr(13, "closed")]);
	try {
		expect(await branchPullRequest(repo, "me/feature")).toEqual({ owner: "acme", repo: "webapp", number: 11 });
		expect(read.mock.calls[0]?.[0]).toEqual(["gh", "api", "repos/acme/webapp/pulls?head=acme%3Ame%2Ffeature&state=all&per_page=10"]);
		expect(await branchPullRequest(repo, "me/abandoned")).toBeNull();
	} finally {
		read.mockRestore();
	}
});

test("a workspace without a GitHub origin is retried after its negative cache expires", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-pull-requests-"));
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

test("a workspace removed after its origin was read leaves the pull request list, as does one never found", async () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-pull-requests-"));
	await runChecked(["git", "init", "-q", dir]);
	await runChecked(["git", "-C", dir, "remote", "add", "origin", "git@github.com:acme/webapp.git"]);
	expect(await repoOf(dir)).toEqual({ owner: "acme", repo: "webapp" });
	rmSync(dir, { recursive: true, force: true });
	expect(await loadPullRequests([dir, `${dir}-never`], false)).toEqual({ repos: [], unmatched: [] });
});

describe("parseListAnswer", () => {
	test("maps GitHub's states, keeps a PR once, names the base of a stacked PR, and counts a merged PR as never behind", () => {
		const prs = parseListAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, {
								baseRefName: "me/branch-0",
								viewerCanUpdateBranch: true,
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
					merged: { nodes: [node(4, { state: "MERGED", mergedAt: "2026-09-30T08:00:00Z", viewerCanUpdateBranch: true })] },
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
				base: "me/branch-0",
				stackedOn: "me/branch-0",
				behind: true,
				unresolved: { count: 0, exact: true, bots: 0 },
				conversations: 0,
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
				base: "main",
				stackedOn: null,
				behind: false,
				unresolved: { count: 0, exact: true, bots: 0 },
				conversations: 0,
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
				base: "main",
				stackedOn: null,
				behind: false,
				unresolved: { count: 0, exact: true, bots: 0 },
				conversations: 0,
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
				base: "main",
				stackedOn: null,
				behind: false,
				unresolved: { count: 0, exact: true, bots: 0 },
				conversations: 0,
				updatedAt: Date.parse("2026-09-30T08:00:00Z"),
			},
		]);
	});

	test("lists each reviewer once: a pending request over an older review, and neither the author nor a dismissed review", () => {
		const [pr] = parseListAnswer(
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
		const prs = parseListAnswer(
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
		const prs = parseListAnswer(
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
			[1, { count: 0, exact: true, bots: 0 }],
			[2, { count: 3, exact: true, bots: 0 }],
			[3, { count: 100, exact: false, bots: 0 }],
			[4, { count: 0, exact: false, bots: 0 }],
		]);
	});

	test("counts the open threads a bot started, by GitHub's type or a `[bot]` login, leaving out resolved ones and threads without a first comment", () => {
		const thread = (isResolved: boolean, author?: Record<string, unknown>) => ({ isResolved, comments: { nodes: author ? [{ author }] : [] } });
		const bugbot = { __typename: "Bot", login: "cursor" };
		const [pr] = parseListAnswer(
			{
				data: {
					authored: {
						nodes: [
							node(1, {
								reviewThreads: {
									totalCount: 5,
									nodes: [thread(false, bugbot), thread(false, { __typename: "User", login: "github-actions[bot]" }), thread(false, { __typename: "User", login: "amy" }), thread(true, bugbot), thread(false)],
								},
							}),
						],
					},
				},
			},
			repo,
		);
		expect(pr?.unresolved).toEqual({ count: 4, exact: true, bots: 2 });
	});

	test("leaves out a pull request that an open search still returns after it closed", () => {
		const prs = parseListAnswer({ data: { authored: { nodes: [node(1, { state: "CLOSED" }), node(2, {})] }, reviewing: { nodes: [node(3, { state: "CLOSED" })] } } }, repo);
		expect(prs.map(pr => [pr.number, pr.state])).toEqual([[2, "open"]]);
	});

	test("an answer without data reports GitHub's errors", () => {
		expect(() => parseListAnswer({ errors: [{ message: "Could not resolve to a Repository" }] }, repo)).toThrow("Could not resolve to a Repository");
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

	test("keeps merge and close times separately, without replacing the last update", () => {
		const detail = parseDetailAnswer(answer({
			state: "MERGED",
			mergedAt: "2026-09-30T12:00:00Z",
			closedAt: "2026-09-30T12:00:00Z",
			updatedAt: "2026-09-30T12:05:00Z",
		}), pr);
		expect({ state: detail.state, mergedAt: detail.mergedAt, closedAt: detail.closedAt, updatedAt: detail.updatedAt }).toEqual({
			state: "merged",
			mergedAt: 1790769600000,
			closedAt: 1790769600000,
			updatedAt: 1790769900000,
		});
		const closed = parseDetailAnswer(answer({ state: "CLOSED", mergedAt: null, closedAt: "2026-09-30T11:00:00Z" }), pr);
		expect({ state: closed.state, mergedAt: closed.mergedAt, closedAt: closed.closedAt }).toEqual({ state: "closed", mergedAt: null, closedAt: 1790766000000 });
	});

	test("returns null for absent, null, non-string, and invalid lifecycle times", () => {
		for (const fields of [{}, { mergedAt: null, closedAt: null }, { mergedAt: "not a date", closedAt: "" }, { mergedAt: 1790769600000, closedAt: false }]) {
			const detail = parseDetailAnswer(answer(fields), pr);
			expect({ mergedAt: detail.mergedAt, closedAt: detail.closedAt }).toEqual({ mergedAt: null, closedAt: null });
		}
	});

	test("keeps nonempty reactions of GitHub's known contents on comments, reviews, and thread replies with viewer participation", () => {
		const detail = parseDetailAnswer(answer({
			comments: { nodes: [{
				author: teammate, body: "Thanks", createdAt: "2026-09-30T09:00:00Z", url: "https://github.example/c1",
				reactionGroups: [
					{ content: "THUMBS_UP", viewerHasReacted: true, users: { totalCount: 3 } },
					{ content: "HEART", viewerHasReacted: false, users: { totalCount: 2 } },
					{ content: "EYES", viewerHasReacted: false, users: { totalCount: 0 } },
					{ content: "ROCKET", viewerHasReacted: false, users: {} },
					{ content: "SPARKLES", viewerHasReacted: true, users: { totalCount: 5 } },
					null,
					{ users: { totalCount: 1 } },
				],
			}] },
			reviews: { nodes: [{
				state: "APPROVED", author: teammate, body: "", submittedAt: "2026-09-30T10:00:00Z", url: null,
				reactionGroups: [{ content: "HOORAY", viewerHasReacted: false, users: { totalCount: 1 } }],
			}] },
			reviewThreads: { nodes: [{
				id: "PRRT_reactions", path: "a.ts", line: 2, isResolved: false,
				comments: { nodes: [
					{ author: me, body: "Fixed", createdAt: "2026-09-30T11:00:00Z", url: null, reactionGroups: [{ content: "ROCKET", viewerHasReacted: true, users: { totalCount: 4 } }] },
					{ author: teammate, body: "Looks good", createdAt: "2026-09-30T12:00:00Z", url: null },
				] },
			}] },
		}), pr);
		expect(detail.conversation).toEqual([
			{
				author: { login: "teammate", avatarUrl: null }, body: "Thanks", at: 1790758800000, url: "https://github.example/c1", review: null,
				reactions: [{ content: "THUMBS_UP", count: 3, viewerHasReacted: true }, { content: "HEART", count: 2, viewerHasReacted: false }],
			},
			{
				author: { login: "teammate", avatarUrl: null }, body: "", at: 1790762400000, url: null, review: "approved",
				reactions: [{ content: "HOORAY", count: 1, viewerHasReacted: false }],
			},
		]);
		expect(detail.threads[0]?.comments).toEqual([
			{ author: { login: "me", avatarUrl: "https://avatars.example/me" }, body: "Fixed", at: 1790766000000, url: null, reactions: [{ content: "ROCKET", count: 4, viewerHasReacted: true }] },
			{ author: { login: "teammate", avatarUrl: null }, body: "Looks good", at: 1790769600000, url: null, reactions: [] },
		]);
	});

	test("reads dismissal from the review of the oldest comment it keeps, the thread's root, and keeps the full reply count", () => {
		const detail = parseDetailAnswer(answer({
			reviewThreads: { nodes: [
				{
					id: "PRRT_dropped_root", path: "a.ts", line: null, isResolved: true, isOutdated: true,
					comments: { totalCount: 24, nodes: [
						{ createdAt: "invalid", pullRequestReview: { state: "DISMISSED" } },
						{ author: teammate, body: "Reply", createdAt: "2026-09-30T09:00:00Z", pullRequestReview: { state: "APPROVED" } },
					] },
				},
				{
					id: "PRRT_dismissed", path: "b.ts", line: 2, isResolved: false, isOutdated: false,
					comments: { nodes: [
						{ author: me, body: "Reply", createdAt: "2026-09-30T11:00:00Z", pullRequestReview: { state: "APPROVED" } },
						{ author: teammate, body: "Root", createdAt: "2026-09-30T10:00:00Z", pullRequestReview: { state: "DISMISSED" } },
					] },
				},
				{
					id: "PRRT_current", path: "c.ts", line: 3, isResolved: false,
					comments: { nodes: [
						{ author: teammate, body: "Current", createdAt: "2026-09-30T10:00:00Z", pullRequestReview: { state: "CHANGES_REQUESTED" } },
						{ author: me, body: "Reply", createdAt: "2026-09-30T11:00:00Z", pullRequestReview: { state: "DISMISSED" } },
					] },
				},
				{ id: "PRRT_empty", path: "d.ts", line: 4, isResolved: false, comments: { nodes: [] } },
			] },
		}), pr);
		expect(detail.threads.map(({ id, outdated, dismissed, commentCount, comments }) => ({ id, outdated, dismissed, commentCount, bodies: comments.map(comment => comment.body) }))).toEqual([
			{ id: "PRRT_dropped_root", outdated: true, dismissed: false, commentCount: 24, bodies: ["Reply"] },
			{ id: "PRRT_dismissed", outdated: false, dismissed: true, commentCount: 2, bodies: ["Root", "Reply"] },
			{ id: "PRRT_current", outdated: false, dismissed: false, commentCount: 2, bodies: ["Current", "Reply"] },
			{ id: "PRRT_empty", outdated: false, dismissed: false, commentCount: 0, bodies: [] },
		]);
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
		expect(unresolved).toEqual({ count: 0, exact: true, bots: 0 });
		expect(checkRuns).toEqual([
			{ name: "deploy", state: "failing", url: "https://ci.example/deploy" },
			{ name: "test", state: "failing", url: null },
			{ name: "build", state: "pending", url: null },
			{ name: "lint", state: "passing", url: "https://ci.example/lint" },
			{ name: "docs", state: "skipped", url: null },
		]);
	});

	test("merges comments and reviews by time, leaves out bare comment reviews, and keeps resolved threads beside what the viewer may do to each", () => {
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
						{ id: "PRRT_a", isResolved: true, viewerCanReply: true, viewerCanResolve: false, viewerCanUnresolve: true, path: "a.ts", line: 1, comments: { nodes: [] } },
						{
							id: "PRRT_b",
							isResolved: false,
							viewerCanReply: false,
							viewerCanResolve: false,
							viewerCanUnresolve: true,
							path: "b.ts",
							line: null,
							comments: { nodes: [{ author: null, body: "Gone line", createdAt: "2026-09-30T09:00:00Z", url: null }] },
						},
						{ isResolved: false, path: "c.ts", line: 2, comments: { nodes: [] } },
					],
				},
			}),
			pr,
		);
		expect(detail.state).toBe("closed");
		expect(detail.unresolved).toEqual({ count: 1, exact: true, bots: 0 });
		expect(detail.conversation.map(event => [event.review, event.body])).toEqual([
			["changes-requested", "Not yet"],
			[null, "Why?"],
			["approved", ""],
		]);
		expect(detail.threads).toEqual([
			{ id: "PRRT_a", path: "a.ts", line: 1, resolved: true, outdated: false, dismissed: false, can: { reply: true, resolve: false, unresolve: true }, commentCount: 0, comments: [] },
			{
				id: "PRRT_b",
				path: "b.ts",
				line: null,
				resolved: false,
				outdated: false,
				dismissed: false,
				can: { reply: false, resolve: false, unresolve: true },
				commentCount: 1,
				comments: [{ author: { login: "ghost", avatarUrl: null }, body: "Gone line", at: 1790758800000, url: null, reactions: [] }],
			},
		]);
	});

	test("counts the unresolved threads among those it lists, as a floor when GitHub lists only the first page", () => {
		const thread = (id: string, isResolved: boolean) => ({ id, isResolved, path: "a.ts", line: 1, comments: { nodes: [] } });
		const unresolved = (reviewThreads: unknown) => parseDetailAnswer(answer({ reviewThreads }), pr).unresolved;
		expect(unresolved({ totalCount: 3, nodes: [thread("PRRT_a", false), thread("PRRT_b", true), thread("PRRT_c", false)] })).toEqual({ count: 2, exact: true, bots: 0 });
		expect(unresolved({ totalCount: 150, nodes: [thread("PRRT_a", false), thread("PRRT_b", true)] })).toEqual({ count: 1, exact: false, bots: 0 });
	});

	test("counts the open threads whose oldest comment a bot wrote, whatever order GitHub lists the comments in", () => {
		const comment = (login: string, typename: string, createdAt: string) => ({ author: { __typename: typename, login }, body: "", createdAt, url: null });
		const thread = (id: string, isResolved: boolean, comments: unknown[]) => ({ id, isResolved, path: "a.ts", line: 1, comments: { nodes: comments } });
		const { unresolved } = parseDetailAnswer(
			answer({
				reviewThreads: {
					totalCount: 3,
					nodes: [
						thread("PRRT_a", false, [comment("amy", "User", "2026-10-01T11:00:00Z"), comment("coderabbitai", "Bot", "2026-10-01T10:00:00Z")]),
						thread("PRRT_b", false, [comment("amy", "User", "2026-10-01T10:00:00Z"), comment("coderabbitai", "Bot", "2026-10-01T11:00:00Z")]),
						thread("PRRT_c", true, [comment("coderabbitai", "Bot", "2026-10-01T10:00:00Z")]),
					],
				},
			}),
			pr,
		);
		expect(unresolved).toEqual({ count: 2, exact: true, bots: 1 });
	});

	test("lets you comment unless the repository is archived, or the conversation is locked and you cannot write to the repository", () => {
		const canComment = (repository: Record<string, unknown>, fields: Record<string, unknown> = {}) =>
			parseDetailAnswer({ data: { repository: { ...answer(fields).data.repository, ...repository } } }, pr).canComment;
		expect([
			canComment({ viewerPermission: "READ" }),
			canComment({ viewerPermission: "READ" }, { locked: true }),
			canComment({ viewerPermission: "TRIAGE" }, { locked: true }),
			canComment({ viewerPermission: "WRITE" }, { locked: true }),
			canComment({ viewerPermission: "ADMIN", isArchived: true }),
		]).toEqual([true, false, false, true, false]);
	});

	test("knows whether you opened it", () => {
		expect([parseDetailAnswer(answer({ viewerDidAuthor: true }), pr).byViewer, parseDetailAnswer(answer({}), pr).byViewer]).toEqual([true, false]);
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

	test("keeps a full commit id for the diff scope separately from its abbreviated label", () => {
		const oid = "a".repeat(40);
		const detail = parseDetailAnswer(answer({ history: { nodes: [{ commit: {
			oid, abbreviatedOid: "aaaaaaa", messageHeadline: "Change", committedDate: "2026-09-30T09:00:00Z",
			author: { user: me }, associatedPullRequests: { nodes: [{ number: pr.number }] },
		} }] } }), pr);
		expect(detail.commits[0]).toMatchObject({ oid, sha: "aaaaaaa" });
	});

	test("a repository without that pull request is an error, not an empty one", () => {
		expect(() => parseDetailAnswer({ data: { repository: { pullRequest: null } } }, pr)).toThrow("GitHub has no pull request acme/webapp#7");
	});
});
