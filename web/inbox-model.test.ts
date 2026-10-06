import { describe, expect, test } from "bun:test";
import type { InboxPullRequest, PullRequestCheck, PullRequestDetail, RepoInbox } from "../src/shared/github";
import type { RosterHost } from "../src/shared/sessions";
import {
	type AgentOn,
	agentOn,
	DEFAULT_ORDER,
	decodeOrder,
	foldedByDefault,
	type InboxOrder,
	inboxSections,
	moveKey,
	moveOf,
	movesSummary,
	orderedRepos,
	placedManual,
	pullRequestStatus,
	reason,
	sectionTitles,
	shownPullRequests,
	stepTarget,
	yourMoveCount,
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
	stackedOn: null,
	unresolved: { count: 0, exact: true },
	updatedAt: number,
	...fields,
});

const teammate = { login: "teammate", avatarUrl: null };

const noAgent: AgentOn = () => null;

describe("next move", () => {
	test("each pull request waits on the first move that applies", () => {
		const cases: [InboxPullRequest, "working" | "needs-input" | null][] = [
			[pr(1, { state: "merged" }), "working"],
			[pr(2, { role: "reviewer", author: teammate }), "needs-input"],
			[pr(3, { role: "reviewer", author: teammate }), "working"],
			[pr(4, { role: "reviewer", author: teammate, review: "changes-requested" }), null],
			[pr(5, { conflicts: true, checks: "failing" }), null],
			[pr(6, { checks: "failing", review: "changes-requested" }), null],
			[pr(7, { review: "changes-requested" }), null],
			[pr(8, { review: "approved", unresolved: { count: 0, exact: false } }), null],
			[pr(9, { state: "draft", checks: "failing" }), null],
			[pr(10, { state: "draft", review: "approved" }), null],
			[pr(11, { review: "approved" }), null],
			[pr(12, { review: "none", checks: "none" }), null],
			[pr(13, { review: "approved", checks: "pending" }), null],
			[pr(14), null],
		];
		expect(cases.map(([pullRequest, agent]) => moveOf(pullRequest, agent))).toEqual([
			"merged",
			"answer",
			"agent",
			"review",
			"rebase",
			"fix-ci",
			"reply",
			"reply",
			"fix-ci",
			"draft",
			"merge",
			"merge",
			"checks-running",
			"in-review",
		]);
	});

	test("a session asking you beats one that works, and an idle session leaves the move with you", () => {
		const host = (instanceId: string, status: RosterHost["status"], number: number) =>
			({ instanceId, status, pullRequests: [{ owner: "acme", repo: "webapp", number, link: "worked" }], tickets: [] }) as unknown as RosterHost;
		const agent = agentOn([host("a", "working", 1), host("b", "needs-input", 1), host("c", "idle", 2), host("d", "working", 3)]);
		expect([pr(1), pr(2), pr(3), pr(4)].map(agent)).toEqual(["needs-input", null, "working", null]);
	});

	test("the reason says who and what the move waits on", () => {
		const requested = (login: string) => ({ login, avatarUrl: null, state: "requested" as const });
		expect([
			reason(pr(1, { reviewers: [requested("bob"), { login: "amy", avatarUrl: null, state: "approved" }, requested("cy")] }), "in-review"),
			reason(pr(2), "in-review"),
			reason(pr(3, { unresolved: { count: 3, exact: false } }), "reply"),
			reason(pr(4, { unresolved: { count: 1, exact: true }, review: "changes-requested" }), "reply"),
			reason(pr(5, { review: "changes-requested" }), "reply"),
			reason(pr(6, { stackedOn: "me/base" }), "rebase"),
			reason(pr(7), "rebase"),
			reason(pr(8, { review: "none", checks: "none" }), "merge"),
			reason(pr(9, { role: "reviewer", author: teammate }), "review"),
		]).toEqual([
			"waiting on @bob and @cy",
			"waiting for review",
			"3+ open threads",
			"1 open thread · changes requested",
			"changes requested",
			"conflicts with me/base",
			"conflicts with base",
			"no review needed · no checks",
			"@teammate",
		]);
	});
});

