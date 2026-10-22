import { describe, expect, test } from "bun:test";
import type { LinkedPullRequest, PullRequestSummary, PullRequestComment, PullRequestDetail, PullRequestThread, RepoPullRequests, StackedPullRequest } from "../src/shared/github";
import { type AgentOn, actionFacts, agentOn, moveOf } from "../src/shared/moves";
import { pullRequestActions } from "../src/pull-request-actions";
import type { RosterHost } from "../src/shared/sessions";
import {
	commentCount,
	DEFAULT_ORDER,
	decodeOrder,
	foldedByDefault,
	type PullRequestOrder,
	pullRequestSections,
	listedPullRequests,
	moveAction,
	moveKey,
	movesSummary,
	openThreads,
	orderedRepos,
	placedManual,
	reason,
	sectionTitles,
	shownPullRequests,
	sessionStack,
	stepTarget,
	withPullRequestState,
	withThreadResolved,
	yourMoveCount,
} from "./pull-requests-model";

const pr = (number: number, fields: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
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
	additions: 0,
	deletions: 0,
	head: `me/branch-${number}`,
	stackedOn: null,
	unresolved: { count: 0, exact: true },
	conversations: 0,
	updatedAt: number,
	...fields,
});

const teammate = { login: "teammate", avatarUrl: null };

const noAgent: AgentOn = () => null;

