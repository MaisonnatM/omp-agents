import { describe, expect, test } from "bun:test";
import type { PullRequestList, PullRequestSummary, RepoPullRequests } from "./github";
import { applyKeepRebased, EMPTY_KEEP_REBASED, type KeepRebasedState, keepRebasedRuns, parseKeepRebased, type RebaseStop } from "./keep-rebased";

const pr = (number: number, fields: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
	owner: "Acme",
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
	head: `branch-${number}`,
	base: "main",
	stackedOn: null,
	behind: true,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	createdAt: 0,
	updatedAt: 0,
	headOid: `head-${number}`,
	baseOid: "main-1",
	...fields,
});

const listed = (pullRequests: PullRequestSummary[], cwds = ["/code/webapp"]): RepoPullRequests => ({ owner: "Acme", repo: "webapp", cwds, pullRequests });
const list = (...repos: RepoPullRequests[]): PullRequestList => ({ repos, unmatched: [] });
const on: KeepRebasedState = { repos: ["acme/webapp"], stops: {} };

const stopOf = (number: number, fields: Partial<RebaseStop> = {}): RebaseStop => ({
	owner: "Acme",
	repo: "webapp",
	number,
	title: `PR ${number}`,
	branch: `branch-${number}`,
	onto: "main",
	head: `head-${number}`,
	base: "main-1",
	outcome: "conflict",
	why: "a.ts",
	at: 1,
	...fields,
});
const stopped = (...stops: RebaseStop[]): KeepRebasedState => ({ ...on, stops: Object.fromEntries(stops.map(stop => [`acme/webapp#${stop.number}`, stop])) });

const numbers = (state: KeepRebasedState, prs: PullRequestSummary[], cwds?: string[]): number[] => keepRebasedRuns(list(listed(prs, cwds)), state).map(run => run.pr.number);

describe("keepRebasedRuns", () => {
	test("rebases nothing in a repository with it off, or without a workspace", () => {
		expect(numbers(EMPTY_KEEP_REBASED, [pr(1)])).toEqual([]);
		expect(numbers(on, [pr(1)], [])).toEqual([]);
	});

	test("rebases your behind pull requests in the first workspace, with the commits the read gave", () => {
		const runs = keepRebasedRuns(list(listed([pr(1), pr(2, { behind: false }), pr(3, { role: "reviewer" }), pr(4, { conflicts: true })], ["/a", "/b"])), on);
		expect(runs.map(({ pr, cwd, head, base }) => ({ number: pr.number, cwd, head, base }))).toEqual([{ number: 1, cwd: "/a", head: "head-1", base: "main-1" }]);
	});

	test("rebases the bottom of a stack first", () => {
		expect(numbers(on, [pr(2, { stackedOn: "branch-1", base: "branch-1" }), pr(1)])).toEqual([1, 2]);
	});

	test("leaves out a pull request whose commits the read did not give", () => {
		expect(numbers(on, [pr(1, { headOid: undefined }), pr(2, { baseOid: undefined })])).toEqual([]);
	});

	test("leaves out a stop that still holds, and every pull request stacked above it", () => {
		const prs = [pr(1), pr(2, { stackedOn: "branch-1", base: "branch-1" }), pr(3)];
		expect(numbers(stopped(stopOf(1)), prs)).toEqual([3]);
	});

	test("tries a stop again once its head or its base moved", () => {
		expect(numbers(stopped(stopOf(1)), [pr(1, { headOid: "head-1b" })])).toEqual([1]);
		expect(numbers(stopped(stopOf(1)), [pr(1, { baseOid: "main-2" })])).toEqual([1]);
	});
});

describe("applyKeepRebased", () => {
	test("switches a repository on, sorted, and off, forgetting its stops", () => {
		const both = applyKeepRebased(applyKeepRebased(EMPTY_KEEP_REBASED, { op: "switch", repo: "zed/app", on: true }), { op: "switch", repo: "acme/webapp", on: true });
		expect(both.repos).toEqual(["acme/webapp", "zed/app"]);
		const withStop = applyKeepRebased(both, { op: "stop", stop: stopOf(1) });
		expect(applyKeepRebased(withStop, { op: "switch", repo: "acme/webapp", on: false })).toEqual({ repos: ["zed/app"], stops: {} });
	});

	test("changes nothing when the switch already is where it goes, or the stop to forget is not there", () => {
		expect(applyKeepRebased(on, { op: "switch", repo: "acme/webapp", on: true })).toBe(on);
		expect(applyKeepRebased(on, { op: "forget", key: "acme/webapp#1" })).toBe(on);
	});

	test("remembers a stop and forgets it", () => {
		const state = applyKeepRebased(on, { op: "stop", stop: stopOf(1) });
		expect(state.stops["acme/webapp#1"]).toEqual(stopOf(1));
		expect(applyKeepRebased(state, { op: "forget", key: "acme/webapp#1" }).stops).toEqual({});
	});

	test("a read keeps a stop that still holds and drops one whose commits moved or whose pull request no longer needs a rebase", () => {
		const state = stopped(stopOf(1), stopOf(2), stopOf(3), stopOf(4));
		const read = list(listed([pr(1), pr(2, { headOid: "head-2b" }), pr(3, { behind: false })]));
		expect(Object.keys(applyKeepRebased(state, { op: "read", list: read }).stops)).toEqual(["acme/webapp#1"]);
		expect(applyKeepRebased(stopped(stopOf(1)), { op: "read", list: read })).toEqual(stopped(stopOf(1)));
	});

	test("a read keeps the stops of a repository GitHub did not answer for", () => {
		const state = stopped(stopOf(1));
		expect(applyKeepRebased(state, { op: "read", list: list({ owner: "Acme", repo: "webapp", cwds: [], error: "rate limited" }) })).toBe(state);
	});
});

describe("parseKeepRebased", () => {
	test("reads what it saved and refuses anything else", () => {
		const state = stopped(stopOf(1, { outcome: "failed", why: "push refused" }));
		expect(parseKeepRebased(JSON.parse(JSON.stringify(state)))).toEqual(state);
		expect(parseKeepRebased({ repos: [1], stops: {} })).toBeNull();
		expect(parseKeepRebased({ repos: [], stops: { x: { ...stopOf(1), outcome: "lost" } } })).toBeNull();
		expect(parseKeepRebased(null)).toBeNull();
	});
});
