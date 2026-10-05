import { describe, expect, test } from "bun:test";
import type { InboxPullRequest, PullRequestDetail, RepoInbox } from "../src/shared";
import { foldedByDefault, inboxSections, pullRequestStatus, rowVerdict, shownPullRequests, waitingCount } from "./inbox-model";

const pr = (number: number, fields: Partial<InboxPullRequest> = {}): InboxPullRequest => ({
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
	conflicts: false,
	head: `me/branch-${number}`,
	headOid: `sha-${number}`,
	stackedOn: null,
	unresolved: { count: 0, exact: true },
	updatedAt: number,
	...fields,
});

const teammate = { login: "teammate", avatarUrl: null };

describe("inbox sections", () => {
	test("each PR lands in the first section that takes it, newest first, and empty sections drop out", () => {
		const sections = inboxSections([
			pr(1, { role: "reviewer", review: "changes-requested", author: teammate }),
			pr(2, { review: "changes-requested" }),
			pr(3, { review: "approved" }),
			pr(4),
			pr(5, { review: "none" }),
			pr(6, { state: "draft", review: "approved" }),
			pr(7, { state: "merged", review: "approved" }),
			pr(8, { role: "reviewer", state: "merged" }),
		]);
		expect(sections.map(section => [section.title, section.waiting, section.rows.map(row => row.pr.number)])).toEqual([
			["Needs your review", "your-review", [1]],
			["Returned to you", "your-fix", [2]],
			["Approved", null, [3]],
			["Waiting for review", null, [5, 4]],
			["Drafts", null, [6]],
			["Recently merged", null, [8, 7]],
		]);
		expect(inboxSections([pr(1, { state: "draft" })]).map(section => section.title)).toEqual(["Drafts"]);
	});

	test("a stack's members in one section sit together, top first, where its newest member would", () => {
		const [section] = inboxSections([
			pr(1),
			pr(2, { stackedOn: "me/branch-1" }),
			pr(3),
			pr(4, { stackedOn: "me/branch-2" }),
			pr(5),
		]);
		expect(section!.rows.map(({ pr: { number }, stack }) => [number, stack])).toEqual([
			[5, null],
			[4, { position: 3, size: 3, joinsAbove: false, joinsBelow: true }],
			[2, { position: 2, size: 3, joinsAbove: true, joinsBelow: true }],
			[1, { position: 1, size: 3, joinsAbove: true, joinsBelow: false }],
			[3, null],
		]);
	});

	test("stack places count across sections, and the rail joins only neighbors in the same section", () => {
		const sections = inboxSections([pr(1, { review: "approved" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { state: "draft", stackedOn: "me/branch-2" })]);
		expect(sections.map(({ title, rows }) => [title, rows.map(({ pr: { number }, stack }) => [number, stack])])).toEqual([
			["Approved", [[1, { position: 1, size: 3, joinsAbove: false, joinsBelow: false }]]],
			["Waiting for review", [[2, { position: 2, size: 3, joinsAbove: false, joinsBelow: false }]]],
			["Drafts", [[3, { position: 3, size: 3, joinsAbove: false, joinsBelow: false }]]],
		]);
	});

	test("a PR stacked on a branch the inbox does not list, or on a merged PR, is in no stack", () => {
		const sections = inboxSections([pr(1, { state: "merged" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { stackedOn: "someone/else" })]);
		expect(sections.flatMap(({ rows }) => rows.map(({ pr: { number }, stack }) => [number, stack]))).toEqual([
			[3, null],
			[2, null],
			[1, null],
		]);
	});

	test("a cycle of bases still lists every PR once", () => {
		const [section] = inboxSections([pr(1, { stackedOn: "me/branch-2" }), pr(2, { stackedOn: "me/branch-1" })]);
		expect(section!.rows.map(row => row.pr.number).toSorted()).toEqual([1, 2]);
	});
});

test("only Recently merged sections start folded", () => {
	expect(["acme/webapp:Recently merged", "acme/webapp:Drafts", "acme/webapp", "Recently merged"].map(foldedByDefault)).toEqual([true, false, false, false]);
});

test("the waiting count adds reviews asked of you and PRs returned to you across repositories, skipping unreadable ones", () => {
	const repo = (pullRequests: InboxPullRequest[]): RepoInbox => ({ owner: "acme", repo: "webapp", cwds: [], pullRequests });
	const inbox = {
		repos: [
			repo([pr(1, { role: "reviewer", author: teammate }), pr(2, { review: "changes-requested" }), pr(3, { review: "approved" }), pr(4, { role: "reviewer", state: "merged" })]),
			repo([pr(5, { role: "reviewer", author: teammate })]),
			{ owner: "acme", repo: "down", cwds: [], error: "rate limited" },
		],
		unmatched: [],
	};
	expect(waitingCount(inbox)).toBe(3);
});

test("the shown pull requests follow page order and leave out folded repositories, folded sections, and unreadable repositories", () => {
	const repo = (name: string, pullRequests: InboxPullRequest[]): RepoInbox => ({ owner: "acme", repo: name, cwds: [], pullRequests });
	const inbox = {
		repos: [
			repo("webapp", [pr(1), pr(2, { role: "reviewer", author: teammate }), pr(3, { state: "merged" }), pr(4, { state: "draft" })]),
			repo("folded", [pr(5)]),
			{ owner: "acme", repo: "down", cwds: [], error: "rate limited" },
		],
		unmatched: [],
	};
	const folded = new Set(["acme/folded", "acme/webapp:Recently merged"]);
	expect(shownPullRequests(inbox, key => folded.has(key)).map(({ repo, number }) => `${repo}#${number}`)).toEqual(["webapp#2", "webapp#1", "webapp#4"]);
});

describe("row verdict", () => {
	test("your open PR says only that it is ready to merge, and only when nothing blocks it", () => {
		expect(
			[
				pr(1, { review: "approved" }),
				pr(2, { review: "none", checks: "none" }),
				pr(3, { review: "approved", conflicts: true }),
				pr(4, { review: "approved", checks: "pending" }),
				pr(5, { review: "approved", unresolved: { count: 1, exact: true } }),
				pr(6, { review: "approved", unresolved: { count: 0, exact: false } }),
				pr(7, { review: "changes-requested" }),
				pr(8, { review: "review-required" }),
			].map(rowVerdict),
		).toEqual(["ready", "ready", null, null, null, null, null, null]);
	});

	test("a draft or a review asked of you shows the decision its section leaves unsaid; a merged PR shows none", () => {
		expect(
			[
				pr(1, { state: "draft", review: "changes-requested" }),
				pr(2, { state: "draft", review: "review-required" }),
				pr(3, { role: "reviewer", review: "approved", author: teammate }),
				pr(4, { role: "reviewer", review: "review-required", author: teammate }),
				pr(5, { state: "merged", review: "approved" }),
			].map(rowVerdict),
		).toEqual(["changes-requested", null, "approved", null, null]);
	});
});

describe("pull request status", () => {
	const detail = (fields: Partial<PullRequestDetail>): PullRequestDetail => ({
		owner: "acme",
		repo: "webapp",
		number: 7,
		title: "PR 7",
		body: "",
		author: { login: "me", avatarUrl: null },
		reviewers: [],
		state: "open",
		review: "review-required",
		head: "me/branch-7",
		base: "main",
		conflicts: false,
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		files: [],
		checks: [],
		threads: [],
		conversation: [],
		createdAt: 0,
		...fields,
	});
	const check = (state: PullRequestDetail["checks"][number]["state"]) => ({ name: state, state, url: null });

	test("lists blockers first, then what waits, then what is done", () => {
		expect(
			pullRequestStatus(
				detail({
					conflicts: true,
					review: "changes-requested",
					reviewers: [
						{ ...teammate, state: "changes-requested" },
						{ login: "lead", avatarUrl: null, state: "requested" },
					],
					checks: [check("failing"), check("pending"), check("passing")],
					threads: [{ path: "a.ts", line: 1, comments: [] }],
				}),
			),
		).toEqual([
			{ kind: "conflicts", base: "main" },
			{ kind: "checks-failing", count: 1 },
			{ kind: "changes-requested", by: ["teammate"] },
			{ kind: "threads", count: 1 },
			{ kind: "checks-pending", count: 1 },
		]);
	});

	test("an approved PR with settled checks and no open thread leads with ready to merge", () => {
		expect(
			pullRequestStatus(detail({ review: "approved", reviewers: [{ ...teammate, state: "approved" }], checks: [check("passing"), check("skipped")] })),
		).toEqual([{ kind: "ready" }, { kind: "approved", by: ["teammate"] }, { kind: "checks-passing", passed: 1, skipped: 1 }]);
	});

	test("a draft says so and names whom it waits on; a merged or closed PR has no status", () => {
		expect(pullRequestStatus(detail({ state: "draft", reviewers: [{ ...teammate, state: "requested" }] }))).toEqual([
			{ kind: "draft" },
			{ kind: "review-required", waitingOn: ["teammate"] },
		]);
		expect(pullRequestStatus(detail({ state: "merged" }))).toEqual([]);
		expect(pullRequestStatus(detail({ state: "closed", conflicts: true }))).toEqual([]);
	});
});