describe("next move", () => {
	test("each pull request waits on the first move that applies", () => {
		const cases: [PullRequestSummary, "working" | "needs-input" | null][] = [
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

	test("a rebase with failing checks goes to one session that fixes both; a move whose action does not apply has none", () => {
		expect([
			moveAction(pr(1, { conflicts: true, checks: "failing" }), "rebase"),
			moveAction(pr(2, { conflicts: true }), "rebase"),
			moveAction(pr(3, { checks: "failing" }), "fix-ci"),
			moveAction(pr(4, { conflicts: true, state: "merged" }), "rebase"),
			moveAction(pr(5, { review: "approved" }), "merge"),
		]).toEqual(["fix-ci-and-conflicts", "resolve-conflicts", "fix-ci", null, null]);
	});
});

describe("pull request sections", () => {
	test("pull requests group by whose move it is, approved ones with nothing to fix apart, by move then most recently updated, and empty sections drop out", () => {
		const agent: AgentOn = ({ number }) => (number === 9 ? "working" : number === 10 ? "needs-input" : null);
		const sections = pullRequestSections(
			[
				pr(1, { role: "reviewer", author: teammate }),
				pr(2, { review: "changes-requested" }),
				pr(3, { review: "approved" }),
				pr(4),
				pr(5, { checks: "pending" }),
				pr(6, { state: "draft", review: "approved" }),
				pr(7, { state: "merged", review: "approved" }),
				pr(8, { role: "reviewer", state: "merged" }),
				pr(9, { review: "approved" }),
				pr(10),
				pr(11, { review: "approved", checks: "pending" }),
				pr(12, { review: "none", checks: "none" }),
				pr(13, { review: "approved", checks: "failing" }),
			],
			DEFAULT_ORDER,
			agent,
		);
		expect(sections.map(section => [section.title, section.rows.map(row => [row.pr.number, row.move])])).toEqual([
			["Your move", [[1, "review"], [12, "merge"], [13, "fix-ci"], [2, "reply"]]],
			["Agent on it", [[10, "answer"], [9, "agent"]]],
			["Approved", [[3, "merge"], [11, "checks-running"], [6, "draft"]]],
			["Waiting on others", [[4, "in-review"], [5, "checks-running"]]],
			["Recently merged", [[8, "merged"], [7, "merged"]]],
		]);
		expect(pullRequestSections([pr(1, { state: "draft" })], DEFAULT_ORDER, noAgent).map(section => section.title)).toEqual(["Drafts"]);
	});

	test("a stack's members in one section sit together, top first, where its newest member would", () => {
		const [section] = pullRequestSections(
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
		const sections = pullRequestSections([pr(1, { review: "approved" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { checks: "pending", stackedOn: "me/branch-2" })], DEFAULT_ORDER, noAgent);
		expect(sections.map(({ title, rows }) => [title, rows.map(({ pr: { number }, stack }) => [number, stack])])).toEqual([
			["Approved", [[1, { position: 1, size: 3, joinsAbove: false, joinsBelow: false }]]],
			[
				"Waiting on others",
				[
					[3, { position: 3, size: 3, joinsAbove: false, joinsBelow: true }],
					[2, { position: 2, size: 3, joinsAbove: true, joinsBelow: false }],
				],
			],
		]);
	});

	test("a PR stacked on a branch the list leaves out, or on a merged PR, is in no stack", () => {
		const sections = pullRequestSections([pr(1, { state: "merged" }), pr(2, { stackedOn: "me/branch-1" }), pr(3, { stackedOn: "someone/else" })], DEFAULT_ORDER, noAgent);
		expect(sections.flatMap(({ rows }) => rows.map(({ pr: { number }, stack }) => [number, stack]))).toEqual([
			[3, null],
			[2, null],
			[1, null],
		]);
	});

	test("a cycle of bases still lists every PR once", () => {
		const [section] = pullRequestSections([pr(1, { stackedOn: "me/branch-2" }), pr(2, { stackedOn: "me/branch-1" })], DEFAULT_ORDER, noAgent);
		expect(section!.rows.map(row => row.pr.number).toSorted()).toEqual([1, 2]);
	});

	test("a section that holds several moves sums them up in rank order; one that holds a single move does not", () => {
		const sections = pullRequestSections(
			[pr(1), pr(2, { state: "draft" }), pr(3), pr(4, { checks: "pending" }), pr(5, { state: "merged" }), pr(6, { review: "approved" }), pr(7, { review: "approved", checks: "pending" })],
			DEFAULT_ORDER,
			noAgent,
		);
		expect(sections.map(section => [section.title, movesSummary(section)])).toEqual([
			["Approved", "1 merge · 1 CI running"],
			["Waiting on others", "2 in review · 1 CI running"],
			["Drafts", null],
			["Recently merged", null],
		]);
	});
});

test("only the sections with nothing to do now start folded", () => {
	expect(
		["acme/webapp:Recently merged", "acme/webapp:Waiting on others", "acme/webapp:Your move", "acme/webapp:Agent on it", "acme/webapp:Approved", "acme/webapp:Drafts", "acme/webapp", "Recently merged"].map(foldedByDefault),
	).toEqual([true, true, false, false, false, false, false, false]);
});

test("your move counts what waits on you across repositories, leaving out what an agent holds, approved pull requests with nothing to fix, what waits on others, and unreadable repositories", () => {
	const repo = (pullRequests: PullRequestSummary[]): RepoPullRequests => ({ owner: "acme", repo: "webapp", cwds: [], pullRequests });
	const list = {
		repos: [
			repo([pr(1, { review: "approved" }), pr(2, { review: "none" }), pr(3, { role: "reviewer", author: teammate }), pr(4, { review: "changes-requested" })]),
			repo([pr(5, { review: "approved", unresolved: { count: 1, exact: true } }), pr(6, { state: "merged" }), pr(7, { review: "approved" }), pr(8)]),
			{ owner: "acme", repo: "down", cwds: [], error: "rate limited" },
		],
		unmatched: [],
	};
	expect(yourMoveCount(list, ({ number }) => (number === 7 ? "working" : null))).toBe(4);
});

test("the shown pull requests follow page order and leave out folded repositories, folded sections, and unreadable repositories", () => {
	const repo = (name: string, pullRequests: PullRequestSummary[]): RepoPullRequests => ({ owner: "acme", repo: name, cwds: [], pullRequests });
	const list = {
		repos: [
			repo("webapp", [pr(1), pr(2, { role: "reviewer", author: teammate }), pr(3, { state: "merged" }), pr(4, { state: "draft" })]),
			repo("folded", [pr(5)]),
			{ owner: "acme", repo: "down", cwds: [], error: "rate limited" },
		],
		unmatched: [],
	};
	const folded = new Set(["acme/folded", "acme/webapp:Recently merged"]);
	expect(shownPullRequests(list, key => folded.has(key), DEFAULT_ORDER, noAgent).map(({ repo, number }) => `${repo}#${number}`)).toEqual(["webapp#2", "webapp#1", "webapp#4"]);
});

describe("pull request order", () => {
	const order = (fields: Partial<PullRequestOrder>): PullRequestOrder => ({ ...DEFAULT_ORDER, ...fields });
	const numbers = (prs: { rows: { pr: { number: number } }[] }[]) => prs.map(section => section.rows.map(row => row.pr.number));

	test("newest and oldest sort by number, and a stack keeps its members together, top first", () => {
		const prs = [pr(1, { updatedAt: 50 }), pr(2, { updatedAt: 10, stackedOn: "me/branch-1" }), pr(3, { updatedAt: 30 })];
		expect(numbers(pullRequestSections(prs, order({ sort: "updated" }), noAgent))).toEqual([[2, 1, 3]]);
		expect(numbers(pullRequestSections(prs, order({ sort: "newest" }), noAgent))).toEqual([[3, 2, 1]]);
		expect(numbers(pullRequestSections(prs, order({ sort: "oldest" }), noAgent))).toEqual([[2, 1, 3]]);
	});

	test("the manual sort puts pull requests you never placed first, most recently updated first, then yours in your order, whatever their moves", () => {
		const prs = [pr(1), pr(2, { checks: "pending" }), pr(3), pr(4, { checks: "pending" }), pr(5)];
		expect(numbers(pullRequestSections(prs, order({ sort: "manual", manual: ["acme/webapp#2", "acme/webapp#4", "acme/webapp#1"] }), noAgent))).toEqual([[5, 3, 2, 4, 1]]);
	});

	test("sections and repositories follow your order, and those it does not name follow in their default order", () => {
		const prs = [pr(1, { review: "approved" }), pr(2), pr(3, { state: "merged" })];
		const sections = pullRequestSections(prs, order({ sections: ["Recently merged", "Gone section", "Waiting on others"] }), noAgent);
		expect(sections.map(section => section.title)).toEqual(["Recently merged", "Waiting on others", "Approved"]);
		expect(sectionTitles(order({ sections: ["Recently merged"] }))).toEqual(["Recently merged", "Your move", "Agent on it", "Approved", "Waiting on others", "Drafts"]);
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
		const prs = [pr(1, { updatedAt: 5 }), pr(2, { updatedAt: 1, stackedOn: "me/branch-1" }), pr(3, { updatedAt: 9 }), pr(4, { checks: "pending" })];
		const sections = pullRequestSections(prs, order({ sort: "newest" }), noAgent);
		const [waiting] = sections;
		expect(numbers(sections)).toEqual([[3, 2, 1, 4]]);
		const stack = waiting!.rows.find(row => row.pr.number === 2)!.unit;
		const manual = placedManual(["acme/other#7", "acme/webapp#99"], { owner: "acme", repo: "webapp" }, sections, "Waiting on others", stack, "acme/webapp#3", "before");
		expect(manual).toEqual(["acme/webapp#2", "acme/webapp#1", "acme/webapp#3", "acme/webapp#4", "acme/other#7"]);
		expect(numbers(pullRequestSections(prs, order({ sort: "manual", manual }), noAgent))).toEqual([[2, 1, 3, 4]]);
	});

	test("the shown pull requests follow the custom order", () => {
		const repo = (name: string, pullRequests: PullRequestSummary[]): RepoPullRequests => ({ owner: "acme", repo: name, cwds: [], pullRequests });
		const list = { repos: [repo("webapp", [pr(1), pr(2, { role: "reviewer", author: teammate })]), repo("api", [pr(3, { repo: "api" })])], unmatched: [] };
		const shown = shownPullRequests(list, () => false, order({ repos: ["acme/api"], sections: ["Waiting on others"] }), noAgent);
		expect(shown.map(({ repo, number }) => `${repo}#${number}`)).toEqual(["api#3", "webapp#1", "webapp#2"]);
	});

	test("a stored order that cannot be read falls back to the default, field by field", () => {
		expect(decodeOrder(null)).toEqual(DEFAULT_ORDER);
		expect(decodeOrder("{not json")).toEqual(DEFAULT_ORDER);
		expect(decodeOrder(JSON.stringify({ repos: ["acme/a", 3], sort: "random", manual: "acme/a#1" }))).toEqual({ repos: ["acme/a"], sections: [], sort: "updated", manual: [] });
	});
});

describe("pull request details", () => {
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
		updatedAt: 0,
		mergedAt: null,
		closedAt: null,
		labels: [],
		commits: [],
		headOid: "",
		mergeMethods: [],
		mergeState: "clean",
		behindBy: null,
		canComment: false,
		...fields,
	});
	test("the details' facts, not the list's older ones, decide the move and quick actions", () => {
		const ready = pr(7, { review: "approved", checks: "passing" });
		expect(moveOf(ready, null)).toBe("merge");
		const drafted = actionFacts(ready, detail({ state: "draft", review: "approved", checks: "passing" }));
		expect(drafted && moveOf(drafted, null)).toBe("draft");
		const failing = actionFacts(ready, detail({ review: "approved", checks: "failing" }));
		expect(failing && moveOf(failing, null)).toBe("fix-ci");
		expect(failing && pullRequestActions(failing)).toContain("fix-ci");
		expect(pullRequestActions(ready)).not.toContain("fix-ci");
		const merged = actionFacts(ready, detail({ state: "merged" }));
		expect(merged && moveOf(merged, null)).toBe("merged");
		expect(actionFacts(ready, detail({ state: "closed" }))).toBeNull();
		expect(actionFacts(ready, null)).toBe(ready);
	});

	const thread = (id: string, resolved: boolean): PullRequestThread => ({ id, path: "a.ts", line: 1, resolved, outdated: false, dismissed: false, can: { reply: true, resolve: true, unresolve: true }, commentCount: 0, comments: [] });

	test("open threads are the unresolved ones, in GitHub's order", () => {
		const threads = [thread("PRRT_a", false), thread("PRRT_b", true), thread("PRRT_c", false)];
		expect(openThreads(detail({ threads })).map(({ id }) => id)).toEqual(["PRRT_a", "PRRT_c"]);
	});

	test("the comment count counts every comment of every thread, resolved ones too and replies beyond those loaded, and the conversation's comments and reviews with words", () => {
		const said: PullRequestComment = { author: { login: "ann", avatarUrl: null }, at: 0, body: "Looks off", url: "", reactions: [] };
		const threads = [{ ...thread("PRRT_a", false), commentCount: 23, comments: [said, said] }, { ...thread("PRRT_b", true), commentCount: 1, comments: [said] }];
		const conversation = [{ ...said, review: null }, { ...said, body: "  ", review: "approved" as const }, { ...said, review: "changes-requested" as const }];
		expect(commentCount(detail({ threads, conversation }))).toBe(26);
	});

	test("resolving or unresolving a thread moves the unresolved count with it, and keeps whether GitHub listed every thread", () => {
		const before = detail({ threads: [thread("PRRT_a", false), thread("PRRT_b", false)], unresolved: { count: 2, exact: false } });
		const resolved = withThreadResolved(before, "PRRT_a", true);
		expect(resolved).toEqual({ threads: [thread("PRRT_a", true), thread("PRRT_b", false)], unresolved: { count: 1, exact: false } });
		expect(withThreadResolved({ ...before, ...resolved }, "PRRT_a", false)).toEqual({ threads: before.threads, unresolved: { count: 2, exact: false } });
	});
});

describe("session stack", () => {
	const linked = (number: number): LinkedPullRequest => ({ owner: "acme", repo: "webapp", number, link: "submitted" });
	const member = (number: number): StackedPullRequest => ({
		owner: "acme",
		repo: "webapp",
		number,
		title: `PR ${number}`,
		author: { login: "me", avatarUrl: null },
		state: "open",
		checks: "passing",
		head: `me/branch-${number}`,
		base: `me/branch-${number - 1}`,
		updatedAt: number,
	});

	test("two or more of the session's pull requests in one stack show as the stack, the rest after it", () => {
		const stack = [member(3), member(2), member(1)];
		expect(sessionStack([linked(1), linked(9), linked(2)], stack)).toEqual({ stack, others: [linked(9)] });
	});

	test("a stack holding one of the session's pull requests, or none read yet, leaves the list as it is", () => {
		expect(sessionStack([linked(1), linked(9)], [member(2), member(1)])).toBeNull();
		expect(sessionStack([linked(1), linked(2)], [])).toBeNull();
	});
});

describe("pull request list after a change", () => {
	const repo = (name: string, pullRequests: PullRequestSummary[]): RepoPullRequests => ({ owner: "acme", repo: name, cwds: ["/w"], pullRequests });
	const failed: RepoPullRequests = { owner: "acme", repo: "down", cwds: [], error: "gh failed" };
	const one = pr(1, { state: "draft" });
	const two = pr(2);
	const other = pr(1, { repo: "api" });
	const list = { repos: [repo("webapp", [one, two]), repo("api", [other]), failed], unmatched: ["/x"] };

	test("a new state shows on the pull request's row, and leaves every other repository and row as it was", () => {
		const ready = withPullRequestState(list, one, "open", 99);
		expect(ready.repos[0]).toEqual(repo("webapp", [pr(1, { state: "open" }), two]));
		expect(listedPullRequests(ready.repos)[1]).toBe(two);
		expect(ready.repos[1]).toBe(list.repos[1]);
		expect(ready.repos[2]).toBe(failed);
		expect(ready.unmatched).toEqual(["/x"]);
		expect(withPullRequestState(list, two, "draft", 99).repos[0]).toEqual(repo("webapp", [one, pr(2, { state: "draft" })]));
	});

	test("a merge marks the row merged and updated at the merge's time", () => {
		expect(withPullRequestState(list, two, "merged", 1234).repos[0]).toEqual(repo("webapp", [one, pr(2, { state: "merged", updatedAt: 1234 })]));
	});

	test("a closed pull request leaves the list", () => {
		const closed = withPullRequestState(list, other, "closed", 99);
		expect(closed.repos).toEqual([list.repos[0], repo("api", []), failed]);
		expect(closed.repos[0]).toBe(list.repos[0]);
	});
});
