import { describe, expect, test } from "bun:test";
import type { InboxPullRequest, PullRequestDetail, RepoInbox } from "../src/shared";
import {
	DEFAULT_ORDER,
	decodeOrder,
	foldedByDefault,
	type InboxOrder,
	inboxSections,
	mergeableCount,
	moveKey,
	orderedRepos,
	placedManual,
	pullRequestStatus,
	rowVerdict,
	sectionTitles,
	shownPullRequests,
	stepTarget,
} from "./inbox-model";

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

test("the mergeable count adds your PRs ready to merge across repositories, skipping reviews, blocked PRs, and unreadable repositories", () => {
	const repo = (pullRequests: InboxPullRequest[]): RepoInbox => ({ owner: "acme", repo: "webapp", cwds: [], pullRequests });
	const inbox = {
		repos: [
			repo([pr(1, { review: "approved" }), pr(2, { review: "none" }), pr(3, { role: "reviewer", review: "approved", author: teammate }), pr(4, { review: "changes-requested" })]),
			repo([pr(5, { review: "approved", unresolved: { count: 1, exact: true } }), pr(6, { review: "approved", state: "merged" }), pr(7, { review: "approved" })]),
			{ owner: "acme", repo: "down", cwds: [], error: "rate limited" },
		],
		unmatched: [],
	};
	expect(mergeableCount(inbox)).toBe(3);
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

describe("inbox order", () => {
	const order = (fields: Partial<InboxOrder>): InboxOrder => ({ ...DEFAULT_ORDER, ...fields });
	const numbers = (prs: { rows: { pr: { number: number } }[] }[]) => prs.map(section => section.rows.map(row => row.pr.number));

	test("newest and oldest sort by number, and a stack keeps its members together, top first", () => {
		const prs = [pr(1, { updatedAt: 50 }), pr(2, { updatedAt: 10, stackedOn: "me/branch-1" }), pr(3, { updatedAt: 30 })];
		expect(numbers(inboxSections(prs, order({ sort: "updated" })))).toEqual([[2, 1, 3]]);
		expect(numbers(inboxSections(prs, order({ sort: "newest" })))).toEqual([[3, 2, 1]]);
		expect(numbers(inboxSections(prs, order({ sort: "oldest" })))).toEqual([[2, 1, 3]]);
	});

	test("the manual sort puts pull requests you never placed first, most recently updated first, then yours in your order", () => {
		const prs = [pr(1), pr(2), pr(3), pr(4), pr(5)];
		expect(numbers(inboxSections(prs, order({ sort: "manual", manual: ["acme/webapp#2", "acme/webapp#4", "acme/webapp#1"] })))).toEqual([[5, 3, 2, 4, 1]]);
	});

	test("sections and repositories follow your order, and those it does not name follow in their default order", () => {
		const prs = [pr(1, { review: "approved" }), pr(2), pr(3, { state: "draft" })];
		const sections = inboxSections(prs, order({ sections: ["Drafts", "Gone section", "Approved"] }));
		expect(sections.map(section => section.title)).toEqual(["Drafts", "Approved", "Waiting for review"]);
		expect(sectionTitles(order({ sections: ["Recently merged"] }))).toEqual(["Recently merged", "Needs your review", "Returned to you", "Approved", "Waiting for review", "Drafts"]);
		const repos = ["a", "b", "c"].map(repo => ({ owner: "acme", repo }));
		expect(orderedRepos(repos, order({ repos: ["acme/c", "acme/gone", "acme/a"] })).map(({ repo }) => repo)).toEqual(["c", "a", "b"]);
	});

	test("moving a key puts it beside its target; a missing key or target changes nothing; a step at the edge has no target", () => {
		expect(moveKey(["a", "b", "c", "d"], "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
		expect(moveKey(["a", "b", "c", "d"], "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
		expect(moveKey(["a", "b"], "x", "a", "before")).toEqual(["a", "b"]);
		expect(stepTarget(["a", "b", "c"], "b", -1)).toEqual({ target: "a", where: "before" });
		expect(stepTarget(["a", "b", "c"], "c", 1)).toBeNull();
	});

	test("placing a pull request fixes the repository's shown order, moves a stack as one, and keeps other repositories' places", () => {
		const prs = [pr(1, { updatedAt: 5 }), pr(2, { updatedAt: 1, stackedOn: "me/branch-1" }), pr(3, { updatedAt: 9 }), pr(4, { state: "draft" })];
		const sections = inboxSections(prs, order({ sort: "newest" }));
		const [waiting] = sections;
		expect(numbers(sections)).toEqual([[3, 2, 1], [4]]);
		const stack = waiting!.rows.find(row => row.pr.number === 2)!.unit;
		const manual = placedManual(["acme/other#7", "acme/webapp#99"], { owner: "acme", repo: "webapp" }, sections, "Waiting for review", stack, "acme/webapp#3", "before");
		expect(manual).toEqual(["acme/webapp#2", "acme/webapp#1", "acme/webapp#3", "acme/webapp#4", "acme/other#7"]);
		expect(numbers(inboxSections(prs, order({ sort: "manual", manual })))).toEqual([[2, 1, 3], [4]]);
	});

	test("the shown pull requests follow the custom order", () => {
		const repo = (name: string, pullRequests: InboxPullRequest[]): RepoInbox => ({ owner: "acme", repo: name, cwds: [], pullRequests });
		const inbox = { repos: [repo("webapp", [pr(1), pr(2, { state: "draft" })]), repo("api", [pr(3, { repo: "api" })])], unmatched: [] };
		const shown = shownPullRequests(inbox, () => false, order({ repos: ["acme/api"], sections: ["Drafts"] }));
		expect(shown.map(({ repo, number }) => `${repo}#${number}`)).toEqual(["api#3", "webapp#2", "webapp#1"]);
	});

	test("a stored order that cannot be read falls back to the default, field by field", () => {
		expect(decodeOrder(null)).toEqual(DEFAULT_ORDER);
		expect(decodeOrder("{not json")).toEqual(DEFAULT_ORDER);
		expect(decodeOrder(JSON.stringify({ repos: ["acme/a", 3], sort: "random", manual: "acme/a#1" }))).toEqual({ repos: ["acme/a"], sections: [], sort: "updated", manual: [] });
	});
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
