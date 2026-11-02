import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ReactNode } from "react";
import type { PullRequestRebase, PullRequestSummary, RebasedPullRequest } from "../src/shared/github";
import { toasts } from "./components/toaster";
import { type RebaseHooks, type RebaseJob, rebasePullRequest, rebasePullRequests } from "./pull-request-rebases";

const pr = (number: number, stackedOn: number | null = null): PullRequestSummary => ({
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
	base: stackedOn === null ? "main" : `me/branch-${stackedOn}`,
	stackedOn: stackedOn === null ? null : `me/branch-${stackedOn}`,
	behind: true,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	updatedAt: number,
});

const job = (number: number, stackedOn: number | null = null): RebaseJob => ({ pr: pr(number, stackedOn), cwd: "/work/webapp" });

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The server's answer to each pull request number. */
let answers: Record<number, Response>;
let requested: PullRequestRebase[];
/** A toast as the queue left it. */
interface Shown {
	type?: string;
	title?: ReactNode;
	description?: ReactNode;
}

/** Each toast as it reads now, by id, in the order they opened. */
let shown: Map<string, Shown>;
/** What each toast said, by id, every time it changed. */
let said: Map<string, string[]>;

function show(id: string, change: Shown): void {
	const toast = { ...shown.get(id), ...change };
	shown.set(id, toast);
	const words = [toast.title, toast.description].filter(Boolean).join(": ");
	const before = said.get(id) ?? [];
	if (before.at(-1) !== words) said.set(id, [...before, words]);
}

beforeEach(() => {
	requested = [];
	shown = new Map();
	said = new Map();
	let ids = 0;
	spyOn(globalThis, "fetch").mockImplementation((async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as PullRequestRebase;
		requested.push(body);
		return answers[body.number]!;
	}) as typeof fetch);
	spyOn(toasts, "add").mockImplementation(({ id = `toast-${(ids += 1)}`, type, title, description }) => {
		show(id, { type, title, description });
		return id;
	});
	spyOn(toasts, "update").mockImplementation((id, change) => {
		if (typeof change !== "function") show(id, { title: change.title, description: change.description });
	});
});

afterEach(() => mock.restore());

/** Runs `queue` and resolves once the run reads the list again, with the jobs handed to **Resolve conflicts**. */
function settled(queue: (hooks: RebaseHooks) => void): Promise<RebaseJob[]> {
	const resolved: RebaseJob[] = [];
	const { promise, resolve } = Promise.withResolvers<RebaseJob[]>();
	queue({ resolve: job => resolved.push(job), refresh: () => resolve(resolved) });
	return promise;
}

const rebased = (branch: string, kind: RebasedPullRequest["kind"] = "rebased"): RebasedPullRequest =>
	kind === "conflict" ? { kind, branch, onto: "main", files: ["a.ts", "b.ts"] } : { kind, branch, onto: "main" };

describe("rebasePullRequest", () => {
	test("turns its loading toast into the server's reason for a refusal", async () => {
		answers = { 1: reply(409, { error: "The worktree has uncommitted changes." }) };
		expect(await settled(hooks => rebasePullRequest(job(1), hooks))).toEqual([]);
		expect([...said.values()]).toEqual([
			["Rebasing me/branch-1 on main: Fetching, rebasing, and pushing through the pre-push checks", "Could not rebase me/branch-1: The worktree has uncommitted changes."],
		]);
		expect([...shown.values()].map(toast => toast.type)).toEqual([undefined]);
	});
});

describe("rebasePullRequests", () => {
	test("counts the run in one toast, hands a conflict to Resolve conflicts, skips the stack above it, and sums the run up", async () => {
		answers = { 1: reply(200, rebased("me/branch-1", "conflict")), 4: reply(200, rebased("me/branch-4", "current")), 5: reply(200, rebased("me/branch-5")) };
		const resolved = await settled(hooks => rebasePullRequests([job(1), job(4), job(2, 1), job(3, 2), job(5)], hooks));
		expect(resolved).toEqual([job(1)]);
		expect(requested.map(({ number }) => number)).toEqual([1, 4, 5]);
		expect([...said.values()]).toEqual([
			[
				"Rebasing 1 of 5 pull requests: me/branch-1 on main",
				"Rebasing 2 of 5 pull requests: me/branch-4 on main",
				"Rebasing 3 of 5 pull requests: me/branch-2 on me/branch-1",
				"Rebasing 4 of 5 pull requests: me/branch-3 on me/branch-2",
				"Rebasing 5 of 5 pull requests: me/branch-5 on main",
				"Rebased 1 of 5 pull requests: 1 already had its base, 1 stopped at a conflict, and 2 skipped, stacked on one that stopped.",
			],
			["me/branch-1 conflicts with main: 2 files conflict. A Resolve conflicts session takes over."],
		]);
		expect([...shown.values()].map(toast => toast.type)).toEqual([undefined, undefined]);
	});

	test("rebases what sits on a pull request once it is pushed", async () => {
		answers = { 1: reply(200, rebased("me/branch-1")), 2: reply(200, rebased("me/branch-2")) };
		await settled(hooks => rebasePullRequests([job(1), job(2, 1)], hooks));
		expect(requested.map(({ number }) => number)).toEqual([1, 2]);
		expect([...said.values()].map(words => words.at(-1))).toEqual(["Rebased 2 of 2 pull requests"]);
	});

	test("waits behind an earlier run, then skips a pull request stacked on one that run stopped at a conflict", async () => {
		answers = { 1: reply(200, rebased("me/branch-1", "conflict")), 2: reply(200, rebased("me/branch-2")) };
		const single = settled(hooks => rebasePullRequest(job(1), hooks));
		const bulk = settled(hooks => rebasePullRequests([job(1), job(2, 1)], hooks));
		expect(await single).toEqual([job(1)]);
		await bulk;
		expect(requested.map(({ number }) => number)).toEqual([1]);
		expect([...said.values()]).toEqual([
			["Rebasing me/branch-1 on main: Fetching, rebasing, and pushing through the pre-push checks", "me/branch-1 conflicts with main: 2 files conflict. A Resolve conflicts session takes over."],
			["Rebasing 1 of 1 pull request: Queued behind 1 rebase", "Rebasing 1 of 1 pull request: me/branch-2 on me/branch-1", "Rebased 0 of 1 pull request: 1 skipped, stacked on one that stopped."],
		]);

		await settled(hooks => rebasePullRequests([job(2, 1)], hooks));
		expect(requested.map(({ number }) => number)).toEqual([1, 2]);
	});
});