describe("inbox sections", () => {
	test("pull requests group by whose move it is, by move then most recently updated, and empty sections drop out", () => {
		const agent: AgentOn = ({ number }) => (number === 9 ? "working" : number === 10 ? "needs-input" : null);
		const sections = inboxSections(
			[
				pr(1, { role: "reviewer", author: teammate }),
				pr(2, { review: "changes-requested" }),
				pr(3, { review: "approved" }),
				pr(4),
				pr(5, { checks: "pending" }),
				pr(6, { state: "draft", review: "approved" }),
				pr(7, { state: "merged", review: "approved" }),
				pr(8, { role: "reviewer", state: "merged" }),
				pr(9),
				pr(10),
			],
			DEFAULT_ORDER,
			agent,
		);
		expect(sections.map(section => [section.title, section.rows.map(row => [row.pr.number, row.move])])).toEqual([
			["Your move", [[1, "review"], [3, "merge"], [2, "reply"]]],
			["Agent on it", [[10, "answer"], [9, "agent"]]],
			["Waiting on others", [[4, "in-review"], [5, "checks-running"], [6, "draft"]]],
			["Recently merged", [[8, "merged"], [7, "merged"]]],
		]);
		expect(inboxSections([pr(1, { state: "draft" })], DEFAULT_ORDER, noAgent).map(section => section.title)).toEqual(["Waiting on others"]);
	});

	test("a stack's members in one section sit together, top first, where its newest member would", () => {
		const [section] = inboxSections(
			[pr(1), pr(2, { stackedOn: "me/branch-1" }), pr(3), pr(4, { stackedOn: "me/branch-2" }), pr(5)],
			DEFAULT_ORDER,
			noAgent,
		);
		expect(section!.rows.map(({ pr: { number }, stack }) => [number, stack])).toEqual([
			[5, null],
			[4, { position: 3, size: 3, joinsAbove: false, joinsBelow: true }],
			[2, { position: 2, size: 3, joinsAbove: true, joinsBelow: true }],
			[1, { position: 1, size: 3, joinsAbove: true, joinsBelow: false }],
			[3, null],
		]);
	});

	test("stack places count across sections, and the rail joins only neighbors in the same section", () => {
		const sections = inboxSections([pr(1, { review: "approved" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { state: "draft", stackedOn: "me/branch-2" })], DEFAULT_ORDER, noAgent);
		expect(sections.map(({ title, rows }) => [title, rows.map(({ pr: { number }, stack }) => [number, stack])])).toEqual([
			["Your move", [[1, { position: 1, size: 3, joinsAbove: false, joinsBelow: false }]]],
			[
				"Waiting on others",
				[
					[3, { position: 3, size: 3, joinsAbove: false, joinsBelow: true }],
					[2, { position: 2, size: 3, joinsAbove: true, joinsBelow: false }],
				],
			],
		]);
	});

	test("a PR stacked on a branch the inbox does not list, or on a merged PR, is in no stack", () => {
		const sections = inboxSections([pr(1, { state: "merged" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { stackedOn: "someone/else" })], DEFAULT_ORDER, noAgent);
		expect(sections.flatMap(({ rows }) => rows.map(({ pr: { number }, stack }) => [number, stack]))).toEqual([
			[3, null],
			[2, null],
			[1, null],
		]);
	});

	test("a cycle of bases still lists every PR once", () => {
		const [section] = inboxSections([pr(1, { stackedOn: "me/branch-2" }), pr(2, { stackedOn: "me/branch-1" })], DEFAULT_ORDER, noAgent);
		expect(section!.rows.map(row => row.pr.number).toSorted()).toEqual([1, 2]);
	});

	test("a section that holds several moves sums them up in rank order; one that holds a single move does not", () => {
		const sections = inboxSections([pr(1), pr(2, { state: "draft" }), pr(3), pr(4, { checks: "pending" }), pr(5, { state: "merged" })], DEFAULT_ORDER, noAgent);
		expect(sections.map(section => [section.title, movesSummary(section)])).toEqual([
			["Waiting on others", "2 in review · 1 CI running · 1 draft"],
			["Recently merged", null],
		]);
	});
});

test("only the sections with nothing to do now start folded", () => {
	expect(["acme/webapp:Recently merged", "acme/webapp:Waiting on others", "acme/webapp:Your move", "acme/webapp:Agent on it", "acme/webapp", "Recently merged"].map(foldedByDefault)).toEqual([
		true,
		true,
		false,
		false,
		false,
		false,
	]);
});

test("your move counts what waits on you across repositories, leaving out what an agent holds, waits on others, and unreadable repositories", () => {
	const repo = (pullRequests: InboxPullRequest[]): RepoInbox => ({ owner: "acme", repo: "webapp", cwds: [], pullRequests });
	const inbox = {
		repos: [
			repo([pr(1, { review: "approved" }), pr(2, { review: "none" }), pr(3, { role: "reviewer", author: teammate }), pr(4, { review: "changes-requested" })]),
			repo([pr(5, { review: "approved", unresolved: { count: 1, exact: true } }), pr(6, { state: "merged" }), pr(7, { review: "approved" }), pr(8)]),
			{ owner: "acme", repo: "down", cwds: [], error: "rate limited" },
		],
		unmatched: [],
	};
	expect(yourMoveCount(inbox, ({ number }) => (number === 7 ? "working" : null))).toBe(5);
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
	expect(shownPullRequests(inbox, key => folded.has(key), DEFAULT_ORDER, noAgent).map(({ repo, number }) => `${repo}#${number}`)).toEqual(["webapp#2", "webapp#1", "webapp#4"]);
});

describe("inbox order", () => {
	const order = (fields: Partial<InboxOrder>): InboxOrder => ({ ...DEFAULT_ORDER, ...fields });
	const numbers = (prs: { rows: { pr: { number: number } }[] }[]) => prs.map(section => section.rows.map(row => row.pr.number));

	test("newest and oldest sort by number, and a stack keeps its members together, top first", () => {
		const prs = [pr(1, { updatedAt: 50 }), pr(2, { updatedAt: 10, stackedOn: "me/branch-1" }), pr(3, { updatedAt: 30 })];
		expect(numbers(inboxSections(prs, order({ sort: "updated" }), noAgent))).toEqual([[2, 1, 3]]);
		expect(numbers(inboxSections(prs, order({ sort: "newest" }), noAgent))).toEqual([[3, 2, 1]]);
		expect(numbers(inboxSections(prs, order({ sort: "oldest" }), noAgent))).toEqual([[2, 1, 3]]);
	});

	test("the manual sort puts pull requests you never placed first, most recently updated first, then yours in your order, whatever their moves", () => {
		const prs = [pr(1), pr(2, { state: "draft" }), pr(3), pr(4, { checks: "pending" }), pr(5)];
		expect(numbers(inboxSections(prs, order({ sort: "manual", manual: ["acme/webapp#2", "acme/webapp#4", "acme/webapp#1"] }), noAgent))).toEqual([[5, 3, 2, 4, 1]]);
	});

	test("sections and repositories follow your order, and those it does not name follow in their default order", () => {
		const prs = [pr(1, { review: "approved" }), pr(2), pr(3, { state: "merged" })];
		const sections = inboxSections(prs, order({ sections: ["Recently merged", "Gone section", "Waiting on others"] }), noAgent);
		expect(sections.map(section => section.title)).toEqual(["Recently merged", "Waiting on others", "Your move"]);
		expect(sectionTitles(order({ sections: ["Recently merged"] }))).toEqual(["Recently merged", "Your move", "Agent on it", "Waiting on others"]);
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
		const sections = inboxSections(prs, order({ sort: "newest" }), noAgent);
		const [waiting] = sections;
		expect(numbers(sections)).toEqual([[3, 2, 1, 4]]);
		const stack = waiting!.rows.find(row => row.pr.number === 2)!.unit;
		const manual = placedManual(["acme/other#7", "acme/webapp#99"], { owner: "acme", repo: "webapp" }, sections, "Waiting on others", stack, "acme/webapp#3", "before");
		expect(manual).toEqual(["acme/webapp#2", "acme/webapp#1", "acme/webapp#3", "acme/webapp#4", "acme/other#7"]);
		expect(numbers(inboxSections(prs, order({ sort: "manual", manual }), noAgent))).toEqual([[2, 1, 3, 4]]);
	});

	test("the shown pull requests follow the custom order", () => {
		const repo = (name: string, pullRequests: InboxPullRequest[]): RepoInbox => ({ owner: "acme", repo: name, cwds: [], pullRequests });
		const inbox = { repos: [repo("webapp", [pr(1), pr(2, { role: "reviewer", author: teammate })]), repo("api", [pr(3, { repo: "api" })])], unmatched: [] };
		const shown = shownPullRequests(inbox, () => false, order({ repos: ["acme/api"], sections: ["Waiting on others"] }), noAgent);
		expect(shown.map(({ repo, number }) => `${repo}#${number}`)).toEqual(["api#3", "webapp#1", "webapp#2"]);
	});

	test("a stored order that cannot be read falls back to the default, field by field", () => {
		expect(decodeOrder(null)).toEqual(DEFAULT_ORDER);
		expect(decodeOrder("{not json")).toEqual(DEFAULT_ORDER);
		expect(decodeOrder(JSON.stringify({ repos: ["acme/a", 3], sort: "random", manual: "acme/a#1" }))).toEqual({ repos: ["acme/a"], sections: [], sort: "updated", manual: [] });
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
		checks: "none",
		checkRuns: [],
		unresolved: { count: 0, exact: true },
		threads: [],
		conversation: [],
		createdAt: 0,
		...fields,
	});
	const check = (state: PullRequestCheck["state"]) => ({ name: state, state, url: null });

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
					checks: "failing",
					checkRuns: [check("failing"), check("pending"), check("passing")],
					unresolved: { count: 1, exact: true },
				}),
			),
		).toEqual([
			{ kind: "conflicts", base: "main" },
			{ kind: "checks-failing", count: 1 },
			{ kind: "changes-requested", by: ["teammate"] },
			{ kind: "threads", count: 1, exact: true },
			{ kind: "checks-pending", count: 1 },
		]);
	});

	test("an approved PR with settled checks and no open thread leads with ready to merge", () => {
		expect(
			pullRequestStatus(detail({ review: "approved", reviewers: [{ ...teammate, state: "approved" }], checks: "passing", checkRuns: [check("passing"), check("skipped")] })),
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
